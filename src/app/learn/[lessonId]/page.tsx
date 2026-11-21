'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Lightbulb, LoaderCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { getBoardTheme } from '@/lib/boardThemes';

export const dynamic = 'force-dynamic';

type Language = 'en' | 'fr' | 'ar';
type LocalizedText = Record<Language, string>;
interface LessonContent {
  objectives: LocalizedText[];
  sections: Array<{ title: LocalizedText; paragraphs: LocalizedText[] }>;
  terminology: Array<{ term: LocalizedText; definition: LocalizedText }>;
  example: { fen: string; solutionMoves: string[]; annotation: LocalizedText };
  commonMistakes: LocalizedText[];
  professionalTips: LocalizedText[];
  exercises: LocalizedText[];
  takeaways: LocalizedText[];
}
interface AcademyLesson {
  id: string;
  level_number: number;
  lesson_number: number;
  title: LocalizedText;
  summary: LocalizedText;
  content: LessonContent;
}
interface QuizChoice {
  id: string;
  label: LocalizedText;
}
interface QuizQuestion {
  id: string;
  question_number: number;
  difficulty: 'easy' | 'medium' | 'hard';
  question_type: string;
  prompt: LocalizedText;
  choices: QuizChoice[];
  hint?: LocalizedText;
  fen?: string;
}
interface QuizReview {
  id: string;
  correctAnswer: string;
  explanation: LocalizedText;
  solutionMoves: string[];
  selectedAnswer: string;
  correct: boolean;
}
interface SubmissionResult {
  score: number;
  percentage: number;
  passed: boolean;
  xpEarned: number;
  byDifficulty: Record<'easy' | 'medium' | 'hard', { correct: number; total: number }>;
}

const copy = {
  en: {
    back: 'All lessons',
    loading: 'Loading lesson…',
    loadError: 'Unable to load this lesson. Confirm the Academy schema and lesson seed have been applied.',
    objectives: 'Learning objectives',
    theory: 'Lesson theory',
    vocabulary: 'Key terminology',
    example: 'Board demonstration',
    previous: 'Previous',
    next: 'Next section',
    mistakes: 'Common mistakes',
    tips: 'Coach’s tips',
    exercises: 'Practice exercises',
    takeaways: 'Key takeaways',
    startQuiz: 'Start the 20-question quiz',
    question: 'Question',
    of: 'of',
    hint: 'Show hint',
    hideHint: 'Hide hint',
    submit: 'Submit quiz',
    continue: 'Continue',
    submitting: 'Saving result…',
    result: 'Quiz results',
    passed: 'Lesson passed',
    failed: 'Keep practicing',
    score: 'Score',
    xp: 'XP earned',
    difficulty: 'Performance by difficulty',
    review: 'Answer review',
    yourAnswer: 'Your answer',
    correctAnswer: 'Correct answer',
    retry: 'Retry quiz',
    continueLearning: 'Continue learning',
    exampleBack: 'Previous move',
    exampleForward: 'Show next move',
    errorSubmit: 'Unable to save your result. Sign in and try again.',
    easy: 'Easy',
    medium: 'Medium',
    hard: 'Hard',
    type: 'Question type',
  },
  fr: {
    back: 'Toutes les leçons',
    loading: 'Chargement de la leçon…',
    loadError: 'Impossible de charger cette leçon. Vérifiez que le schéma Academy et les données ont été appliqués.',
    objectives: 'Objectifs pédagogiques',
    theory: 'Cours',
    vocabulary: 'Terminologie essentielle',
    example: 'Démonstration sur l’échiquier',
    previous: 'Précédent',
    next: 'Section suivante',
    mistakes: 'Erreurs fréquentes',
    tips: 'Conseils du coach',
    exercises: 'Exercices pratiques',
    takeaways: 'À retenir',
    startQuiz: 'Commencer le quiz de 20 questions',
    question: 'Question',
    of: 'sur',
    hint: 'Afficher un indice',
    hideHint: 'Masquer l’indice',
    submit: 'Envoyer le quiz',
    continue: 'Continuer',
    submitting: 'Enregistrement du résultat…',
    result: 'Résultats du quiz',
    passed: 'Leçon réussie',
    failed: 'Continuez à vous entraîner',
    score: 'Score',
    xp: 'XP gagnés',
    difficulty: 'Résultats par difficulté',
    review: 'Correction des réponses',
    yourAnswer: 'Votre réponse',
    correctAnswer: 'Bonne réponse',
    retry: 'Recommencer le quiz',
    continueLearning: 'Continuer l’apprentissage',
    exampleBack: 'Coup précédent',
    exampleForward: 'Coup suivant',
    errorSubmit: 'Impossible d’enregistrer le résultat. Connectez-vous et réessayez.',
    easy: 'Facile',
    medium: 'Moyen',
    hard: 'Difficile',
    type: 'Type de question',
  },
  ar: {
    back: 'كل الدروس',
    loading: 'جارٍ تحميل الدرس…',
    loadError: 'تعذّر تحميل الدرس. تأكد من تطبيق مخطط الأكاديمية وبيانات الدروس.',
    objectives: 'أهداف التعلّم',
    theory: 'شرح الدرس',
    vocabulary: 'مصطلحات أساسية',
    example: 'شرح على الرقعة',
    previous: 'السابق',
    next: 'القسم التالي',
    mistakes: 'أخطاء شائعة',
    tips: 'نصائح المدرب',
    exercises: 'تمارين عملية',
    takeaways: 'الخلاصة',
    startQuiz: 'ابدأ اختبار الأسئلة العشرين',
    question: 'السؤال',
    of: 'من',
    hint: 'أظهر تلميحاً',
    hideHint: 'أخفِ التلميح',
    submit: 'أرسل الاختبار',
    continue: 'تابع',
    submitting: 'جارٍ حفظ النتيجة…',
    result: 'نتيجة الاختبار',
    passed: 'اجتزت الدرس',
    failed: 'واصل التدريب',
    score: 'النتيجة',
    xp: 'نقاط الخبرة المكتسبة',
    difficulty: 'الأداء حسب الصعوبة',
    review: 'مراجعة الإجابات',
    yourAnswer: 'إجابتك',
    correctAnswer: 'الإجابة الصحيحة',
    retry: 'أعد الاختبار',
    continueLearning: 'تابع التعلّم',
    exampleBack: 'النقلة السابقة',
    exampleForward: 'النقلة التالية',
    errorSubmit: 'تعذّر حفظ النتيجة. سجّل الدخول ثم أعد المحاولة.',
    easy: 'سهل',
    medium: 'متوسط',
    hard: 'صعب',
    type: 'نوع السؤال',
  },
} as const;

function localized(value: LocalizedText | undefined, language: Language) {
  return value?.[language] ?? value?.en ?? '';
}

export default function LessonDetailPage() {
  const params = useParams<{ lessonId: string }>();
  const lessonId = params.lessonId;
  const { language } = useI18n();
  const labels = copy[language];
  const boardTheme = getBoardTheme();
  const [lesson, setLesson] = useState<AcademyLesson | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [examplePly, setExamplePly] = useState(0);
  const [quizMode, setQuizMode] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [hintVisible, setHintVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [review, setReview] = useState<QuizReview[]>([]);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    fetch(`/api/academy/lessons/${lessonId}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Lesson unavailable');
        setLesson(payload.lesson);
        setQuestions(payload.questions);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        setLoadError(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [lessonId]);

  const exampleFen = useMemo(() => {
    if (!lesson) return '';
    const chess = new Chess(lesson.content.example.fen);
    for (const move of lesson.content.example.solutionMoves.slice(0, examplePly)) chess.move(move);
    return chess.fen();
  }, [lesson, examplePly]);

  const currentQuestion = questions[questionIndex];
  const selectedAnswer = currentQuestion ? answers[currentQuestion.id] : undefined;

  function startQuiz() {
    setAnswers({});
    setQuestionIndex(0);
    setResult(null);
    setReview([]);
    setQuizMode(true);
    setSubmitError('');
    startedAt.current = Date.now();
  }

  async function submitQuiz() {
    if (!lesson || Object.keys(answers).length !== questions.length) return;
    setSubmitting(true);
    setSubmitError('');
    const durationSeconds = Math.min(86400, Math.max(0, Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000)));
    try {
      const response = await fetch(`/api/academy/lessons/${lesson.id}/quiz`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, durationSeconds }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || labels.errorSubmit);
      setResult(payload.result);
      setReview(payload.review);
      setQuizMode(false);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : labels.errorSubmit);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <main className="mx-auto max-w-4xl px-4 py-10 text-text-secondary" role="status">{labels.loading}</main>;
  }
  if (loadError || !lesson) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-10 text-text-primary">
        <p className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5" role="alert">{labels.loadError}</p>
        <Link href="/learn" className="mt-5 inline-flex items-center gap-2 text-accent hover:underline">
          <ArrowLeft className="h-4 w-4" /> {labels.back}
        </Link>
      </main>
    );
  }

  const section = lesson.content.sections[sectionIndex];
  const isLastSection = sectionIndex === lesson.content.sections.length - 1;
  const difficultyLabel = currentQuestion
    ? labels[currentQuestion.difficulty]
    : '';
  const supportingSections: Array<{ title: string; items: LocalizedText[] }> = [
    { title: labels.mistakes, items: lesson.content.commonMistakes },
    { title: labels.tips, items: lesson.content.professionalTips },
    { title: labels.exercises, items: lesson.content.exercises },
    { title: labels.takeaways, items: lesson.content.takeaways },
  ];

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 text-text-primary md:py-10">
      <Link href="/learn" className="mb-5 inline-flex items-center gap-2 text-sm text-text-secondary hover:text-accent">
        <ArrowLeft className="h-4 w-4" /> {labels.back}
      </Link>

      <header className="mb-6 rounded-2xl border border-text-secondary/15 bg-background-secondary p-5 md:p-7">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="rounded-full bg-accent/20 px-3 py-1 font-semibold text-accent">
            {lesson.level_number} · {lesson.lesson_number} / 10
          </span>
          <span className="text-text-secondary">{quizMode ? `${labels.question} ${questionIndex + 1} ${labels.of} ${questions.length}` : labels.theory}</span>
        </div>
        <h1 className="text-2xl font-bold md:text-3xl">{localized(lesson.title, language)}</h1>
        <p className="mt-2 leading-7 text-text-secondary">{localized(lesson.summary, language)}</p>
        {!quizMode && !result && (
          <div className="mt-5">
            <h2 className="mb-2 text-sm font-bold">{labels.objectives}</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {lesson.content.objectives.map((objective, index) => (
                <li key={index} className="flex items-start gap-2 text-sm text-text-secondary">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  {localized(objective, language)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>

      {result ? (
        <section className="space-y-5">
          <div className={`rounded-2xl border p-6 text-center ${result.passed ? 'border-green-500/30 bg-green-500/10' : 'border-accent/30 bg-accent/10'}`}>
            <h2 className="text-2xl font-bold">{result.passed ? labels.passed : labels.failed}</h2>
            <p className="mt-3 text-lg">{labels.score}: <strong>{result.score}/20 · {result.percentage}%</strong></p>
            <p className="mt-1 text-sm text-text-secondary">{labels.xp}: {result.xpEarned}</p>
            <div className="mx-auto mt-5 grid max-w-xl grid-cols-3 gap-3 text-sm">
              {(['easy', 'medium', 'hard'] as const).map((difficulty) => (
                <div key={difficulty} className="rounded-xl bg-background-secondary p-3">
                  <p className="text-text-secondary">{labels[difficulty]}</p>
                  <p className="mt-1 font-bold">{result.byDifficulty[difficulty].correct}/{result.byDifficulty[difficulty].total}</p>
                </div>
              ))}
            </div>
          </div>

          <section className="rounded-2xl border border-text-secondary/15 bg-background-secondary p-5 md:p-7">
            <h2 className="mb-4 text-xl font-bold">{labels.review}</h2>
            <ol className="space-y-3">
              {review.map((item, index) => (
                <li key={item.id} className="rounded-xl border border-text-secondary/10 bg-background-tertiary p-4">
                  <div className="flex items-start gap-3">
                    {item.correct
                      ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-400" />
                      : <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-xs text-red-300">!</span>}
                    <div>
                      <p className="font-semibold">{labels.question} {index + 1}: {localized(questions[index]?.prompt, language)}</p>
                      <p className="mt-2 text-sm">
                        <span className={item.correct ? 'text-green-300' : 'text-red-300'}>
                          {labels.yourAnswer}: {localized(questions[index]?.choices.find((choice) => choice.id === item.selectedAnswer)?.label, language) || item.selectedAnswer}
                        </span>
                      </p>
                      {!item.correct && (
                        <p className="mt-1 text-sm text-green-300">
                          {labels.correctAnswer}: {localized(questions[index]?.choices.find((choice) => choice.id === item.correctAnswer)?.label, language) || item.correctAnswer}
                        </p>
                      )}
                      <p className="mt-1 text-sm text-text-secondary">{localized(item.explanation, language)}</p>
                      {item.solutionMoves.length > 0 && (
                        <p className="mt-2 font-mono text-sm text-accent">{item.solutionMoves.join(' ')}</p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <div className="flex flex-wrap gap-3">
            <button onClick={startQuiz} className="rounded-xl bg-accent px-5 py-3 font-semibold text-white hover:bg-accent-hover">
              {labels.retry}
            </button>
            {result.passed && lesson.lesson_number < 10 && (
              <Link
                href={`/learn/l${lesson.level_number}-${String(lesson.lesson_number + 1).padStart(2, '0')}`}
                className="rounded-xl border border-green-500/30 bg-green-500/10 px-5 py-3 font-semibold text-green-300"
              >
                {labels.next} · {labels.continueLearning}
              </Link>
            )}
            <Link href="/learn" className="rounded-xl border border-text-secondary/20 px-5 py-3 font-semibold hover:bg-background-secondary">
              {labels.continueLearning}
            </Link>
          </div>
        </section>
      ) : quizMode && currentQuestion ? (
        <section className="rounded-2xl border border-text-secondary/15 bg-background-secondary p-5 md:p-7">
          <div className="mb-5 flex items-center justify-between gap-3">
            <span className="font-semibold">{labels.question} {questionIndex + 1} {labels.of} {questions.length}</span>
            <span className="rounded-full bg-background-tertiary px-3 py-1 text-xs font-semibold">{difficultyLabel}</span>
          </div>
          <div className="mb-5 h-2 overflow-hidden rounded-full bg-background-tertiary">
            <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${((questionIndex + 1) / questions.length) * 100}%` }} />
          </div>
          <h2 className="text-xl font-bold leading-relaxed">{localized(currentQuestion.prompt, language)}</h2>
          {currentQuestion.fen && (
            <div className="mx-auto my-6 w-full max-w-[460px]" dir="ltr">
              <Chessboard options={{
                position: currentQuestion.fen,
                allowDragging: false,
                boardStyle: { width: '100%', borderRadius: '8px' },
                lightSquareStyle: { backgroundColor: boardTheme.light },
                darkSquareStyle: { backgroundColor: boardTheme.dark },
              }} />
            </div>
          )}
          <div className="mt-6 grid gap-3">
            {currentQuestion.choices.map((choice, index) => (
              <button
                key={choice.id}
                onClick={() => setAnswers((previous) => ({ ...previous, [currentQuestion.id]: choice.id }))}
                aria-pressed={selectedAnswer === choice.id}
                className={`flex items-center gap-3 rounded-xl border p-4 text-start transition-colors ${
                  selectedAnswer === choice.id
                    ? 'border-accent bg-accent/15'
                    : 'border-text-secondary/15 bg-background-tertiary hover:border-accent/50'
                }`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-text-secondary/20 text-xs font-bold">
                  {String.fromCharCode(65 + index)}
                </span>
                <span>{localized(choice.label, language)}</span>
              </button>
            ))}
          </div>
          {currentQuestion.hint && (
            <div className="mt-4">
              <button onClick={() => setHintVisible((visible) => !visible)} className="inline-flex items-center gap-2 text-sm text-accent hover:underline">
                <Lightbulb className="h-4 w-4" />
                {hintVisible ? labels.hideHint : labels.hint}
              </button>
              {hintVisible && <p className="mt-2 rounded-xl bg-background-tertiary p-3 text-sm text-text-secondary">{localized(currentQuestion.hint, language)}</p>}
            </div>
          )}
          {submitError && <p className="mt-4 text-sm text-red-300" role="alert">{submitError}</p>}
          <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-text-secondary/10 pt-5">
            <button
              onClick={() => {
                setQuestionIndex((index) => Math.max(0, index - 1));
                setHintVisible(false);
              }}
              disabled={questionIndex === 0 || submitting}
              className="inline-flex items-center gap-2 rounded-xl border border-text-secondary/20 px-4 py-2.5 text-sm disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> {labels.previous}
            </button>
            {questionIndex < questions.length - 1 ? (
              <button
                onClick={() => {
                  setQuestionIndex((index) => index + 1);
                  setHintVisible(false);
                }}
                disabled={!selectedAnswer || submitting}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {labels.continue} <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={() => void submitQuiz()}
                disabled={!selectedAnswer || submitting || Object.keys(answers).length !== questions.length}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              >
                {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {submitting ? labels.submitting : labels.submit}
                {!submitting && <ArrowRight className="h-4 w-4" />}
              </button>
            )}
          </div>
        </section>
      ) : (
        <div className="space-y-5">
          <section className="rounded-2xl border border-text-secondary/15 bg-background-secondary p-5 md:p-7">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold">{labels.theory}: {localized(section.title, language)}</h2>
              <span className="text-sm text-text-secondary">{sectionIndex + 1} / {lesson.content.sections.length}</span>
            </div>
            <div className="space-y-4 text-base leading-8 text-text-primary">
              {section.paragraphs.map((paragraph, index) => <p key={index}>{localized(paragraph, language)}</p>)}
            </div>
          </section>

          <section className="rounded-2xl border border-text-secondary/15 bg-background-secondary p-5 md:p-7">
            <h2 className="mb-4 text-xl font-bold">{labels.vocabulary}</h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              {lesson.content.terminology.map((item, index) => (
                <div key={index} className="rounded-xl bg-background-tertiary p-4">
                  <dt className="font-bold text-accent">{localized(item.term, language)}</dt>
                  <dd className="mt-1 text-sm leading-6 text-text-secondary">{localized(item.definition, language)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="rounded-2xl border border-text-secondary/15 bg-background-secondary p-5 md:p-7">
            <h2 className="mb-4 text-xl font-bold">{labels.example}</h2>
            <p className="mb-4 leading-7 text-text-secondary">{localized(lesson.content.example.annotation, language)}</p>
            <div className="mx-auto w-full max-w-[480px]" dir="ltr">
              <Chessboard options={{
                position: exampleFen,
                allowDragging: false,
                boardStyle: { width: '100%', borderRadius: '8px' },
                lightSquareStyle: { backgroundColor: boardTheme.light },
                darkSquareStyle: { backgroundColor: boardTheme.dark },
              }} />
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => setExamplePly((ply) => Math.max(0, ply - 1))}
                disabled={examplePly === 0}
                className="rounded-xl border border-text-secondary/20 px-4 py-2 text-sm disabled:opacity-40"
              >
                {labels.exampleBack}
              </button>
              <span className="font-mono text-sm text-accent">{lesson.content.example.solutionMoves.slice(0, examplePly).join(' ') || '—'}</span>
              <button
                onClick={() => setExamplePly((ply) => Math.min(lesson.content.example.solutionMoves.length, ply + 1))}
                disabled={examplePly === lesson.content.example.solutionMoves.length}
                className="rounded-xl border border-text-secondary/20 px-4 py-2 text-sm disabled:opacity-40"
              >
                {labels.exampleForward}
              </button>
            </div>
          </section>

          {isLastSection && (
            <>
              {supportingSections.map(({ title, items }) => (
                <section key={title} className="rounded-2xl border border-text-secondary/15 bg-background-secondary p-5 md:p-7">
                  <h2 className="mb-3 text-xl font-bold">{title}</h2>
                  <ul className="space-y-2 text-sm leading-6 text-text-secondary">
                    {items.map((item, index) => (
                      <li key={index} className="flex gap-2">
                        <span className="font-bold text-accent">•</span>
                        <span>{localized(item, language)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              <button onClick={startQuiz} className="w-full rounded-2xl bg-accent px-5 py-4 font-bold text-white shadow-lg shadow-accent/20 hover:bg-accent-hover">
                {labels.startQuiz}
              </button>
            </>
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => setSectionIndex((index) => Math.max(0, index - 1))}
              disabled={sectionIndex === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-text-secondary/20 px-4 py-2.5 text-sm disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> {labels.previous}
            </button>
            {!isLastSection && (
              <button
                onClick={() => setSectionIndex((index) => Math.min(lesson.content.sections.length - 1, index + 1))}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white"
              >
                {labels.next} <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
