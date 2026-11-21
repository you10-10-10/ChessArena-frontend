import { NextResponse } from 'next/server';
import { createAdminClient, SupabaseAdminConfigurationError } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';

const LEVEL_ONE_FALLBACK = [
  ['l1-01', 'Introduction to Chess and Board Setup', 'Set up the board correctly, identify the pieces, and understand how a game begins.'],
  ['l1-02', 'Understanding the Chessboard and Coordinates', 'Read files, ranks, square names, and the central squares accurately.'],
  ['l1-03', 'The King: Movement and Rules', 'Learn the king’s movement, check, legal safety, and the king’s role in the game.'],
  ['l1-04', 'The Queen: Movement and Power', 'Use the queen’s range wisely and avoid exposing it to attacks.'],
  ['l1-05', 'The Rook: Movement and Strategies', 'Understand rook lines, open files, and why rooks become powerful when connected.'],
  ['l1-06', 'The Bishop: Movement and Diagonals', 'Use diagonals, understand bishop color, and recognize the impact of pawn structure.'],
  ['l1-07', 'The Knight: Movement and Special Patterns', 'Master the knight’s L-shaped move, jumping ability, and changing square colors.'],
  ['l1-08', 'The Pawn: Movement, Captures and Promotion', 'Learn the pawn’s forward movement, diagonal captures, promotion, and en passant.'],
  ['l1-09', 'Understanding Check, Checkmate and Stalemate', 'Distinguish check, checkmate, and stalemate, and learn how to respond to threats against the king.'],
  ['l1-10', 'Castling, En Passant and Special Rules', 'Apply castling and en passant correctly, and recognize when these special moves are legal.'],
] as const;

function fallbackLessons() {
  return LEVEL_ONE_FALLBACK.map(([id, title, summary], index) => ({
    id,
    level_number: 1,
    lesson_number: index + 1,
    title: { en: title, fr: title, ar: title },
    summary: { en: summary, fr: summary, ar: summary },
    progress: null,
    unlocked: index === 0,
  }));
}

export async function GET() {
  try {
    const admin = createAdminClient();
    const { data: lessons, error: lessonsError } = await admin
      .from('academy_lessons')
      .select('id, level_number, lesson_number, title, summary')
      .eq('published', true)
      .order('level_number', { ascending: true })
      .order('lesson_number', { ascending: true });

    if (lessonsError) {
      console.error('Academy lesson list lookup failed:', lessonsError.message);
      return NextResponse.json({ lessons: fallbackLessons(), fallback: true });
    }

    const authClient = await createServerClient();
    const { data: { user } } = await authClient.auth.getUser();
    let progressByLesson = new Map<string, { passed: boolean; bestScore: number; attempts: number }>();
    if (user) {
      const { data: progress, error: progressError } = await admin
        .from('academy_progress')
        .select('lesson_id, passed, best_score, attempts')
        .eq('user_id', user.id);
      if (progressError) {
        console.error('Academy progress lookup failed:', progressError.message);
        return NextResponse.json({ lessons: fallbackLessons(), fallback: true });
      }
      progressByLesson = new Map((progress ?? []).map((item) => [
        item.lesson_id,
        { passed: item.passed, bestScore: item.best_score, attempts: item.attempts },
      ]));
    }

    const passedLessons = new Set(
      Array.from(progressByLesson.entries())
        .filter(([, progress]) => progress.passed)
        .map(([lessonId]) => lessonId)
    );
    const response = (lessons ?? []).map((lesson) => {
      const progress = progressByLesson.get(lesson.id) ?? null;
      const unlocked = lesson.level_number === 1 && lesson.lesson_number === 1
        ? true
        : lesson.lesson_number > 1
          ? passedLessons.has(`l${lesson.level_number}-${String(lesson.lesson_number - 1).padStart(2, '0')}`)
          : Array.from({ length: 10 }, (_, index) =>
              passedLessons.has(`l${lesson.level_number - 1}-${String(index + 1).padStart(2, '0')}`)
            ).every(Boolean);
      return { ...lesson, progress, unlocked };
    });

    return NextResponse.json({ lessons: response });
  } catch (error) {
    console.error('Academy lesson list request failed:', error);
    if (error instanceof SupabaseAdminConfigurationError) {
      return NextResponse.json({ lessons: fallbackLessons(), fallback: true });
    }
    return NextResponse.json({ error: 'Unable to load Academy lessons' }, { status: 500 });
  }
}
