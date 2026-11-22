/** @jest-environment node */

import type { NextRequest } from 'next/server';
import { GET, POST } from '../src/app/api/games/[gameId]/route';
import { createAdminClient } from '../src/lib/supabase/admin';
import { createServerClient } from '../src/lib/supabase/server';

jest.mock('../src/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

jest.mock('../src/lib/supabase/server', () => ({
  createServerClient: jest.fn(),
}));

const gameId = '00000000-0000-4000-8000-000000000001';
const whitePlayerId = '00000000-0000-4000-8000-000000000002';
const blackPlayerId = '00000000-0000-4000-8000-000000000003';
const checkmateFen = '7k/8/5KQ1/8/8/8/8/8 w - - 0 1';

describe('online game result persistence', () => {
  const mockedCreateServerClient = createServerClient as unknown as jest.Mock<Promise<unknown>, []>;
  const mockedCreateAdminClient = createAdminClient as unknown as jest.Mock<unknown, []>;
  const rpc = jest.fn<Promise<unknown>, []>();

  beforeEach(() => {
    jest.clearAllMocks();
    const gameQuery = {
      select: jest.fn(),
      eq: jest.fn(),
      maybeSingle: jest.fn<Promise<unknown>, []>(),
    };
    gameQuery.select.mockReturnValue(gameQuery);
    gameQuery.eq.mockReturnValue(gameQuery);
    gameQuery.maybeSingle.mockResolvedValue({
      data: {
        id: gameId,
        white_player_id: whitePlayerId,
        black_player_id: blackPlayerId,
        status: 'in_progress',
        result: 'in_progress',
        moves: [],
        fen: checkmateFen,
      },
      error: null,
    });
    rpc.mockResolvedValue({
      data: {
        status: 'completed',
        result: 'white_wins',
        whiteRatingChange: 20,
        blackRatingChange: -20,
      },
      error: null,
    });
    mockedCreateAdminClient.mockReturnValue({
      from: jest.fn(() => gameQuery),
      rpc,
    });
    mockedCreateServerClient.mockResolvedValue({
      auth: {
        getUser: jest.fn<Promise<unknown>, []>().mockResolvedValue({
          data: { user: { id: whitePlayerId } },
          error: null,
        }),
      },
    });
  });

  it('loads a participant game through the authenticated Supabase client without a service-role key', async () => {
    const gameQuery = {
      select: jest.fn(),
      eq: jest.fn(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: gameId,
          white_player_id: whitePlayerId,
          black_player_id: blackPlayerId,
          white_rating: 1200,
          black_rating: 1200,
          white_rating_change: null,
          black_rating_change: null,
          time_control: '3+2',
          status: 'in_progress',
          result: 'in_progress',
          moves: [],
          fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
          started_at: null,
          ended_at: null,
        },
        error: null,
      }),
    };
    gameQuery.select.mockReturnValue(gameQuery);
    gameQuery.eq.mockReturnValue(gameQuery);
    mockedCreateServerClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: whitePlayerId } },
          error: null,
        }),
      },
      from: jest.fn(() => gameQuery),
    });

    const response = await GET({} as NextRequest, { params: Promise.resolve({ gameId }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      id: gameId,
      whitePlayerId,
      blackPlayerId,
      status: 'in_progress',
      moves: [],
    });
    expect(gameQuery.eq).toHaveBeenCalledWith('id', gameId);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  it('does not disclose games hidden from the authenticated user by RLS', async () => {
    const gameQuery = {
      select: jest.fn(),
      eq: jest.fn(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    gameQuery.select.mockReturnValue(gameQuery);
    gameQuery.eq.mockReturnValue(gameQuery);
    mockedCreateServerClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: '00000000-0000-4000-8000-000000000004' } },
          error: null,
        }),
      },
      from: jest.fn(() => gameQuery),
    });

    const response = await GET({} as NextRequest, { params: Promise.resolve({ gameId }) });

    expect(response.status).toBe(404);
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  it('returns a clear configuration error when move persistence lacks the private server key', async () => {
    mockedCreateAdminClient.mockImplementation(() => {
      const error = new Error('Missing Supabase URL or Service Role Key for admin client');
      error.name = 'SupabaseAdminConfigurationError';
      throw error;
    });
    const request = {
      json: async () => ({ action: 'move', move: 'e4' }),
    } as NextRequest;

    const response = await POST(request, { params: Promise.resolve({ gameId }) });
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toContain('SUPABASE_SERVICE_KEY');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('uses the atomic database operation to save a checkmate and rating result', async () => {
    const request = {
      json: async () => ({ action: 'move', move: 'Qg7#' }),
    } as NextRequest;

    const response = await POST(request, { params: Promise.resolve({ gameId }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('apply_online_game_action', expect.objectContaining({
      p_game_id: gameId,
      p_actor_id: whitePlayerId,
      p_action: 'move',
      p_moves: ['Qg7#'],
      p_result: 'white_wins',
    }));
    expect(payload).toMatchObject({
      success: true,
      gameOver: true,
      result: 'white_wins',
      whiteRatingChange: 20,
      blackRatingChange: -20,
    });
  });

  it('rejects a user who is not a participant before calling the database operation', async () => {
    mockedCreateServerClient.mockResolvedValue({
      auth: {
        getUser: jest.fn<Promise<unknown>, []>().mockResolvedValue({
          data: { user: { id: '00000000-0000-4000-8000-000000000004' } },
          error: null,
        }),
      },
    });
    const request = {
      json: async () => ({ action: 'move', move: 'Qg7#' }),
    } as NextRequest;

    const response = await POST(request, { params: Promise.resolve({ gameId }) });

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('records resignation through the same atomic result operation', async () => {
    const request = {
      json: async () => ({ action: 'resign' }),
    } as NextRequest;

    const response = await POST(request, { params: Promise.resolve({ gameId }) });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('apply_online_game_action', expect.objectContaining({
      p_game_id: gameId,
      p_actor_id: whitePlayerId,
      p_action: 'resign',
      p_expected_fen: checkmateFen,
    }));
  });

  it('explains when the result migration has not been applied', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'function not found' },
    });
    const request = {
      json: async () => ({ action: 'resign' }),
    } as NextRequest;

    const response = await POST(request, { params: Promise.resolve({ gameId }) });
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toContain('Apply the latest sql/fix_matchmaking_and_seed_puzzles.sql');
  });
});
