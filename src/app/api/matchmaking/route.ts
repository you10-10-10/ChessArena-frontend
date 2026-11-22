import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

const TIME_CONTROLS = new Set(['1+0', '3+0', '3+2', '5+0', '10+0', '10+5', '15+10']);

async function getAuthenticatedClient() {
  const client = await createServerClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return { client, user: null };
  return { client, user };
}

export async function GET() {
  try {
    const { client, user } = await getAuthenticatedClient();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { data, error } = await client.rpc('matchmaking_status');
    if (error) {
      console.error('Matchmaking status lookup failed:', {
        endpoint: '/api/matchmaking',
        userId: user.id,
        stage: 'matchmaking_status',
        code: error.code,
        message: error.message,
      });
      return NextResponse.json(
        { error: 'Matchmaking is temporarily unavailable', code: error.code ?? null },
        { status: 503 },
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Matchmaking status error:', error);
    return NextResponse.json({ error: 'Unable to load matchmaking status' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    let parsedBody: unknown;
    try {
      parsedBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }
    const body = parsedBody as { action?: unknown; timeControl?: unknown };

    const { client, user } = await getAuthenticatedClient();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    if (body.action === 'join') {
      if (typeof body.timeControl !== 'string' || !TIME_CONTROLS.has(body.timeControl)) {
        return NextResponse.json({ error: 'Unsupported time control' }, { status: 400 });
      }

      const { data, error } = await client.rpc('join_matchmaking', {
        p_time_control: body.timeControl,
      });
      if (error) {
        console.error('Matchmaking join failed:', {
          endpoint: '/api/matchmaking',
          userId: user.id,
          stage: 'join_matchmaking',
          timeControl: body.timeControl,
          code: error.code,
          message: error.message,
        });
        if (error.code === '40001') {
          return NextResponse.json({ error: 'You are already in an active game.', code: error.code }, { status: 409 });
        }
        return NextResponse.json(
          { error: 'Matchmaking is temporarily unavailable', code: error.code ?? null },
          { status: 503 },
        );
      }
      return NextResponse.json(data);
    }

    if (body.action === 'leave') {
      const { data, error } = await client.rpc('leave_matchmaking');
      if (error) {
        console.error('Matchmaking leave failed:', error.message);
        return NextResponse.json({ error: 'Unable to leave matchmaking' }, { status: 503 });
      }
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Matchmaking request error:', error);
    return NextResponse.json({ error: 'Matchmaking request failed' }, { status: 500 });
  }
}
