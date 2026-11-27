'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { Chessboard } from 'react-chessboard';
import { GameEngine } from '@/lib/chess/game';
import { formatTime } from '@/lib/utils';
import { RotateCcw, Undo2, ArrowLeftRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';
import { getBoardTheme } from '@/lib/boardThemes';

interface ChessBoardProps {
  engine: GameEngine;
  onMove?: (move: string) => void;
  onReset: () => void;
  isWhitePlayer: boolean;
  whiteTime?: number;
  blackTime?: number;
  initialOrientation?: 'white' | 'black';
  allowReset?: boolean;
  allowUndo?: boolean;
  showMoveHistory?: boolean;
  showPlayerInfo?: boolean;
  undoPlies?: number;
  isInputEnabled?: boolean;
  isHotSeat?: boolean;
  onPositionChange?: () => void;
  whiteName?: string;
  blackName?: string;
  whiteRating?: number;
  blackRating?: number;
}

export default function ChessBoard({
  engine,
  onMove,
  onReset,
  isWhitePlayer,
  whiteTime,
  blackTime,
  initialOrientation = 'white',
  allowReset = true,
  allowUndo = true,
  showMoveHistory = true,
  showPlayerInfo = true,
  undoPlies = 1,
  isInputEnabled = true,
  isHotSeat = false,
  onPositionChange,
  whiteName = 'White Player',
  blackName = 'Black Player',
  whiteRating = 200,
  blackRating = 200,
}: ChessBoardProps) {
  const { tr } = useI18n();
  const boardTheme = getBoardTheme();
  const [orientation, setOrientation] = useState<'white' | 'black'>(initialOrientation);
  const [lastMove, setLastMove] = useState<string | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [promotionMove, setPromotionMove] = useState<{ from: string; to: string } | null>(null);
  const [, setPositionVersion] = useState(0);

  const fen = engine.fen;
  const check = engine.inCheck;
  const gameOver = engine.gameOver;
  const result = engine.result;
  const canPlayTurn = isInputEnabled && !gameOver
    && (isHotSeat || engine.turn === (isWhitePlayer ? 'w' : 'b'));
  const legalDestinations = selectedSquare ? engine.getLegalDestinations(selectedSquare) : [];
  const moveHistory = engine.moveHistory;

  useEffect(() => {
    const previousMove = engine.moveHistory.at(-1);
    setLastMove(previousMove ? `${previousMove.from}${previousMove.to}` : null);
    setSelectedSquare(null);
    setPositionVersion(version => version + 1);
  }, [engine, fen]);

  const completeMove = (from: string, to: string, promotion: 'q' | 'r' | 'b' | 'n' = 'q') => {
    const moveResult = engine.moveFromSquares(from, to, promotion);
    if (!moveResult.success || !moveResult.move) return false;

    setLastMove(`${from}${to}`);
    setSelectedSquare(null);
    setPromotionMove(null);
    setPositionVersion(version => version + 1);
    onMove?.(`${from}${to}${promotion === 'q' ? '' : promotion}`);
    return true;
  };

  const onPieceDrop = ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }) => {
    if (!targetSquare || !canPlayTurn) return false;

    const destinations = engine.getLegalDestinations(sourceSquare)
      .filter(destination => destination.to === targetSquare);
    if (destinations.length === 0) return false;

    if (destinations.some(destination => destination.promotion)) {
      setPromotionMove({ from: sourceSquare, to: targetSquare });
      return false;
    }

    completeMove(sourceSquare, targetSquare);
    return true;
  };

  const handleSquareClick = ({ piece, square }: { piece: { pieceType: string } | null; square: string }) => {
    if (!canPlayTurn || promotionMove) return;

    if (selectedSquare) {
      const destinations = engine.getLegalDestinations(selectedSquare)
        .filter(destination => destination.to === square);
      if (destinations.length > 0) {
        if (destinations.some(destination => destination.promotion)) {
          setPromotionMove({ from: selectedSquare, to: square });
          return;
        }
        completeMove(selectedSquare, square);
        return;
      }
    }

    const selectedPiece = piece ? engine.getPieceAt(square) : null;
    if (selectedPiece?.color === engine.turn) {
      setSelectedSquare(square);
    } else {
      setSelectedSquare(null);
    }
  };

  const handleUndo = () => {
    let undone = false;
    for (let index = 0; index < Math.max(1, undoPlies); index += 1) {
      if (!engine.undo()) break;
      undone = true;
    }
    if (!undone) return;
    setLastMove(null);
    setSelectedSquare(null);
    setPositionVersion(version => version + 1);
    onPositionChange?.();
  };

  const handleReset = () => {
    engine.reset();
    setLastMove(null);
    setSelectedSquare(null);
    setPromotionMove(null);
    setPositionVersion(version => version + 1);
    onReset();
  };

  const squareStyles: Record<string, CSSProperties> = {};
  if (lastMove) {
    squareStyles[lastMove.slice(0, 2)] = { backgroundColor: 'rgba(250, 204, 21, 0.4)' };
    squareStyles[lastMove.slice(2, 4)] = { backgroundColor: 'rgba(250, 204, 21, 0.4)' };
  }
  if (selectedSquare) {
    squareStyles[selectedSquare] = { boxShadow: 'inset 0 0 0 4px rgba(59, 130, 246, 0.9)' };
  }
  for (const destination of legalDestinations) {
    const occupied = engine.getPieceAt(destination.to);
    squareStyles[destination.to] = {
      ...(squareStyles[destination.to] ?? {}),
      ...(destination.capture || occupied
        ? { boxShadow: 'inset 0 0 0 4px rgba(34, 197, 94, 0.85)' }
        : { backgroundImage: 'radial-gradient(circle, rgba(34, 197, 94, 0.75) 18%, transparent 20%)' }),
    };
  }

  const topPlayerName = orientation === 'white' ? blackName : whiteName;
  const topPlayerRating = orientation === 'white' ? blackRating : whiteRating;
  const topPlayerTime = orientation === 'white' ? blackTime : whiteTime;

  const bottomPlayerName = orientation === 'white' ? whiteName : blackName;
  const bottomPlayerRating = orientation === 'white' ? whiteRating : blackRating;
  const bottomPlayerTime = orientation === 'white' ? whiteTime : blackTime;

  return (
    <div className={`grid grid-cols-1 ${showMoveHistory ? 'lg:grid-cols-3' : 'lg:grid-cols-1'} gap-6 items-start w-full max-w-6xl mx-auto`}>
      {/* Main Chessboard Column */}
      <div className={`${showMoveHistory ? 'lg:col-span-2' : ''} flex flex-col items-center bg-background-secondary p-1 sm:p-6 rounded-2xl border border-text-secondary/15 shadow-card`}>

        {/* Opponent Info Header */}
        {showPlayerInfo && (
          <div className="w-full flex items-center justify-between mb-3 bg-background-tertiary px-4 py-2.5 rounded-xl border border-text-secondary/10">
            <div className="flex items-center gap-x-3">
              <div className="w-9 h-9 rounded-full bg-accent/20 text-accent font-bold flex items-center justify-center text-sm">
                {topPlayerName.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-sm text-text-primary">{topPlayerName}</p>
                <p className="text-xs text-text-secondary">{tr('Rating')}: {topPlayerRating}</p>
              </div>
            </div>
            {topPlayerTime !== undefined && (
              <div className="bg-background px-3 py-1 rounded-lg border border-text-secondary/20 font-mono font-bold text-lg text-text-primary">
                {formatTime(topPlayerTime)}
              </div>
            )}
          </div>
        )}

        {/* Proportional Chessboard Container */}
        <div dir="ltr" className="w-[calc(100vw-2rem)] max-w-[560px] sm:w-full aspect-square relative shadow-2xl rounded-xl overflow-hidden border-2 border-text-secondary/20">
          <Chessboard
            options={{
              position: fen,
              boardOrientation: orientation,
              squareStyles,
              allowDragging: canPlayTurn && !promotionMove,
              canDragPiece: ({ square }) => {
                const piece = square ? engine.getPieceAt(square) : null;
                return canPlayTurn && Boolean(piece)
                  && (isHotSeat || piece?.color === (isWhitePlayer ? 'w' : 'b'));
              },
              onPieceDrop,
              onSquareClick: handleSquareClick,
              showNotation: true,
              allowDrawingArrows: true,
              boardStyle: {
                width: '100%',
                height: '100%',
                position: 'absolute',
                inset: 0,
                borderRadius: '8px',
              },
              lightSquareStyle: { backgroundColor: boardTheme.light },
              darkSquareStyle: { backgroundColor: boardTheme.dark },
            }}
          />
        </div>

        {/* Player Info Footer */}
        {showPlayerInfo && (
          <div className="w-full flex items-center justify-between mt-3 bg-background-tertiary px-4 py-2.5 rounded-xl border border-text-secondary/10">
            <div className="flex items-center gap-x-3">
              <div className="w-9 h-9 rounded-full bg-accent text-white font-bold flex items-center justify-center text-sm shadow-md shadow-accent/30">
                {bottomPlayerName.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-sm text-text-primary">{bottomPlayerName}</p>
                <p className="text-xs text-text-secondary">{tr('Rating')}: {bottomPlayerRating}</p>
              </div>
            </div>
            {bottomPlayerTime !== undefined && (
              <div className="bg-background px-3 py-1 rounded-lg border border-text-secondary/20 font-mono font-bold text-lg text-text-primary">
                {formatTime(bottomPlayerTime)}
              </div>
            )}
          </div>
        )}

        {/* Check & Game Over Alerts */}
        {check && !gameOver && (
          <div className="mt-3 w-full p-2.5 bg-red-500/20 border border-red-500/40 rounded-xl text-red-300 text-center text-sm font-semibold animate-pulse">
            {tr('Check!')}
          </div>
        )}

        {gameOver && (
          <div className="mt-3 w-full p-4 bg-accent/20 border border-accent/50 rounded-xl text-center">
            <h3 className="text-xl font-bold text-accent mb-2">
              {tr(result === 'white_wins' ? 'White Wins!' :
               result === 'black_wins' ? 'Black Wins!' : 'Draw Game')}
            </h3>
            <button
              onClick={handleReset}
              className="px-6 py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl transition-colors shadow-md shadow-accent/20"
            >
              {tr('New Game')}
            </button>
          </div>
        )}

        {/* Promotion Modal */}
        {promotionMove && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="promotion-title">
            <div className="w-full max-w-sm rounded-2xl bg-background-secondary p-6 text-text-primary shadow-2xl border border-text-secondary/20">
              <h2 id="promotion-title" className="text-lg font-bold">{tr('Promote Pawn')}</h2>
              <p className="mt-1 text-sm text-text-secondary">{tr('Choose a piece for your pawn.')}</p>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {(['q', 'r', 'b', 'n'] as const).map((piece) => (
                  <button
                    key={piece}
                    aria-label={`Promote to ${
                      piece === 'q' ? 'queen' :
                      piece === 'r' ? 'rook' :
                      piece === 'b' ? 'bishop' : 'knight'
                    }`}
                    onClick={() => completeMove(promotionMove.from, promotionMove.to, piece)}
                    className="rounded-xl border border-text-secondary/20 py-3 text-center font-bold uppercase hover:bg-background-tertiary hover:border-accent transition-colors"
                  >
                    {piece}
                  </button>
                ))}
              </div>
              <button onClick={() => setPromotionMove(null)} className="mt-4 w-full rounded-xl px-3 py-2 text-sm text-text-secondary hover:bg-background-tertiary">
                {tr('Cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right Sidebar: Move History & Controls */}
      {showMoveHistory && (
        <div className="bg-background-secondary rounded-2xl p-4 sm:p-6 border border-text-secondary/15 flex flex-col justify-between h-full min-h-[320px] lg:min-h-[520px] shadow-card">
          <div>
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <span>{tr('Move History')}</span>
            </h2>
            {moveHistory.length === 0 ? (
              <p className="text-sm text-text-secondary italic">{tr('No moves played yet.')}</p>
            ) : (
              <ol className="grid grid-cols-2 gap-x-4 gap-y-2 overflow-y-auto max-h-[320px] font-mono text-sm pe-1">
                {moveHistory.map((move, index) => (
                  <li key={`${move.index}-${move.move}`} className="flex items-center gap-2 bg-background-tertiary px-3 py-1.5 rounded-lg border border-text-secondary/10">
                    <span className="text-text-secondary text-xs">{index % 2 === 0 ? `${Math.floor(index / 2) + 1}.` : ''}</span>
                    <span className="text-text-primary font-semibold">{move.move}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Action Controls */}
          <div className="pt-4 border-t border-text-secondary/15 space-y-2 mt-4">
            <div className="grid grid-cols-2 gap-2">
              {allowUndo && (
                <button
                  onClick={handleUndo}
                  disabled={moveHistory.length === 0}
                  aria-label={tr('Undo move')}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 bg-background-tertiary hover:bg-background text-text-primary text-xs font-semibold rounded-xl border border-text-secondary/20 transition-colors disabled:opacity-50"
                >
                  <Undo2 className="w-4 h-4 text-accent" />
                  <span>{tr('Undo')}</span>
                </button>
              )}
              <button
                onClick={() => setOrientation(o => o === 'white' ? 'black' : 'white')}
                className="flex items-center justify-center gap-1.5 py-2.5 px-3 bg-background-tertiary hover:bg-background text-text-primary text-xs font-semibold rounded-xl border border-text-secondary/20 transition-colors"
              >
                <ArrowLeftRight className="w-4 h-4 text-accent" />
                <span>{tr('Flip')}</span>
              </button>
            </div>
            {allowReset && (
              <button
                onClick={handleReset}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-background-tertiary hover:bg-background text-text-primary text-xs font-semibold rounded-xl border border-text-secondary/20 transition-colors"
              >
                <RotateCcw className="w-4 h-4 text-accent" />
                <span>{tr('Reset Board')}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
