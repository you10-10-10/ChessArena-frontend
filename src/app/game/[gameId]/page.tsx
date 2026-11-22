'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { GameEngine } from '@/lib/chess/game';
import ChessBoard from '@/components/ChessBoard';
import { useI18n } from '@/lib/i18n/context';
import { supabase } from '@/lib/supabase/client';

interface GameResponse {
  id: string;
  whitePlayerId: string;
  blackPlayerId: string;
  status: 'waiting' | 'in_progress' | 'completed' | 'abandoned';
  result: string | null;
  whiteRatingChange: number | null;
  blackRatingChange: number | null;
  moves: string[];
  fen: string;
}

export default function GamePage() {
  const params = useParams();
  const gameIdParam = params?.gameId;
  const gameId = Array.isArray(gameIdParam) ? gameIdParam[0] : gameIdParam;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { tr } = useI18n();
  const [game, setGame] = useState<GameResponse | null>(null);
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const [isWhitePlayer, setIsWhitePlayer] = useState(true);
  const [loading, setLoading] = useState(true);
  const [savingMove, setSavingMove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGame = useCallback(async () => {
    if (authLoading) return;
    if (!user) {
      setError('Sign in with a game participant account to view this game.');
      setLoading(false);
      return;
    }
    if (!gameId) {
      setError('Invalid game URL.');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/games/${encodeURIComponent(gameId)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Unable to load game.');
      }

      const nextGame = payload as GameResponse;
      if (nextGame.whitePlayerId !== user.id && nextGame.blackPlayerId !== user.id) {
        throw new Error('You are not a participant in this game.');
      }
      const nextEngine = new GameEngine(nextGame.fen);
      setIsWhitePlayer(nextGame.whitePlayerId === user.id);
      setGame(nextGame);
      setEngine(current => current?.fen === nextEngine.fen ? current : nextEngine);
      setError(null);
    } catch (loadError) {
      const message = loadError instanceof TypeError
        ? 'Network error while loading the game. Check your connection and retry.'
        : loadError instanceof Error ? loadError.message : 'Unable to load game.';
      console.error('Game load request failed:', {
        endpoint: `/api/games/${gameId}`,
        gameId,
        userId: user?.id,
        stage: 'load_game',
        message,
      });
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [authLoading, gameId, user]);

  useEffect(() => {
    void loadGame();
    const poll = window.setInterval(() => {
      if (!savingMove && game?.status === 'in_progress') void loadGame();
    }, 2000);
    return () => window.clearInterval(poll);
  }, [game?.status, loadGame, savingMove]);

  const activeGameId = game?.id;
  const activeGameStatus = game?.status;

  useEffect(() => {
    if (!supabase || !activeGameId || activeGameStatus !== 'in_progress') return;
    const realtimeClient = supabase;

    const channel = realtimeClient
      .channel(`online-game:${activeGameId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${activeGameId}` },
        () => void loadGame(),
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('Game realtime subscription failed:', {
            gameId: activeGameId,
            userId: user?.id,
            status,
          });
        }
      });

    return () => {
      void realtimeClient.removeChannel(channel);
    };
  }, [activeGameId, activeGameStatus, loadGame, user?.id]);

  const handleMove = async (move: string) => {
    if (!game || savingMove || game.status !== 'in_progress') return;

    setSavingMove(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${encodeURIComponent(game.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move', move }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Unable to save move.');
      }
      await loadGame();
    } catch (moveError) {
      const message = moveError instanceof TypeError
        ? 'Network error while saving the move. Check your connection and retry.'
        : moveError instanceof Error ? moveError.message : 'Unable to save move.';
      console.error('Game move request failed:', {
        endpoint: `/api/games/${game.id}`,
        gameId: game.id,
        userId: user?.id,
        stage: 'save_move',
        message,
      });
      setError(message);
      await loadGame();
    } finally {
      setSavingMove(false);
    }
  };

  const handleResign = async () => {
    if (!game || game.status !== 'in_progress' || savingMove) return;
    if (!window.confirm(tr('Are you sure you want to resign this game?'))) return;

    setSavingMove(true);
    setError(null);
    try {
      const response = await fetch(`/api/games/${encodeURIComponent(game.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resign' }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Unable to resign.');
      }
      await loadGame();
    } catch (resignError) {
      const message = resignError instanceof TypeError
        ? 'Network error while resigning. Check your connection and retry.'
        : resignError instanceof Error ? resignError.message : 'Unable to resign.';
      console.error('Game resignation request failed:', {
        endpoint: `/api/games/${game.id}`,
        gameId: game.id,
        userId: user?.id,
        stage: 'resign_game',
        message,
      });
      setError(message);
    } finally {
      setSavingMove(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p role="status" className="text-text-secondary">{tr('Loading game…')}</p>
      </div>
    );
  }

  if (!game || !engine) {
    return (
      <div className="mx-auto max-w-xl rounded-xl bg-background-secondary p-8 text-center">
        <h1 className="text-2xl font-bold text-text-primary">{tr('Game unavailable')}</h1>
        <p role="alert" className="mt-3 text-red-300">{tr(error || 'This game could not be loaded.')}</p>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            setError(null);
            void loadGame();
          }}
          className="mt-6 rounded-lg border border-text-secondary/20 px-5 py-3 font-semibold text-text-primary hover:bg-background-tertiary"
        >
          {tr('Retry')}
        </button>
        <Link href="/play" className="mt-6 inline-block rounded-lg bg-accent px-5 py-3 font-semibold text-white">
          {tr('Back to Play')}
        </Link>
      </div>
    );
  }

  const resultLabel = game.result === 'white_wins'
    ? 'White wins'
    : game.result === 'black_wins'
      ? 'Black wins'
      : game.result === 'draw'
        ? 'Draw'
        : null;
  const myRatingChange = game.status === 'completed'
    ? isWhitePlayer ? game.whiteRatingChange : game.blackRatingChange
    : null;
  const ratingLabel = myRatingChange === null
    ? ''
    : ` · ${tr('Rating')} ${myRatingChange > 0 ? '+' : ''}${myRatingChange}`;

  return (
    <div className="mx-auto max-w-7xl p-4">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{tr('Game')} #{game.id.slice(0, 8)}</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {game.status === 'in_progress' ? tr('Moves sync with the game server.') : `${tr(resultLabel || game.status)}${ratingLabel}`}
          </p>
        </div>
        <Link href="/play" className="rounded-lg border border-text-secondary/20 px-4 py-2 text-text-primary hover:bg-background-secondary">
          {tr('Back to Lobby')}
        </Link>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          {tr(error)}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <ChessBoard
            key={`${game.id}-${isWhitePlayer ? 'white' : 'black'}`}
            engine={engine}
            onMove={handleMove}
            onReset={() => router.push('/play')}
            isWhitePlayer={isWhitePlayer}
            initialOrientation={isWhitePlayer ? 'white' : 'black'}
            allowReset={false}
            allowUndo={false}
            isInputEnabled={game.status === 'in_progress' && !savingMove}
          />
          {savingMove && <p role="status" className="mt-2 text-center text-sm text-text-secondary">{tr('Saving move…')}</p>}

          <div className="mt-6 rounded-lg border border-text-secondary/10 bg-background-secondary p-4">
            <h2 className="mb-3 font-semibold text-text-primary">{tr('Move History')}</h2>
            <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto font-mono text-sm">
              {engine.moveHistory.map((move, index) => (
                <div key={`${index}-${move.move}`} className="flex items-center gap-2">
                  <span className="w-8 text-end text-text-secondary">{Math.floor(index / 2) + 1}.</span>
                  <span className="text-text-primary">{move.move}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="rounded-lg border border-text-secondary/10 bg-background-secondary p-4">
            <h2 className="mb-4 font-semibold text-text-primary">{tr('Players')}</h2>
            <p className="rounded-lg bg-background-tertiary p-3 text-text-primary">
              {tr('White')} {game.whitePlayerId === user?.id ? `(${tr('you')})` : ''}
            </p>
            <p className="mt-3 rounded-lg bg-background-tertiary p-3 text-text-primary">
              {tr('Black')} {game.blackPlayerId === user?.id ? `(${tr('you')})` : ''}
            </p>
          </div>

          {game.status === 'in_progress' && (
            <div className="rounded-lg border border-text-secondary/10 bg-background-secondary p-4">
              <button
                onClick={handleResign}
                disabled={savingMove}
                className="w-full rounded-lg border border-red-500/30 bg-red-500/20 px-4 py-2 text-red-300 disabled:opacity-50"
              >
                {tr('Resign')}
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
