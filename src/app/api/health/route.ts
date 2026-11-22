import { NextResponse } from 'next/server';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let configured = false;
  if (url && key) {
    try {
      const parsed = new URL(url);
      configured = (parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
        && !/your-|placeholder|example/i.test(`${url} ${key}`);
    } catch {
      configured = false;
    }
  }
  return NextResponse.json(
    {
      status: configured ? 'ok' : 'degraded',
      service: 'chessarena',
      supabase: configured ? 'configured' : 'missing_public_config',
      timestamp: new Date().toISOString(),
    },
    { status: configured ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
