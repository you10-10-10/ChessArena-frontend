/** @jest-environment node */

import { GET, PATCH } from '../src/app/api/challenges/[challengeId]/route';
import { POST } from '../src/app/api/challenges/route';
import { createServerClient } from '../src/lib/supabase/server';

jest.mock('../src/lib/supabase/server', () => ({
  createServerClient: jest.fn(),
}));

const challengeId = '00000000-0000-4000-8000-000000000001';
const mockedCreateServerClient = createServerClient as unknown as jest.Mock<Promise<unknown>, []>;
const rpc = jest.fn();

describe('shareable challenge API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rpc.mockResolvedValue({
      data: { status: 'created', challengeId },
      error: null,
    });
    mockedCreateServerClient.mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: { id: '00000000-0000-4000-8000-000000000002' } },
          error: null,
        }),
      },
      rpc,
    });
  });

  it('creates a link challenge with validated game settings', async () => {
    const response = await POST(new Request('http://localhost/api/challenges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeControl: '5+0', selectedColor: 'white', recipientUsername: 'friend' }),
    }));

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('create_shareable_game_challenge', {
      p_time_control: '5+0',
      p_selected_color: 'white',
      p_recipient_username: 'friend',
    });
    await expect(response.json()).resolves.toEqual({ status: 'created', challengeId });
  });

  it('rejects invalid settings before accessing the database', async () => {
    const response = await POST(new Request('http://localhost/api/challenges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeControl: '99+99', selectedColor: 'white' }),
    }));

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns the result of the atomic accept operation', async () => {
    rpc.mockResolvedValueOnce({
      data: { status: 'accepted', gameId: '00000000-0000-4000-8000-000000000003' },
      error: null,
    });
    const response = await PATCH(
      new Request(`http://localhost/api/challenges/${challengeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept' }),
      }),
      { params: Promise.resolve({ challengeId }) },
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('accept_shareable_game_challenge', {
      p_challenge_id: challengeId,
    });
  });

  it('rejects acceptance by an account other than the targeted friend', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'This challenge is for another player' },
    });
    const response = await PATCH(
      new Request(`http://localhost/api/challenges/${challengeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept' }),
      }),
      { params: Promise.resolve({ challengeId }) },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'This challenge is for another player',
    });
  });

  it('reports the required migration when challenge RPCs are missing', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'function not found' },
    });
    const response = await GET(
      new Request(`http://localhost/api/challenges/${challengeId}`),
      { params: Promise.resolve({ challengeId }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toContain('sql/shareable_game_challenges.sql');
  });
});
