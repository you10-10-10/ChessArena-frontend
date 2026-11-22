/** @jest-environment node */

import { GET, PATCH } from '../src/app/api/invitations/route';
import { createAdminClient } from '../src/lib/supabase/admin';
import { createServerClient } from '../src/lib/supabase/server';

jest.mock('../src/lib/supabase/admin', () => ({
  createAdminClient: jest.fn(),
}));

jest.mock('../src/lib/supabase/server', () => ({
  createServerClient: jest.fn(),
}));

const userId = '00000000-0000-4000-8000-000000000001';
const invitationId = '00000000-0000-4000-8000-000000000002';
const gameId = '00000000-0000-4000-8000-000000000003';

describe('game invitation acceptance response', () => {
  const mockedCreateServerClient = createServerClient as unknown as jest.Mock;
  const mockedCreateAdminClient = createAdminClient as unknown as jest.Mock;
  const rpc = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    rpc.mockResolvedValue({
      data: { status: 'accepted', game_id: gameId },
      error: null,
    });
    mockedCreateServerClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: userId } },
          error: null,
        }),
      },
      rpc,
    });
  });

  it('includes accepted sent invitations so the sender can join the existing game', async () => {
    const makeQuery = (result: { data: unknown[]; error: null }) => {
      const query = {
        select: jest.fn(),
        eq: jest.fn(),
        gt: jest.fn(),
        in: jest.fn(),
        or: jest.fn(),
        order: jest.fn().mockResolvedValue(result),
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      query.gt.mockReturnValue(query);
      query.in.mockReturnValue(query);
      query.or.mockReturnValue(query);
      return query;
    };
    const receivedQuery = makeQuery({ data: [], error: null });
    const sentQuery = makeQuery({
      data: [{
        id: invitationId,
        status: 'accepted',
        game_id: gameId,
        sender_id: userId,
      }, {
        id: 'expired-invitation',
        status: 'pending',
        expires_at: new Date(Date.now() - 60_000).toISOString(),
        sender_id: userId,
      }, {
        id: 'active-invitation',
        status: 'pending',
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        sender_id: userId,
      }],
      error: null,
    });
    mockedCreateServerClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: userId } },
          error: null,
        }),
      },
      from: jest.fn()
        .mockReturnValueOnce(receivedQuery)
        .mockReturnValueOnce(sentQuery),
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      sent: [
        { id: invitationId, status: 'accepted', game_id: gameId },
        { id: 'active-invitation', status: 'pending' },
      ],
    });
    expect(sentQuery.in).toHaveBeenCalledWith('status', ['pending', 'accepted']);
  });

  it('normalizes a snake-case game ID so the client can open the created game', async () => {
    const request = new Request('http://localhost/api/invitations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invitationId, action: 'accept' }),
    });

    const response = await PATCH(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'accepted',
      game_id: gameId,
      gameId,
    });
    expect(mockedCreateAdminClient).not.toHaveBeenCalled();
  });

  it('loads the game ID from the accepted invitation when the RPC omits it', async () => {
    rpc.mockResolvedValueOnce({
      data: { status: 'accepted' },
      error: null,
    });
    const invitationQuery = {
      select: jest.fn(),
      eq: jest.fn(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { game_id: gameId },
        error: null,
      }),
    };
    invitationQuery.select.mockReturnValue(invitationQuery);
    invitationQuery.eq.mockReturnValue(invitationQuery);
    mockedCreateAdminClient.mockReturnValue({
      from: jest.fn(() => invitationQuery),
    });
    const request = new Request('http://localhost/api/invitations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invitationId, action: 'accept' }),
    });

    const response = await PATCH(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'accepted',
      gameId,
    });
    expect(invitationQuery.eq).toHaveBeenNthCalledWith(1, 'id', invitationId);
    expect(invitationQuery.eq).toHaveBeenNthCalledWith(2, 'receiver_id', userId);
  });

  it('returns an explicit expired response when the acceptance RPC expires the invitation', async () => {
    rpc.mockResolvedValueOnce({
      data: { status: 'expired' },
      error: null,
    });
    const request = new Request('http://localhost/api/invitations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invitationId, action: 'accept' }),
    });

    const response = await PATCH(request);

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: 'This invitation has expired.' });
  });

  it('does not create a game outside the atomic RPC when acceptance RPC is unavailable', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'function not found' },
    });
    const invitationQuery = {
      select: jest.fn(),
      eq: jest.fn(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: invitationId,
          sender_id: '00000000-0000-4000-8000-000000000009',
          receiver_id: userId,
          status: 'pending',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          game_id: null,
        },
        error: null,
      }),
    };
    invitationQuery.select.mockReturnValue(invitationQuery);
    invitationQuery.eq.mockReturnValue(invitationQuery);
    const from = jest.fn((table: string) => {
      if (table !== 'game_invitations') throw new Error(`Unexpected table: ${table}`);
      return invitationQuery;
    });
    mockedCreateAdminClient.mockReturnValue({ from });
    const request = new Request('http://localhost/api/invitations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invitationId, action: 'accept' }),
    });

    const response = await PATCH(request);

    expect(response.status).toBe(503);
    expect(from).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('atomic respond_game_invitation'),
    });
  });
});
