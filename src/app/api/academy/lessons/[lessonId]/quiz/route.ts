import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, SupabaseAdminConfigurationError } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { getLevel1Quiz } from '@/lib/learning/level1';
import { scoreAcademyQuiz } from '@/lib/learning/academy';

type RouteContext = { params: Promise<{ lessonId: string }> };
const LESSON_ID_PATTERN = /^l[1-4]-(0[1-9]|10)$/;

async function isLessonUnlocked(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  levelNumber: number,
  lessonNumber: number
) {
  if (levelNumber === 1 && lessonNumber === 1) return true;

  if (lessonNumber > 1) {
    const { data: previousLesson, error: previousLessonError } = await admin
      .from('academy_lessons')
      .select('id')
      .eq('level_number', levelNumber)
      .eq('lesson_number', lessonNumber - 1)
      .eq('published', true)
      .maybeSingle();
    if (previousLessonError) throw previousLessonError;
    if (!previousLesson) return false;

    const { data: progress, error: progressError } = await admin
      .from('academy_progress')
      .select('passed')
      .eq('user_id', userId)
      .eq('lesson_id', previousLesson.id)
      .maybeSingle();
    if (progressError) throw progressError;
    return progress?.passed === true;
  }

  const { data: previousLevelLessons, error: lessonsError } = await admin
    .from('academy_lessons')
    .select('id')
    .eq('level_number', levelNumber - 1)
    .eq('published', true);
  if (lessonsError) throw lessonsError;
  if (!previousLevelLessons || previousLevelLessons.length !== 10) return false;

  const { data: progress, error: progressError } = await admin
    .from('academy_progress')
    .select('lesson_id')
    .eq('user_id', userId)
    .eq('passed', true)
    .in('lesson_id', previousLevelLessons.map((lesson) => lesson.id));
  if (progressError) throw progressError;
  return progress?.length === 10;
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  let lessonId = '';
  let fallbackAnswers: Record<string, string> | undefined;
  try {
    ({ lessonId } = await params);
    if (!LESSON_ID_PATTERN.test(lessonId)) {
      return NextResponse.json({ error: 'Invalid Academy lesson ID' }, { status: 400 });
    }

    const authClient = await createServerClient();
    const { data: { user } } = await authClient.auth.getUser();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }

    const { answers, durationSeconds } = body as { answers?: unknown; durationSeconds?: unknown };
    fallbackAnswers = answers as Record<string, string>;
    if (
      !answers ||
      typeof answers !== 'object' ||
      Array.isArray(answers) ||
      Object.keys(answers).length !== 20 ||
      !Object.values(answers).every((answer) => typeof answer === 'string') ||
      !Number.isInteger(durationSeconds) ||
      (durationSeconds as number) < 0 ||
      (durationSeconds as number) > 86400
    ) {
      return NextResponse.json({ error: 'Invalid Academy quiz submission' }, { status: 400 });
    }

    if (!user) {
      const localQuestions = getLevel1Quiz(lessonId);
      if (localQuestions.length === 20) {
        const submittedAnswers = answers as Record<string, string>;
        const localResult = scoreAcademyQuiz(localQuestions, submittedAnswers);
        return NextResponse.json({
          fallback: true,
          saved: false,
          result: { ...localResult, xpEarned: 0 },
          review: localQuestions.map((question) => ({
            id: question.id,
            correctAnswer: question.correctAnswer,
            explanation: {
              en: 'Review the lesson theory and your selected answer.',
              fr: 'Relisez la théorie et votre réponse.',
              ar: 'راجع شرح الدرس وإجابتك.',
            },
            solutionMoves: question.solutionMoves ?? [],
            selectedAnswer: submittedAnswers[question.id],
            correct: submittedAnswers[question.id] === question.correctAnswer,
          })),
        });
      }
    }

    const admin = createAdminClient();
    const { data: lesson, error: lessonError } = await admin
      .from('academy_lessons')
      .select('id, level_number, lesson_number')
      .eq('id', lessonId)
      .eq('published', true)
      .maybeSingle();
    if (lessonError) {
      console.error('Academy quiz lesson lookup failed:', lessonError.message);
      const localQuestions = getLevel1Quiz(lessonId);
      if (localQuestions.length === 20) {
        const submittedAnswers = answers as Record<string, string>;
        const localResult = scoreAcademyQuiz(localQuestions, submittedAnswers);
        return NextResponse.json({
          fallback: true,
          result: { ...localResult, xpEarned: localResult.passed ? 50 + localResult.score : 0 },
          review: localQuestions.map((question) => ({
            id: question.id,
            correctAnswer: question.correctAnswer,
            explanation: question.explanation,
            solutionMoves: question.solutionMoves ?? [],
            selectedAnswer: submittedAnswers[question.id],
            correct: submittedAnswers[question.id] === question.correctAnswer,
          })),
        });
      }
      return NextResponse.json({ error: 'Unable to verify Academy lesson' }, { status: 500 });
    }
    if (!lesson) {
      const localQuestions = getLevel1Quiz(lessonId);
      if (localQuestions.length === 20) {
        const submittedAnswers = answers as Record<string, string>;
        const localResult = scoreAcademyQuiz(localQuestions, submittedAnswers);
        return NextResponse.json({
          fallback: true,
          result: { ...localResult, xpEarned: localResult.passed ? 50 + localResult.score : 0 },
          review: localQuestions.map((question) => ({
            id: question.id,
            correctAnswer: question.correctAnswer,
            explanation: question.explanation,
            solutionMoves: question.solutionMoves ?? [],
            selectedAnswer: submittedAnswers[question.id],
            correct: submittedAnswers[question.id] === question.correctAnswer,
          })),
        });
      }
      return NextResponse.json({ error: 'Academy lesson not found' }, { status: 404 });
    }
    if (!user) {
      const localQuestions = getLevel1Quiz(lessonId);
      const submittedAnswers = answers as Record<string, string>;
      const localResult = scoreAcademyQuiz(localQuestions, submittedAnswers);
      return NextResponse.json({
        fallback: true,
        saved: false,
        result: { ...localResult, xpEarned: 0 },
        review: localQuestions.map((question) => ({
          id: question.id,
          correctAnswer: question.correctAnswer,
          explanation: question.explanation,
          solutionMoves: question.solutionMoves ?? [],
          selectedAnswer: submittedAnswers[question.id],
          correct: submittedAnswers[question.id] === question.correctAnswer,
        })),
      });
    }
    if (!await isLessonUnlocked(admin, user.id, lesson.level_number, lesson.lesson_number)) {
      return NextResponse.json({ error: 'Pass the previous lesson to unlock this one' }, { status: 403 });
    }

    const { data: questions, error: questionsError } = await admin
      .from('academy_questions')
      .select('id, correct_answer, explanation, solution_moves')
      .eq('lesson_id', lessonId)
      .order('question_number', { ascending: true });
    if (questionsError) {
      console.error('Academy quiz answer lookup failed:', questionsError.message);
      const localQuestions = getLevel1Quiz(lessonId);
      if (localQuestions.length === 20) {
        const submittedAnswers = answers as Record<string, string>;
        const localResult = scoreAcademyQuiz(localQuestions, submittedAnswers);
        return NextResponse.json({
          fallback: true,
          result: { ...localResult, xpEarned: localResult.passed ? 50 + localResult.score : 0 },
          review: localQuestions.map((question) => ({
            id: question.id,
            correctAnswer: question.correctAnswer,
            explanation: question.explanation,
            solutionMoves: question.solutionMoves ?? [],
            selectedAnswer: submittedAnswers[question.id],
            correct: submittedAnswers[question.id] === question.correctAnswer,
          })),
        });
      }
      return NextResponse.json({ error: 'Unable to verify Academy quiz' }, { status: 500 });
    }
    if (!questions || questions.length !== 20) {
      const localQuestions = getLevel1Quiz(lessonId);
      if (localQuestions.length === 20) {
        const submittedAnswers = answers as Record<string, string>;
        const localResult = scoreAcademyQuiz(localQuestions, submittedAnswers);
        return NextResponse.json({
          fallback: true,
          result: { ...localResult, xpEarned: localResult.passed ? 50 + localResult.score : 0 },
          review: localQuestions.map((question) => ({
            id: question.id,
            correctAnswer: question.correctAnswer,
            explanation: question.explanation,
            solutionMoves: question.solutionMoves ?? [],
            selectedAnswer: submittedAnswers[question.id],
            correct: submittedAnswers[question.id] === question.correctAnswer,
          })),
        });
      }
      return NextResponse.json({ error: 'Academy quiz is not ready yet' }, { status: 503 });
    }

    const questionIds = new Set(questions.map((question) => question.id));
    const submittedAnswers = answers as Record<string, string>;
    if (Object.keys(submittedAnswers).some((questionId) => !questionIds.has(questionId))) {
      return NextResponse.json({ error: 'Quiz answers do not match this lesson' }, { status: 400 });
    }

    const { data: result, error: submitError } = await admin.rpc('submit_academy_quiz', {
      p_user_id: user.id,
      p_lesson_id: lessonId,
      p_answers: submittedAnswers,
      p_duration_seconds: durationSeconds as number,
    });
    if (submitError) {
      console.error('Academy quiz submission failed:', submitError.message);
      return NextResponse.json({ error: 'Unable to save Academy quiz result' }, { status: 500 });
    }

    return NextResponse.json({
      result,
      review: questions.map((question) => ({
        id: question.id,
        correctAnswer: question.correct_answer,
        explanation: question.explanation,
        solutionMoves: question.solution_moves,
        selectedAnswer: submittedAnswers[question.id],
        correct: submittedAnswers[question.id] === question.correct_answer,
      })),
    });
  } catch (error) {
    console.error('Academy quiz request failed:', error);
    if (error instanceof SupabaseAdminConfigurationError) {
      const localQuestions = getLevel1Quiz(lessonId);
      if (localQuestions.length === 20) {
        const bodyAnswers = fallbackAnswers ?? {};
        const localResult = scoreAcademyQuiz(localQuestions, bodyAnswers);
        return NextResponse.json({
          fallback: true,
          result: { ...localResult, xpEarned: localResult.passed ? 50 + localResult.score : 0 },
          review: localQuestions.map((question) => ({
            id: question.id,
            correctAnswer: question.correctAnswer,
            explanation: question.explanation,
            solutionMoves: question.solutionMoves ?? [],
            selectedAnswer: bodyAnswers[question.id],
            correct: bodyAnswers[question.id] === question.correctAnswer,
          })),
        });
      }
      return NextResponse.json({ error: 'Academy database access is not configured.' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Unable to process Academy quiz' }, { status: 500 });
  }
}
