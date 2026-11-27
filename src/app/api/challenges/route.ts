import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

const TIME_CONTROLS = new Set(['1+0', '3+0', '3+2', '5+0', '10+0', '10+5', '15+10']);
const COLORS = new Set(['white', 'black', 'random']);
const MIGRATION_ERROR = 'Shareable challenges are not enabled in the database yet. Apply sql/shareable_game_challenges.sql in the Supabase SQL Editor.';

function isMissingChallengeMigration(error: { code?: string } | null) {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const timeControl = body?.timeControl ?? '3+2';
    const selectedColor = body?.selectedColor ?? 'random';
    const recipientUsername = body?.recipientUsername;
    if (!TIME_CONTROLS.has(timeControl) || !COLORS.has(selectedColor)) {
      return NextResponse.json({ error: 'Choose a valid time control and color.' }, { status: 400 });
    }
    if (
      (recipientUsername !== undefined && recipientUsername !== null && typeof recipientUsername !== 'string')
      || (typeof recipientUsername === 'string' && recipientUsername.trim().length > 64)
    ) {
      return NextResponse.json({ error: 'Enter a valid friend username (up to 64 characters).' }, { status: 400 });
    }

    const { data, error } = await supabase.rpc('create_shareable_game_challenge', {
      p_time_control: timeControl,
      p_selected_color: selectedColor,
      p_recipient_username: typeof recipientUsername === 'string' ? recipientUsername.trim() || null : null,
    });

    if (error) {
      if (isMissingChallengeMigration(error)) {
        return NextResponse.json({ error: MIGRATION_ERROR }, { status: 503 });
      }
      if (error.code === 'P0001') {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Create shareable game challenge error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create challenge link.' },
      { status: 500 },
    );
  }
}
