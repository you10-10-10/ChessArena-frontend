'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import ChessBoard from '@/components/ChessBoard';
import { GameEngine } from '@/lib/chess/game';
import { supabase } from '@/lib/supabase/client';
import { useI18n } from '@/lib/i18n/context';

interface Puzzle {
  id: string;
  fen: string;
  rating: number;
  category: string | null;
  difficulty: string | null;
}

const FALLBACK_PUZZLES: Puzzle[] = [
  { id: '00000000-0000-4000-8000-000000000001', fen: '7k/8/5KQ1/8/8/8/8/8 w - - 0 1', rating: 800, category: 'Checkmate', difficulty: 'Beginner' },
  { id: '00000000-0000-4000-8000-000000000002', fen: '6k1/5ppp/8/8/8/5Q2/5PPP/6K1 w - - 0 1', rating: 900, category: 'Checkmate', difficulty: 'Beginner' },
];


async function savePuzzleProgress(puzzleId: string, moves: string[], failedAttempts: number) {
  const response = await fetch(`/api/puzzles/${puzzleId}/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ moves, failedAttempts }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error || 'Unable to save puzzle progress.');
  }
}

export default function PuzzlesPage() {
  const { user } = useAuth();
  const { tr } = useI18n();
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [currentPuzzleIndex, setCurrentPuzzleIndex] = useState(0);
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const [solutionMoves, setSolutionMoves] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'correct' | 'incorrect'; message: string } | null>(null);
  const [isCompleted, setIsCompleted] = useState(false);
  const [solvedThisSession, setSolvedThisSession] = useState(0);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadPuzzles = useCallback(async () => {
    setLoading(true);
    setError(null);
    if (!supabase) {
      setPuzzles(FALLBACK_PUZZLES);
      setCurrentPuzzleIndex(0);
      setEngine(new GameEngine(FALLBACK_PUZZLES[0].fen));
      setSolutionMoves([]);
      setFeedback(null);
      setIsCompleted(false);
      setLoading(false);
      return;
    }

    try {
      const { data, error: queryError } = await supabase
        .from('puzzles')
        .select('id, fen, rating, category, difficulty')
        .order('rating', { ascending: true })
        .limit(50);
      if (queryError) throw queryError;
      const source = (data ?? []).length > 0 ? data : FALLBACK_PUZZLES;
      const loaded = source.map((puzzle) => {
        if (typeof puzzle.fen !== 'string') {
          throw new Error(`Puzzle ${puzzle.id} has invalid position data.`);
        }
        return {
          id: puzzle.id,
          fen: puzzle.fen,
          rating: puzzle.rating,
          category: puzzle.category,
          difficulty: puzzle.difficulty,
        };
      });

      setPuzzles(loaded);
      setCurrentPuzzleIndex(0);
      setEngine(loaded.length ? new GameEngine(loaded[0].fen) : null);
      setSolutionMoves([]);
      setFeedback(null);
      setIsCompleted(false);
    } catch (loadError) {
      console.error('Unable to load puzzles:', loadError);
      setPuzzles(FALLBACK_PUZZLES);
      setCurrentPuzzleIndex(0);
      setEngine(new GameEngine(FALLBACK_PUZZLES[0].fen));
      setSolutionMoves([]);
      setFeedback(null);
      setIsCompleted(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPuzzles();
  }, [loadPuzzles]);

  const currentPuzzle = puzzles[currentPuzzleIndex];

  const handleMove = async () => {
    if (!engine || !currentPuzzle || isCompleted || isSubmitting) return;
    const playedMove = engine.moveHistory.at(-1)?.move;
    if (!playedMove) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/puzzles/${currentPuzzle.id}/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move', history: solutionMoves, move: playedMove }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Unable to verify puzzle move.');
      }
      if (!result.correct) {
        const restored = new GameEngine(currentPuzzle.fen);
        for (const move of solutionMoves) {
          const replayResult = restored.move(move);
          if (!replayResult.success) {
            throw new Error('The saved puzzle position is out of sync.');
          }
        }
        setEngine(restored);
        setFailedAttempts((attempts) => attempts + 1);
        setFeedback({ type: 'incorrect', message: 'That move is not part of the solution. Try again.' });
        return;
      }

      if (!Array.isArray(result.moves) || !result.moves.every((move: unknown) => typeof move === 'string')) {
        throw new Error('The puzzle service returned invalid move data.');
      }
      if (result.reply) {
        const replyResult = engine.move(result.reply);
        if (!replyResult.success) {
          throw new Error('The puzzle service returned an illegal reply.');
        }
      }

      const acceptedMoves = result.moves as string[];
      setSolutionMoves(acceptedMoves);
      setFeedback({ type: 'correct', message: 'Correct move.' });

      if (result.solved) {
        setIsCompleted(true);
        setSolvedThisSession((count) => count + 1);
        if (user) {
          try {
            await savePuzzleProgress(currentPuzzle.id, acceptedMoves, failedAttempts);
          } catch (saveError) {
            console.error('Unable to save puzzle progress:', saveError);
            setError(saveError instanceof Error
              ? `Solved locally, but progress was not saved: ${saveError.message}`
              : 'Solved locally, but progress was not saved.');
          }
        }
        setFeedback({ type: 'correct', message: 'Puzzle solved.' });
      }
    } catch (moveError) {
      console.error('Unable to verify puzzle move:', moveError);
      setError(moveError instanceof Error ? moveError.message : 'Unable to verify puzzle move.');
      const restored = new GameEngine(currentPuzzle.fen);
      for (const move of solutionMoves) {
        const replayResult = restored.move(move);
        if (!replayResult.success) break;
      }
      setEngine(restored);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    if (!currentPuzzle) return;
    setEngine(new GameEngine(currentPuzzle.fen));
    setSolutionMoves([]);
    setFeedback(null);
    setIsCompleted(false);
    setFailedAttempts(0);
    setError(null);
  };

  const handleHint = async () => {
    if (!currentPuzzle) return;
    try {
      const response = await fetch(`/api/puzzles/${currentPuzzle.id}/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'hint', history: solutionMoves }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load a hint.');
      setFeedback(result.move
        ? { type: 'correct', message: `${tr('Hint')}: ${result.move}` }
        : { type: 'incorrect', message: tr('No further hint is available.') });
    } catch (hintError) {
      console.error('Unable to load puzzle hint:', hintError);
      setError(hintError instanceof Error ? hintError.message : 'Unable to load a hint.');
    }
  };

  const handleNextPuzzle = () => {
    if (currentPuzzleIndex >= puzzles.length - 1) return;
    const nextIndex = currentPuzzleIndex + 1;
    setCurrentPuzzleIndex(nextIndex);
    setEngine(new GameEngine(puzzles[nextIndex].fen));
    setSolutionMoves([]);
    setFeedback(null);
    setIsCompleted(false);
    setFailedAttempts(0);
    setError(null);
  };

  const handleRetryProgress = async () => {
    if (!user || !currentPuzzle) return;
    try {
      await savePuzzleProgress(currentPuzzle.id, solutionMoves, failedAttempts);
      setError(null);
    } catch (saveError) {
      console.error('Unable to retry puzzle progress save:', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Unable to save puzzle progress.');
    }
  };

  if (loading) {
    return <p role="status" className="p-8 text-center text-text-secondary">{tr('Loading puzzles…')}</p>;
  }

  return (
    <div className="mx-auto max-w-7xl p-0 sm:p-4">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">{tr('Chess Puzzles')}</h1>
          <p className="mt-1 text-sm text-text-secondary sm:text-base">{tr('Solve curated positions from the puzzle database.')}</p>
        </div>
        <p className="text-sm text-text-secondary">{tr('Solved this session:')} <strong className="text-accent">{solvedThisSession}</strong></p>
      </header>

      {error && <div role="alert" className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300">{tr(error)}</div>}
      {user && isCompleted && error && (
        <button
          onClick={() => void handleRetryProgress()}
          className="mb-4 rounded-lg bg-accent px-4 py-2 font-semibold text-white"
        >
          {tr('Retry saving progress')}
        </button>
      )}

      {!currentPuzzle || !engine ? (
        <div className="rounded-xl bg-background-secondary p-5 text-center sm:p-8">
          <p className="text-text-secondary">
            {tr(error ? 'Puzzle data could not be loaded.' : 'No puzzles are available yet.')}
          </p>
          {!error && (
            <p className="mt-2 text-sm text-text-secondary">
              {tr('Run sql/fix_matchmaking_and_seed_puzzles.sql in the Supabase SQL Editor to load the puzzle set.')}
            </p>
          )}
          <button
            type="button"
            onClick={() => void loadPuzzles()}
            className="mt-4 rounded-lg bg-accent px-4 py-2 font-semibold text-white hover:bg-accent-hover"
          >
            {tr('Retry')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
          <section className="min-w-0 rounded-xl bg-background-secondary p-0 sm:p-4 lg:col-span-2">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-text-primary sm:text-lg">
                {currentPuzzle.category || tr('Puzzle')} · {currentPuzzle.difficulty || tr('Unrated difficulty')}
              </h2>
              <span className="text-sm text-text-secondary">{tr('Rating')}: {currentPuzzle.rating}</span>
            </div>
            <div className="flex justify-center">
              <ChessBoard
                key={currentPuzzle.id}
                engine={engine}
                onMove={() => void handleMove()}
                onReset={handleReset}
                isWhitePlayer={currentPuzzle.fen.split(' ')[1] === 'w'}
                initialOrientation={currentPuzzle.fen.split(' ')[1] === 'w' ? 'white' : 'black'}
                allowReset={false}
                allowUndo={false}
                showMoveHistory={false}
                showPlayerInfo={false}
                isInputEnabled={!isCompleted && !isSubmitting}
              />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-center sm:gap-3">
              <button onClick={handleReset} className="rounded-lg border border-text-secondary/20 px-4 py-2 text-text-primary">
                {tr('Reset puzzle')}
              </button>
              <button onClick={() => void handleHint()} disabled={isCompleted || isSubmitting} className="rounded-lg border border-yellow-500/30 px-4 py-2 text-yellow-300 disabled:opacity-50">
                {tr('Hint')}
              </button>
              <button
                onClick={handleNextPuzzle}
                disabled={!isCompleted || currentPuzzleIndex >= puzzles.length - 1}
                className="col-span-2 rounded-lg bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50 sm:col-span-1"
              >
                {tr('Next puzzle')}
              </button>
            </div>
            {feedback && (
              <p role="status" className={`mt-4 rounded-lg p-3 text-center ${
                feedback.type === 'correct' ? 'bg-green-500/10 text-green-300' : 'bg-red-500/10 text-red-300'
              }`}>
                {tr(feedback.message)}
              </p>
            )}
          </section>

          <aside className="rounded-xl bg-background-secondary p-4 sm:p-6">
            <h2 className="mb-4 text-xl font-bold text-text-primary">{tr('Puzzle details')}</h2>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between border-b border-text-secondary/10 pb-2">
                <dt className="text-text-secondary">{tr('Rating')}</dt>
                <dd className="font-bold text-accent">{currentPuzzle.rating}</dd>
              </div>
              <div className="flex justify-between border-b border-text-secondary/10 pb-2">
                <dt className="text-text-secondary">{tr('Category')}</dt>
                <dd className="text-text-primary">{currentPuzzle.category || tr('Not specified')}</dd>
              </div>
              <div className="flex justify-between border-b border-text-secondary/10 pb-2">
                <dt className="text-text-secondary">{tr('Difficulty')}</dt>
                <dd className="text-text-primary">{currentPuzzle.difficulty || tr('Not specified')}</dd>
              </div>
            </dl>
            {!user && <p className="mt-4 text-xs text-text-secondary">{tr('Sign in to save solved-puzzle progress.')}</p>}
          </aside>
        </div>
      )}
    </div>
  );
}
