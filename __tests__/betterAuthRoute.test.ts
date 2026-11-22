/** @jest-environment node */

jest.mock('better-auth/next-js', () => ({
  toNextJsHandler: jest.fn(() => ({
    GET: jest.fn(async () => new Response('dash config')),
    POST: jest.fn(async () => new Response('auth post')),
  })),
}));

jest.mock('@/lib/better-auth/auth', () => ({
  getBetterAuth: jest.fn(() => ({})),
}));

import { getBetterAuth } from '@/lib/better-auth/auth';
import { GET, POST } from '../src/app/api/auth/[...all]/route';

describe('Better Auth route while auth is disabled', () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_ENABLED = 'false';
    jest.clearAllMocks();
  });

  it('allows Dash config and ownership validation endpoints', async () => {
    const configResponse = await GET(
      new Request('https://example.com/api/auth/dash/config'),
    );
    const validationResponse = await GET(
      new Request('https://example.com/api/auth/dash/validate'),
    );

    expect(configResponse.status).toBe(200);
    expect(validationResponse.status).toBe(200);
    expect(getBetterAuth).toHaveBeenCalledTimes(2);
  });

  it('keeps other auth requests disabled', async () => {
    const getResponse = await GET(
      new Request('https://example.com/api/auth/get-session'),
    );
    const postResponse = await POST(
      new Request('https://example.com/api/auth/sign-in/email', {
        method: 'POST',
      }),
    );

    expect(getResponse.status).toBe(404);
    expect(postResponse.status).toBe(404);
    expect(getBetterAuth).not.toHaveBeenCalled();
  });
});
