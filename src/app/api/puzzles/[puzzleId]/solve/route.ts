import { NextRequest, NextResponse } from 'next/server';
import { isLegalPuzzleSolution } from '@/lib/chess/puzzleValidation';
import { createAdminClient, SupabaseAdminConfigurationError } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';

type RouteContext = { params: Promise<{ puzzleId: string }> };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FALLBACK_SOLUTIONS: Record<string, string[]> = {
  '00000000-0000-4000-8000-000000000001': ['Qg7#'],
  '00000000-0000-4000-8000-000000000002': ['Qa8#'],
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { puzzleId } = await params;
    if (!UUID_PATTERN.test(puzzleId)) {
      return NextResponse.json({ error: 'Invalid puzzle ID' }, { status: 400 });
    }

    const authClient = await createServerClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    let parsedBody: unknown;
    try {
      parsedBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }

    const body = parsedBody as { moves?: unknown; failedAttempts?: unknown };
    if (
      !Array.isArray(body.moves) ||
      !body.moves.every((move: unknown) => typeof move === 'string') ||
      !Number.isInteger(body.failedAttempts) ||
      (body.failedAttempts as number) < 0 ||
      (body.failedAttempts as number) > 1000
    ) {
      return NextResponse.json({ error: 'Invalid puzzle solution submission' }, { status: 400 });
    }

    const fallbackSolution = FALLBACK_SOLUTIONS[puzzleId];
    if (fallbackSolution &&
      Array.isArray(body.moves) &&
      body.moves.length === fallbackSolution.length &&
      body.moves.every((move, index) => move === fallbackSolution[index])) {
      return NextResponse.json({ success: true, fallback: true });
    }

    const admin = createAdminClient();
    const { data: puzzle, error: puzzleError } = await admin
      .from('puzzles')
      .select('id, fen, solution_moves')
      .eq('id', puzzleId)
      .maybeSingle();
    if (puzzleError) {
      console.error('Puzzle solution lookup failed:', puzzleError.message);
      return NextResponse.json({ error: 'Unable to verify puzzle solution' }, { status: 500 });
    }
    if (!puzzle) {
      return NextResponse.json({ error: 'Puzzle not found' }, { status: 404 });
    }
    if (
      typeof puzzle.fen !== 'string' ||
      !Array.isArray(puzzle.solution_moves) ||
      !puzzle.solution_moves.every((move: unknown): move is string => typeof move === 'string') ||
      !isLegalPuzzleSolution(puzzle.fen, puzzle.solution_moves)
    ) {
      console.error('Puzzle has invalid persisted solution data:', puzzle.id);
      return NextResponse.json({ error: 'Puzzle data is invalid' }, { status: 500 });
    }
    if (
      body.moves.length !== puzzle.solution_moves.length ||
      body.moves.some((move: string, index: number) => move !== puzzle.solution_moves[index])
    ) {
      return NextResponse.json({ error: 'The submitted moves do not solve this puzzle' }, { status: 400 });
    }

    const { data: previousProgress, error: progressLookupError } = await admin
      .from('puzzle_progress')
      .select('attempts, solved')
      .eq('user_id', user.id)
      .eq('puzzle_id', puzzle.id)
      .maybeSingle();
    if (progressLookupError) {
      console.error('Puzzle progress lookup failed:', progressLookupError.message);
      return NextResponse.json({ error: 'Unable to save puzzle progress' }, { status: 500 });
    }
    if (previousProgress?.solved) {
      return NextResponse.json({ success: true });
    }

    const { error: saveError } = await admin
      .from('puzzle_progress')
      .upsert(
        {
          user_id: user.id,
          puzzle_id: puzzle.id,
          solved: true,
          attempts: (previousProgress?.attempts ?? 0) + (body.failedAttempts as number) + 1,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,puzzle_id' }
      );
    if (saveError) {
      console.error('Puzzle progress save failed:', saveError.message);
      return NextResponse.json({ error: 'Unable to save puzzle progress' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Puzzle solve request failed:', error);
    if (error instanceof SupabaseAdminConfigurationError) {
      return NextResponse.json({
        error: 'Puzzle progress saving is not configured. Add SUPABASE_SERVICE_KEY as a private Vercel environment variable.',
      }, { status: 503 });
    }
    return NextResponse.json({ error: 'Unable to save puzzle progress' }, { status: 500 });
  }
}
