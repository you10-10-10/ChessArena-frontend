'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/context';
import ChessBoard from '@/components/ChessBoard';
import PlayAFriendModal from '@/components/PlayAFriendModal';
import { chooseStockfishMove } from '@/lib/chess/stockfishBot';
import {
  BOT_PROFILE_NAME_KEYS,
  BOT_TIME_CONTROLS,
  getBotProfile,
  type BotFormat,
  type BotProfileId,
} from '@/lib/chess/botProfiles';
import { saveBotGame, type BotGameRecord } from '@/lib/chess/botGameHistory';
import { getCurrentTimeMs, parseTimeControl } from '@/lib/utils';
import {
  getStockfishClient,
  resetStockfishClient,
  type StockfishProgress,
} from '@/lib/chess/stockfishClient';
import { createGame, GameEngine } from '@/lib/chess/game';
import { Bot, User, ArrowLeft, RotateCcw, UserPlus, History } from 'lucide-react';
import type { TranslationKey } from '@/lib/i18n/translations';

const TIME_CONTROLS = ['1+0', '3+0', '3+2', '5+0', '10+0', '10+5', '15+10'];
const FORMAT_KEYS: Record<BotFormat, TranslationKey> = {
  bullet: 'formatBullet',
  blitz: 'formatBlitz',
  rapid: 'formatRapid',
  classical: 'formatClassical',
};

type MatchStatus = 'idle' | 'queued';
type LocalOpponent = 'bot' | 'hotseat';
type Clocks = { w: number; b: number };

function getInitialBotFormat(value: string | null): BotFormat {
  return value === 'bullet' || value === 'blitz' || value === 'rapid' || value === 'classical'
    ? value
    : 'blitz';
}

function getInitialTimeControl(value: string | null, format: BotFormat): string {
  return value && BOT_TIME_CONTROLS[format].includes(value)
    ? value
    : BOT_TIME_CONTROLS[format][0] ?? '3+0';
}

function PlayContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();

  const modeParam = searchParams.get('mode');
  const botParam = searchParams.get('bot');
  const initialFormat = getInitialBotFormat(searchParams.get('format'));
  const initialTimeControl = modeParam === 'bot'
    ? getInitialTimeControl(searchParams.get('tc'), initialFormat)
    : '3+2';
  const initialBotId: BotProfileId = getBotProfile(botParam)?.id ?? 'casual';

  const [gameEngine, setGameEngine] = useState<GameEngine | null>(() => createGame());
  const [mode, setMode] = useState<'online' | 'local'>(modeParam === 'bot' ? 'local' : 'online');
  const [localOpponent, setLocalOpponent] = useState<LocalOpponent>(modeParam === 'bot' ? 'bot' : 'bot');
  const [humanColor, setHumanColor] = useState<'w' | 'b'>(() => searchParams.get('color') === 'b' ? 'b' : 'w');
  const [botDifficulty, setBotDifficulty] = useState<BotProfileId>(initialBotId);
  const { t, tr } = useI18n();
  const botName = t(BOT_PROFILE_NAME_KEYS[botDifficulty]);
  const botElo = getBotProfile(botDifficulty)?.elo ?? 1000;
  const [botThinking, setBotThinking] = useState(false);
  const botRequestRef = useRef(0);
  const [timeControl, setTimeControl] = useState(initialTimeControl);
  const format = initialFormat;
  const initialSeconds = parseTimeControl(initialTimeControl).initial;
  const [clocks, setClocks] = useState<Clocks>({ w: initialSeconds, b: initialSeconds });
  const clocksRef = useRef<Clocks>({ w: initialSeconds, b: initialSeconds });
  const lastClockTickRef = useRef(0);
  const gameStartedAtRef = useRef(0);
  const gameCompletionRef = useRef(false);
  const [finishedGame, setFinishedGame] = useState<BotGameRecord | null>(null);
  const [timeoutWinner, setTimeoutWinner] = useState<'white_wins' | 'black_wins' | null>(null);
  const [engineProgress, setEngineProgress] = useState<StockfishProgress | null>(null);
  const [engineLoaded, setEngineLoaded] = useState(false);
  const [engineRetryKey, setEngineRetryKey] = useState(0);
  const [matchStatus, setMatchStatus] = useState<MatchStatus>('idle');
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isPlayAFriendOpen, setIsPlayAFriendOpen] = useState(false);
  const [incomingInvitesCount, setIncomingInvitesCount] = useState(0);
  const initialBotTurnStartedRef = useRef(false);
  const runBotTurnRef = useRef<((engine: GameEngine, color: 'w' | 'b', difficulty: BotProfileId) => Promise<void>) | null>(null);
  const finishLocalGameRef = useRef<((engine: GameEngine, result: 'white_wins' | 'black_wins' | 'draw', reason: 'checkmate' | 'draw' | 'timeout') => void) | null>(null);
  const effectiveMode = !authLoading && !user ? 'local' : mode;

  const engineFailureMessage = t('botEngineFailure');
  useEffect(() => {
    if (effectiveMode !== 'local' || localOpponent !== 'bot') return;
    let active = true;
    const profile = getBotProfile(botDifficulty);
    setEngineLoaded(false);
    setError(null);
    setEngineProgress({ loadedBytes: 0, totalBytes: null, phase: 'engine' });
    void getStockfishClient((progress) => {
      if (active) setEngineProgress(progress);
    }).then(async (client) => {
      if (!profile) throw new Error(`Unknown computer opponent: ${botDifficulty}.`);
      await client.configure(profile);
      if (active) {
        setEngineLoaded(true);
        setEngineProgress(null);
      }
    }).catch((engineError: unknown) => {
      if (active) {
        resetStockfishClient();
        setEngineProgress(null);
        setError(engineError instanceof Error ? engineError.message : engineFailureMessage);
      }
    });
    return () => {
      active = false;
    };
  }, [
    botDifficulty,
    effectiveMode,
    engineFailureMessage,
    engineRetryKey,
    localOpponent,
  ]);

  // Poll for incoming invitations count badge
  useEffect(() => {
    if (!user) return;
    let active = true;
    const checkInvites = async () => {
      try {
        const response = await fetch('/api/invitations', { cache: 'no-store' });
        const payload = await response.json();
        if (active && response.ok) {
          setIncomingInvitesCount((payload.received || []).length);
        }
      } catch {
        // silent
      }
    };
    void checkInvites();
    const interval = setInterval(() => void checkInvites(), 4000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [user]);

  useEffect(() => {
    if (!user || matchStatus !== 'queued') return;

    let active = true;
    const checkMatch = async () => {
      try {
        const response = await fetch('/api/matchmaking', { cache: 'no-store' });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(typeof payload.error === 'string' ? payload.error : 'Unable to check matchmaking.');
        }
        if (active && payload.status === 'matched' && typeof payload.gameId === 'string') {
          setMatchStatus('idle');
          router.push(`/game/${encodeURIComponent(payload.gameId)}`);
        } else if (active && payload.status === 'idle') {
          setMatchStatus('idle');
        }
      } catch (pollError) {
        if (active) {
          setError(pollError instanceof Error ? pollError.message : 'Unable to check matchmaking.');
        }
      }
    };

    const intervalId = window.setInterval(() => void checkMatch(), 2000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [matchStatus, router, user]);

  function finishLocalGame(
    engine: GameEngine,
    resultCode: 'white_wins' | 'black_wins' | 'draw',
    endReason: 'checkmate' | 'draw' | 'timeout',
  ) {
    if (gameCompletionRef.current || localOpponent !== 'bot') return;
    gameCompletionRef.current = true;
    if (endReason === 'timeout') setTimeoutWinner(resultCode === 'draw' ? null : resultCode);
    const sanMoves = engine.moveHistory.map((move) => move.move);
    const uciMoves = engine.moveHistory.map((move) =>
      `${move.from}${move.to}${move.promotion ?? ''}`,
    );
    const playerWon = resultCode === (humanColor === 'w' ? 'white_wins' : 'black_wins');
    const record: BotGameRecord = {
      id: globalThis.crypto.randomUUID(),
      botId: botDifficulty,
      botElo,
      format,
      timeControl,
      playerColor: humanColor,
      result: resultCode === 'draw' ? 'draw' : playerWon ? 'win' : 'loss',
      endReason,
      playedAt: new Date().toISOString(),
      durationSeconds: Math.max(0, Math.floor((getCurrentTimeMs() - gameStartedAtRef.current) / 1000)),
      pgn: `${sanMoves.map((move, index) => index % 2 === 0 ? `${Math.floor(index / 2) + 1}. ${move}` : move).join(' ')} ${resultCode === 'draw' ? '1/2-1/2' : resultCode === 'white_wins' ? '1-0' : '0-1'}`.trim(),
      uciMoves,
      sanMoves,
    };
    setFinishedGame(record);
    try {
      saveBotGame(record);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The game finished, but its history could not be saved.');
    }
  }

  async function runBotTurn(engine: GameEngine, playerColor: 'w' | 'b', difficulty: BotProfileId) {
    const requestId = ++botRequestRef.current;
    setBotThinking(true);
    setEngineProgress(null);
    setError(null);
    try {
      const botColor = playerColor === 'w' ? 'b' : 'w';
      const move = await chooseStockfishMove({
        fen: engine.fen,
        color: botColor,
        profileId: difficulty,
        format,
        moveHistory: engine.moveHistory.map((item) =>
          `${item.from}${item.to}${item.promotion ?? ''}`,
        ),
        isCancelled: () => botRequestRef.current !== requestId,
        onProgress: (progress) => {
          setEngineProgress(progress);
        },
      });
      if (botRequestRef.current !== requestId) return;
      if (!move) {
        if (!engine.gameOver) setError(t('botEngineFailure'));
        return;
      }

      const result = engine.moveFromSquares(move.from, move.to, move.promotion);
      if (!result.success) {
        setError('Stockfish returned an illegal move. Start a new game to continue.');
        return;
      }
      handleGameMove(engine);
    } catch (botError) {
      if (botRequestRef.current === requestId) {
        console.error('Computer move search failed:', botError);
        setError(botError instanceof Error ? botError.message : t('botEngineFailure'));
      }
    } finally {
      if (botRequestRef.current === requestId) setBotThinking(false);
    }
  }

  function handleGameMove(engine: GameEngine) {
    const movedColor = engine.turn === 'w' ? 'b' : 'w';
    const increment = parseTimeControl(timeControl).increment;
    const updatedClocks = {
      ...clocksRef.current,
      [movedColor]: clocksRef.current[movedColor] + increment,
    };
    clocksRef.current = updatedClocks;
    setClocks(updatedClocks);
    lastClockTickRef.current = getCurrentTimeMs();

    if (engine.gameOver) {
      const result = engine.result ?? 'draw';
      finishLocalGame(engine, result, result === 'draw' ? 'draw' : 'checkmate');
      return;
    }
    if (localOpponent === 'bot' && engine.turn !== humanColor) {
      void runBotTurn(engine, humanColor, botDifficulty);
    }
  }

  const handleLocalMove = () => {
    if (gameEngine) handleGameMove(gameEngine);
  };

  const startLocalGame = (
    opponent: LocalOpponent,
    color: 'w' | 'b' = humanColor,
    difficulty: BotProfileId = botDifficulty,
  ) => {
    botRequestRef.current += 1;
    setLocalOpponent(opponent);
    setHumanColor(color);
    setBotDifficulty(difficulty);
    setError(null);
    setBotThinking(false);
    if (engineLoaded || opponent !== 'bot') setEngineProgress(null);
    setFinishedGame(null);
    setTimeoutWinner(null);
    gameCompletionRef.current = false;
    gameStartedAtRef.current = opponent === 'bot' ? 0 : getCurrentTimeMs();
    lastClockTickRef.current = getCurrentTimeMs();
    const initialTime = parseTimeControl(timeControl).initial;
    const nextClocks = { w: initialTime, b: initialTime };
    clocksRef.current = nextClocks;
    setClocks(nextClocks);
    const newGame = createGame();
    setGameEngine(newGame);
    initialBotTurnStartedRef.current = false;
    if (opponent === 'bot' && color === 'b' && engineLoaded) {
      initialBotTurnStartedRef.current = true;
      void runBotTurn(newGame, color, difficulty);
    }
  };

  useEffect(() => {
    runBotTurnRef.current = runBotTurn;
    finishLocalGameRef.current = finishLocalGame;
  });

  useEffect(() => {
    if (
      modeParam !== 'bot'
      || humanColor !== 'b'
      || !engineLoaded
      || !gameEngine
      || gameEngine.moveHistory.length > 0
      || initialBotTurnStartedRef.current
    ) {
      return;
    }
    initialBotTurnStartedRef.current = true;
    void runBotTurnRef.current?.(gameEngine, humanColor, botDifficulty);
  }, [botDifficulty, engineLoaded, gameEngine, humanColor, modeParam]);

  useEffect(() => {
    if (
      effectiveMode !== 'local'
      || localOpponent !== 'bot'
      || !engineLoaded
      || !gameEngine
      || finishedGame
      || gameEngine.gameOver
    ) {
      return;
    }

    const startedAt = getCurrentTimeMs();
    if (gameStartedAtRef.current === 0) gameStartedAtRef.current = startedAt;
    lastClockTickRef.current = startedAt;
    const timer = window.setInterval(() => {
      if (gameCompletionRef.current) return;
      const now = getCurrentTimeMs();
      const elapsed = (now - lastClockTickRef.current) / 1000;
      lastClockTickRef.current = now;
      const activeColor = gameEngine.turn;
      const previousDisplayedTime = Math.ceil(clocksRef.current[activeColor]);
      const remaining = Math.max(0, clocksRef.current[activeColor] - elapsed);
      const nextClocks = { ...clocksRef.current, [activeColor]: remaining };
      clocksRef.current = nextClocks;
      if (Math.ceil(remaining) !== previousDisplayedTime || remaining <= 0) {
        setClocks(nextClocks);
      }

      if (remaining <= 0) {
        const winner = activeColor === 'w' ? 'black_wins' : 'white_wins';
        finishLocalGameRef.current?.(gameEngine, winner, 'timeout');
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [effectiveMode, engineLoaded, finishedGame, gameEngine, localOpponent]);

  const handleJoinMatch = async () => {
    setMatching(true);
    setError(null);
    try {
      const response = await fetch('/api/matchmaking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', timeControl }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Unable to join matchmaking.');
      }
      if (payload.status === 'matched' && typeof payload.gameId === 'string') {
        router.push(`/game/${encodeURIComponent(payload.gameId)}`);
      } else if (payload.status === 'queued') {
        setMatchStatus('queued');
      } else {
        throw new Error('The matchmaking service returned an unexpected response.');
      }
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Unable to join matchmaking.');
    } finally {
      setMatching(false);
    }
  };

  const handleLeaveMatch = async () => {
    setMatching(true);
    setError(null);
    try {
      const response = await fetch('/api/matchmaking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'leave' }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Unable to leave matchmaking.');
      }
      setMatchStatus('idle');
    } catch (leaveError) {
      setError(leaveError instanceof Error ? leaveError.message : 'Unable to leave matchmaking.');
    } finally {
      setMatching(false);
    }
  };

  if (authLoading) {
    return <p role="status" className="p-8 text-center text-text-secondary">Loading account…</p>;
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 text-text-primary">
      <header className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link
              href={modeParam === 'bot' ? '/play/bots' : '/play'}
              className="px-3 py-1 bg-background-secondary hover:bg-background-tertiary text-text-secondary hover:text-text-primary text-xs font-semibold rounded-full border border-text-secondary/15 flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              {modeParam === 'bot' ? t('botArenaTitle') : tr('Game Modes')}
            </Link>
          </div>
          <h1 className="text-3xl font-bold md:text-4xl">
            {effectiveMode === 'local' && localOpponent === 'bot' ? `${botName} (${botElo} ELO)` : 'Chess Arena Online'}
          </h1>
          <p className="mt-1 text-text-secondary">
            {effectiveMode === 'local' && localOpponent === 'bot'
              ? t('botApproximateElo')
              : 'Challenge players worldwide in real-time ranked matches.'}
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          {effectiveMode === 'local' && localOpponent === 'bot' && (
            <Link
              href="/play/bots"
              className="inline-flex items-center gap-2 rounded-xl border border-text-secondary/20 bg-background-secondary px-4 py-2.5 text-sm font-semibold hover:border-accent/50 hover:text-accent"
            >
              <ArrowLeft className="h-4 w-4" />
              {t('botChangeOpponent')}
            </Link>
          )}
          {effectiveMode === 'local' && localOpponent === 'bot' && (
            <Link
              href="/play/bots/history"
              className="inline-flex items-center gap-2 rounded-xl border border-text-secondary/20 bg-background-secondary px-4 py-2.5 text-sm font-semibold hover:border-accent/50 hover:text-accent"
            >
              <History className="h-4 w-4" />
              {t('botHistory')}
            </Link>
          )}
          {user && (
            <button
              onClick={() => setIsPlayAFriendOpen(true)}
              className="px-5 py-2.5 bg-accent hover:bg-accent-hover text-white font-bold rounded-xl transition-all shadow-lg shadow-accent/25 flex items-center gap-2 text-sm relative"
            >
              <UserPlus className="w-4 h-4" />
              <span>PLAY A FRIEND</span>
              {incomingInvitesCount > 0 && (
                <span className="absolute -top-1.5 -end-1.5 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center shadow animate-bounce">
                  {incomingInvitesCount}
                </span>
              )}
            </button>
          )}

          {user && (
            <button
              onClick={() => setMode(m => m === 'online' ? 'local' : 'online')}
              className="px-4 py-2.5 bg-background-secondary hover:bg-background-tertiary text-text-primary font-semibold rounded-xl border border-text-secondary/15 transition-colors text-sm flex items-center gap-2"
            >
              <User className="w-4 h-4 text-accent" />
              <span>{mode === 'online' ? 'Switch to Bot / Local' : 'Switch to Online Matchmaking'}</span>
            </button>
          )}
        </div>
      </header>

      {error && (
        <div role="alert" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
          <span>{error}</span>
          {!engineLoaded && effectiveMode === 'local' && localOpponent === 'bot' && (
            <button
              type="button"
              onClick={() => setEngineRetryKey((key) => key + 1)}
              className="rounded-lg border border-red-300/40 px-3 py-1.5 text-sm font-semibold hover:bg-red-500/10"
            >
              {tr('Retry')}
            </button>
          )}
        </div>
      )}

      {user && mode === 'online' && (
        <section className="mb-8 rounded-2xl border border-text-secondary/15 bg-background-secondary p-6 shadow-card">
          <h2 className="text-xl font-bold text-text-primary mb-2">Online Quick Match</h2>
          <p className="text-sm text-text-secondary mb-6">
            Find an opponent matched by your ELO rating and time control.
          </p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Time Control
              </label>
              <select
                value={timeControl}
                onChange={(event) => setTimeControl(event.target.value)}
                disabled={matching || matchStatus === 'queued'}
                className="block rounded-xl border border-text-secondary/25 bg-background-tertiary px-4 py-2.5 text-text-primary text-sm font-medium focus:border-accent focus:outline-none"
              >
                {TIME_CONTROLS.map((control) => <option key={control} value={control}>{control} Blitz / Rapid</option>)}
              </select>
            </div>
            {matchStatus === 'idle' ? (
              <button
                onClick={() => void handleJoinMatch()}
                disabled={matching}
                className="rounded-xl bg-accent hover:bg-accent-hover px-6 py-2.5 font-bold text-white shadow-lg shadow-accent/25 transition-colors disabled:opacity-50"
              >
                {matching ? 'Connecting…' : 'Find Opponent'}
              </button>
            ) : (
              <div className="flex items-center gap-3">
                <p role="status" className="text-sm font-semibold text-accent animate-pulse">Searching for opponent…</p>
                <button
                  onClick={() => void handleLeaveMatch()}
                  disabled={matching}
                  className="rounded-xl border border-text-secondary/20 px-4 py-2.5 text-text-primary hover:bg-background-tertiary transition-colors disabled:opacity-50 text-sm font-semibold"
                >
                  Cancel Search
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {effectiveMode === 'local' && gameEngine && (
        <div>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 bg-background-secondary p-4 rounded-2xl border border-text-secondary/15 shadow-card">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center text-accent">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-text-primary">
                  {localOpponent === 'bot' ? `${botName} (${botElo} ELO)` : 'Hotseat Two Player'}
                </h3>
                <p className="text-xs text-text-secondary">
                  {localOpponent === 'bot'
                    ? `${humanColor === 'w' ? t('white') : t('black')} · ${t(FORMAT_KEYS[format])} · ${timeControl}`
                    : 'Alternate moves on this device'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {(botThinking || (engineProgress !== null && !engineLoaded)) && (
                <span role="status" className="max-w-64 rounded-lg bg-accent/20 px-3 py-1.5 text-xs font-semibold text-accent">
                  {engineProgress?.phase === 'download'
                    ? `${t('botEngineDownloading')} ${engineProgress.totalBytes
                      ? `${Math.floor((engineProgress.loadedBytes / engineProgress.totalBytes) * 100)}%`
                      : `${(engineProgress.loadedBytes / 1024 / 1024).toFixed(1)} MB`}`
                    : engineLoaded ? t('computerThinking') : t('botEngineStarting')}
                </span>
              )}
              <button
                onClick={() => startLocalGame(localOpponent)}
                className="px-4 py-2 bg-background-tertiary hover:bg-background text-text-primary text-xs font-semibold rounded-xl border border-text-secondary/20 transition-colors flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5 text-accent" />
                <span>Restart Game</span>
              </button>
            </div>
          </div>

          <ChessBoard
            engine={gameEngine}
            onReset={() => startLocalGame(localOpponent)}
            onMove={handleLocalMove}
            isWhitePlayer={humanColor === 'w'}
            isHotSeat={localOpponent === 'hotseat'}
            undoPlies={localOpponent === 'bot' && gameEngine.moveHistory.length > 1 ? 2 : 1}
            allowUndo={localOpponent === 'hotseat' && !botThinking}
            isInputEnabled={!botThinking && !finishedGame && !timeoutWinner && (localOpponent === 'hotseat' || (engineLoaded && gameEngine.turn === humanColor))}
            whiteName={humanColor === 'w' ? (user?.email || 'Player') : botName}
            blackName={humanColor === 'b' ? (user?.email || 'Player') : botName}
            whiteRating={humanColor === 'w' ? 200 : botElo}
            blackRating={humanColor === 'b' ? 200 : botElo}
            initialOrientation={humanColor === 'w' ? 'white' : 'black'}
            whiteTime={localOpponent === 'bot' ? Math.ceil(clocks.w) : undefined}
            blackTime={localOpponent === 'bot' ? Math.ceil(clocks.b) : undefined}
          />
          {finishedGame && (
            <section className="mt-6 rounded-2xl border border-accent/30 bg-background-secondary p-6 shadow-card">
              <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-accent">{t('botResult')}</p>
                  <h2 className="mt-1 text-3xl font-black">
                    {finishedGame.result === 'win' ? t('botVictory') : finishedGame.result === 'loss' ? t('botDefeat') : t('botDraw')}
                  </h2>
                  <p className="mt-2 text-sm text-text-secondary">
                    {t('botOpponent')}: {botName} ({botElo} ELO) · {t(FORMAT_KEYS[format])} · {timeControl}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => startLocalGame('bot', humanColor, botDifficulty)}
                    className="rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white hover:bg-accent-hover"
                  >
                    {t('botRematch')}
                  </button>
                  <Link
                    href={`/play/bots/history?game=${encodeURIComponent(finishedGame.id)}`}
                    className="rounded-xl border border-text-secondary/20 px-4 py-2.5 text-sm font-semibold hover:border-accent/50 hover:text-accent"
                  >
                    {t('botAnalyzeGame')}
                  </Link>
                  <Link
                    href="/play/bots"
                    className="rounded-xl border border-text-secondary/20 px-4 py-2.5 text-sm font-semibold hover:border-accent/50 hover:text-accent"
                  >
                    {t('botChangeOpponent')}
                  </Link>
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      {/* Play a Friend Modal */}
      <PlayAFriendModal
        isOpen={isPlayAFriendOpen}
        onClose={() => setIsPlayAFriendOpen(false)}
      />
    </div>
  );
}

export default function PlayPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-text-secondary">Loading play arena…</div>}>
      <PlayContent />
    </Suspense>
  );
}
