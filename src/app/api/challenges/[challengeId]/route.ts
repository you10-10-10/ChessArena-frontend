import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIGRATION_ERROR = 'Shareable challenges are not enabled in the database yet. Apply sql/shareable_game_challenges.sql in the Supabase SQL Editor.';

type AuthenticatedClient =
  | { supabase: Awaited<ReturnType<typeof createServerClient>> }
  | { response: NextResponse };

function isMissingChallengeMigration(error: { code?: string } | null) {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

async function getAuthenticatedClient(): Promise<AuthenticatedClient> {
  const supabase = await createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  return error || !user
    ? { response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) }
    : { supabase };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ challengeId: string }> },
) {
  try {
    const { challengeId } = await params;
    if (!UUID_PATTERN.test(challengeId)) {
      return NextResponse.json({ error: 'Invalid challenge link.' }, { status: 400 });
    }

    const auth = await getAuthenticatedClient();
    if ('response' in auth) return auth.response;

    const { data, error } = await auth.supabase.rpc('get_shareable_game_challenge', {
      p_challenge_id: challengeId,
    });
    if (error) {
      if (isMissingChallengeMigration(error)) {
        return NextResponse.json({ error: MIGRATION_ERROR }, { status: 503 });
      }
      throw error;
    }
    if (data?.status === 'not_found') {
      return NextResponse.json({ error: 'This challenge link was not found.' }, { status: 404 });
    }

    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Load shareable game challenge error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to load this challenge.' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ challengeId: string }> },
) {
  try {
    const { challengeId } = await params;
    if (!UUID_PATTERN.test(challengeId)) {
      return NextResponse.json({ error: 'Invalid challenge link.' }, { status: 400 });
    }

    const auth = await getAuthenticatedClient();
    if ('response' in auth) return auth.response;

    const body = await request.json();
    const action = body?.action;
    if (action !== 'accept' && action !== 'cancel') {
      return NextResponse.json({ error: 'Choose accept or cancel.' }, { status: 400 });
    }

    const functionName = action === 'accept'
      ? 'accept_shareable_game_challenge'
      : 'cancel_shareable_game_challenge';
    const { data, error } = await auth.supabase.rpc(functionName, {
      p_challenge_id: challengeId,
    });
    if (error) {
      if (isMissingChallengeMigration(error)) {
        return NextResponse.json({ error: MIGRATION_ERROR }, { status: 503 });
      }
      if (error.code === 'P0001') {
        return NextResponse.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }
    if (data?.status === 'not_found') {
      return NextResponse.json({ error: 'This challenge link was not found.' }, { status: 404 });
    }
    if (data?.status !== (action === 'accept' ? 'accepted' : 'cancelled')) {
      return NextResponse.json({ error: `This challenge is ${data?.status || 'no longer available'}.` }, { status: 409 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Respond to shareable game challenge error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to process this challenge.' },
      { status: 500 },
    );
  }
}
