/** @jest-environment node */

import { PATCH } from '../src/app/api/invitations/route';
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
});
