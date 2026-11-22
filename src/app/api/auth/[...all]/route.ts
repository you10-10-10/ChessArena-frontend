import { toNextJsHandler } from 'better-auth/next-js';
import { getBetterAuth } from '@/lib/better-auth/auth';

async function handleAuthRequest(request: Request) {
  const isDashConfigRequest =
    request.method === 'GET' &&
    new URL(request.url).pathname === '/api/auth/dash/config';

  if (process.env.BETTER_AUTH_ENABLED !== 'true' && !isDashConfigRequest) {
    return new Response(null, { status: 404 });
  }

  const handlers = toNextJsHandler(getBetterAuth());
  return request.method === 'GET'
    ? handlers.GET(request)
    : handlers.POST(request);
}

export const GET = handleAuthRequest;
export const POST = handleAuthRequest;
