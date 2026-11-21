import { NextResponse } from 'next/server';
import { createAdminClient, SupabaseAdminConfigurationError } from '@/lib/supabase/admin';
import { getLevel1Lesson, getLevel1Quiz } from '@/lib/learning/level1';

type RouteContext = { params: Promise<{ lessonId: string }> };
const LESSON_ID_PATTERN = /^l[1-4]-(0[1-9]|10)$/;

function toApiLesson(lessonId: string) {
  const lesson = getLevel1Lesson(lessonId);
  const questions = getLevel1Quiz(lessonId);
  if (!lesson) return null;
  return {
    lesson: {
      id: lesson.id,
      level_number: lesson.levelNumber,
      lesson_number: lesson.lessonNumber,
      title: lesson.title,
      summary: lesson.summary,
      content: {
        objectives: lesson.objectives,
        sections: lesson.sections,
        terminology: lesson.terminology,
        example: lesson.example,
        commonMistakes: lesson.commonMistakes,
        professionalTips: lesson.professionalTips,
        exercises: lesson.exercises,
        takeaways: lesson.takeaways,
      },
    },
    questions: questions.map((question) => ({
      id: question.id,
      question_number: question.questionNumber,
      difficulty: question.difficulty,
      question_type: question.type,
      prompt: question.prompt,
      choices: question.choices,
      hint: question.hint,
      fen: question.fen,
      correctAnswer: question.correctAnswer,
    })),
  };
}

export async function GET(_request: Request, { params }: RouteContext) {
  let lessonId = '';
  try {
    ({ lessonId } = await params);
    if (!LESSON_ID_PATTERN.test(lessonId)) {
      return NextResponse.json({ error: 'Invalid Academy lesson ID' }, { status: 400 });
    }

    const localPayload = toApiLesson(lessonId);

    const admin = createAdminClient();
    const { data: lesson, error: lessonError } = await admin
      .from('academy_lessons')
      .select('id, level_number, lesson_number, title, summary, content')
      .eq('id', lessonId)
      .eq('published', true)
      .maybeSingle();

    if (lessonError) {
      console.error('Academy lesson lookup failed:', lessonError.message);
      if (localPayload) {
        return NextResponse.json({ ...localPayload, fallback: true });
      }
      return NextResponse.json({ error: 'Unable to load Academy lesson' }, { status: 500 });
    }
    if (!lesson) {
      if (localPayload) {
        return NextResponse.json({ ...localPayload, fallback: true });
      }
      return NextResponse.json({ error: 'Academy lesson not found' }, { status: 404 });
    }

    const { data: questions, error: questionsError } = await admin
      .from('academy_questions')
      .select('id, question_number, difficulty, question_type, prompt, choices, hint, fen, correct_answer')
      .eq('lesson_id', lessonId)
      .order('question_number', { ascending: true });

    if (questionsError) {
      console.error('Academy questions lookup failed:', questionsError.message);
      if (localPayload) {
        return NextResponse.json({ ...localPayload, fallback: true });
      }
      return NextResponse.json({ error: 'Unable to load Academy quiz' }, { status: 500 });
    }
    if (!questions || questions.length !== 20) {
      if (localPayload) {
        return NextResponse.json({ ...localPayload, fallback: true });
      }
      return NextResponse.json({ error: 'Academy quiz is not ready yet' }, { status: 503 });
    }

    return NextResponse.json({
      lesson,
      questions: (questions ?? []).map((question) => ({
        ...question,
        correctAnswer: question.correct_answer,
      })),
    });
  } catch (error) {
    console.error('Academy lesson request failed:', error);
    if (error instanceof SupabaseAdminConfigurationError) {
      const localPayload = lessonId ? toApiLesson(lessonId) : null;
      if (localPayload) return NextResponse.json({ ...localPayload, fallback: true });
      return NextResponse.json({ error: 'Academy database access is not configured.' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Unable to load Academy lesson' }, { status: 500 });
  }
}
