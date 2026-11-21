import { Chess, type Move as ChessMove } from 'chess.js';

export type BotDifficulty =
  | 'easy'
  | 'medium'
  | 'hard'
  | 'intermediate'
  | 'advanced'
  | '100'
  | '300'
  | '500'
  | '700'
  | '900'
  | '1100'
  | '1300'
  | '1500'
  | '1800'
  | '2200'
  | '2500'
  | '2800';

export interface BotMove {
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
}

interface SearchProfile {
  maxDepth: number;
  maxNodes: number;
  timeLimitMs: number;
  moveNoise: number;
}

interface TranspositionEntry {
  depth: number;
  score: number;
  flag: 'exact' | 'lower' | 'upper';
  bestMove?: string;
}

interface SearchContext {
  startedAt: number;
  deadline: number;
  maxNodes: number;
  nodes: number;
  stopped: boolean;
  isCancelled: () => boolean;
  transposition: Map<string, TranspositionEntry>;
}

interface RootResult {
  candidates: Array<{ move: ChessMove; score: number }>;
  complete: boolean;
}

const MATE_SCORE = 100_000;
const INFINITY = 1_000_000;
const MAX_QUIESCENCE_DEPTH = 6;
const MAX_TRANSPOSITION_ENTRIES = 120_000;
const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 335,
  r: 500,
  q: 900,
  k: 0,
};

function getPromotion(promotion?: string): BotMove['promotion'] {
  if (promotion === 'q' || promotion === 'r' || promotion === 'b' || promotion === 'n') {
    return promotion;
  }
  return undefined;
}

function getMoveKey(move: ChessMove): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`;
}

function getSearchProfile(difficulty: string): SearchProfile {
  if (difficulty === 'easy' || difficulty === '100' || difficulty === '300') {
    return { maxDepth: 1, maxNodes: 1_500, timeLimitMs: 180, moveNoise: 420 };
  }
  if (difficulty === 'intermediate' || difficulty === 'medium' || ['500', '700', '900'].includes(difficulty)) {
    return { maxDepth: 3, maxNodes: 35_000, timeLimitMs: 850, moveNoise: 35 };
  }
  if (difficulty === '1100' || difficulty === '1300') {
    return { maxDepth: 4, maxNodes: 70_000, timeLimitMs: 1_200, moveNoise: 0 };
  }
  if (difficulty === '1500' || difficulty === '1800') {
    return { maxDepth: 5, maxNodes: 140_000, timeLimitMs: 1_800, moveNoise: 0 };
  }
  if (difficulty === '2200' || difficulty === '2500' || difficulty === '2800' || difficulty === 'advanced' || difficulty === 'hard') {
    return { maxDepth: 6, maxNodes: 250_000, timeLimitMs: 2_500, moveNoise: 0 };
  }
  return { maxDepth: 3, maxNodes: 35_000, timeLimitMs: 850, moveNoise: 35 };
}

function shouldStop(context: SearchContext): boolean {
  if (context.stopped) return true;
  if (context.nodes >= context.maxNodes) {
    context.stopped = true;
    return true;
  }
  if ((context.nodes & 127) === 0) {
    if (Date.now() >= context.deadline || context.isCancelled()) {
      context.stopped = true;
      return true;
    }
  }
  return false;
}

function evaluatePosition(chess: Chess): number {
  const board = chess.board();
  const nonPawnMaterial = board.flat().reduce((total, piece) => (
    piece && piece.type !== 'p' && piece.type !== 'k'
      ? total + (PIECE_VALUES[piece.type] ?? 0)
      : total
  ), 0);
  let score = 0;

  for (let row = 0; row < board.length; row += 1) {
    for (let file = 0; file < board[row].length; file += 1) {
      const piece = board[row][file];
      if (!piece) continue;

      const value = PIECE_VALUES[piece.type] ?? 0;
      const sign = piece.color === chess.turn() ? 1 : -1;
      const rank = 7 - row;
      const ownProgress = piece.color === 'w' ? rank : 7 - rank;
      const centerDistance = Math.abs(file - 3.5) + Math.abs(rank - 3.5);
      const center = 7 - centerDistance;
      let positional = 0;

      if (piece.type === 'p') positional += ownProgress * 7 + center * 2;
      if (piece.type === 'n') positional += center * 9;
      if (piece.type === 'b') positional += center * 5;
      if (piece.type === 'q') positional += center * 2;
      if (piece.type === 'r' && ownProgress === 6) positional += 18;
      if (piece.type === 'k') {
        const isEndgame = nonPawnMaterial < 2_600;
        positional += isEndgame ? center * 8 : -center * 5;
        const homeRank = piece.color === 'w' ? 0 : 7;
        if (!isEndgame && rank === homeRank && (file === 2 || file === 6)) positional += 28;
      }

      score += sign * (value + positional);
    }
  }

  if (chess.isCheck()) score -= 28;
  return score;
}

function orderMoves(
  moves: ChessMove[],
  preferredMove?: string,
  tacticalOnly = false
): ChessMove[] {
  const candidates = tacticalOnly
    ? moves.filter((move) => move.captured || move.promotion || move.san.endsWith('+'))
    : moves;
  return candidates.sort((left, right) => {
    const score = (move: ChessMove) => {
      const key = getMoveKey(move);
      if (key === preferredMove) return INFINITY;
      let value = 0;
      if (move.captured) {
        value += 10_000 + (PIECE_VALUES[move.captured] ?? 0) * 10 - (PIECE_VALUES[move.piece] ?? 0);
      }
      if (move.promotion) value += 8_000 + (PIECE_VALUES[move.promotion] ?? 0);
      if (move.san.endsWith('#')) value += 20_000;
      else if (move.san.endsWith('+')) value += 500;
      return value;
    };
    return score(right) - score(left);
  });
}

function quiescence(
  chess: Chess,
  alphaInput: number,
  beta: number,
  ply: number,
  qDepth: number,
  context: SearchContext
): number {
  context.nodes += 1;
  if (shouldStop(context)) return evaluatePosition(chess);
  if (chess.isCheckmate()) return -MATE_SCORE + ply;
  if (chess.isDraw()) return 0;

  const inCheck = chess.isCheck();
  if (qDepth >= MAX_QUIESCENCE_DEPTH) return evaluatePosition(chess);
  let alpha = alphaInput;
  let bestScore = inCheck ? -INFINITY : evaluatePosition(chess);

  if (!inCheck) {
    if (bestScore >= beta) return bestScore;
    alpha = Math.max(alpha, bestScore);
  }

  const moves = orderMoves(chess.moves({ verbose: true }), undefined, !inCheck);
  if (moves.length === 0) return bestScore;

  for (const move of moves) {
    if (shouldStop(context)) break;
    chess.move(move);
    const score = -quiescence(chess, -beta, -alpha, ply + 1, qDepth + 1, context);
    chess.undo();
    bestScore = Math.max(bestScore, score);
    alpha = Math.max(alpha, score);
    if (alpha >= beta) break;
  }

  return bestScore;
}

function searchPosition(
  chess: Chess,
  depth: number,
  alphaInput: number,
  beta: number,
  ply: number,
  context: SearchContext
): number {
  context.nodes += 1;
  if (shouldStop(context)) return evaluatePosition(chess);
  if (chess.isCheckmate()) return -MATE_SCORE + ply;
  if (chess.isDraw()) return 0;
  if (depth <= 0) return quiescence(chess, alphaInput, beta, ply, 0, context);

  const alphaOriginal = alphaInput;
  let alpha = alphaInput;
  const key = chess.fen();
  const cached = context.transposition.get(key);
  if (cached && cached.depth >= depth) {
    if (cached.flag === 'exact') return cached.score;
    if (cached.flag === 'lower') alpha = Math.max(alpha, cached.score);
    if (cached.flag === 'upper' && cached.score <= alpha) return cached.score;
    if (alpha >= beta) return cached.score;
  }

  let bestScore = -INFINITY;
  let bestMove: string | undefined;
  const moves = orderMoves(chess.moves({ verbose: true }), cached?.bestMove);

  for (const move of moves) {
    if (shouldStop(context)) break;
    chess.move(move);
    const score = -searchPosition(chess, depth - 1, -beta, -alpha, ply + 1, context);
    chess.undo();
    if (score > bestScore) {
      bestScore = score;
      bestMove = getMoveKey(move);
    }
    alpha = Math.max(alpha, score);
    if (alpha >= beta) break;
  }

  if (!context.stopped) {
    if (context.transposition.size >= MAX_TRANSPOSITION_ENTRIES) context.transposition.clear();
    const flag = bestScore <= alphaOriginal ? 'upper' : bestScore >= beta ? 'lower' : 'exact';
    context.transposition.set(key, { depth, score: bestScore, flag, bestMove });
  }

  return bestScore === -INFINITY ? evaluatePosition(chess) : bestScore;
}

function searchRoot(chess: Chess, depth: number, context: SearchContext): RootResult {
  const moves = orderMoves(chess.moves({ verbose: true }));
  const candidates: RootResult['candidates'] = [];
  let alpha = -INFINITY;

  for (const move of moves) {
    if (shouldStop(context)) return { candidates, complete: false };
    chess.move(move);
    const score = -searchPosition(chess, depth - 1, -INFINITY, -alpha, 1, context);
    chess.undo();
    if (context.stopped) return { candidates, complete: false };
    candidates.push({ move, score });
    alpha = Math.max(alpha, score);
  }

  return { candidates, complete: true };
}

function chooseCandidate(candidates: RootResult['candidates'], moveNoise: number): ChessMove | null {
  if (candidates.length === 0) return null;
  let bestMove = candidates[0].move;
  let bestScore = -INFINITY;
  for (const candidate of candidates) {
    const noisyScore = candidate.score + Math.random() * moveNoise - moveNoise / 2;
    if (noisyScore > bestScore) {
      bestScore = noisyScore;
      bestMove = candidate.move;
    }
  }
  return bestMove;
}

function createSearchContext(
  profile: SearchProfile,
  isCancelled: () => boolean
): SearchContext {
  const startedAt = Date.now();
  return {
    startedAt,
    deadline: startedAt + profile.timeLimitMs,
    maxNodes: profile.maxNodes,
    nodes: 0,
    stopped: false,
    isCancelled,
    transposition: new Map(),
  };
}

function toBotMove(move: ChessMove | null): BotMove | null {
  if (!move) return null;
  return { from: move.from, to: move.to, promotion: getPromotion(move.promotion) };
}

function calculateBotMove(
  chess: Chess,
  difficulty: string,
  isCancelled: () => boolean,
  syncBudget = false
): BotMove | null {
  const profile = getSearchProfile(difficulty);
  const searchProfile = syncBudget
    ? { ...profile, maxDepth: Math.min(profile.maxDepth, 3), maxNodes: 8_000, timeLimitMs: 350 }
    : profile;
  const legalMoves = chess.moves({ verbose: true });
  if (legalMoves.length === 0) return null;
  if (searchProfile.moveNoise === 0) {
    const captures = legalMoves.filter((move) => move.captured);
    if (captures.length > 0) {
      captures.sort((left, right) => {
        const leftValue = PIECE_VALUES[left.captured ?? 'p'] ?? 100;
        const rightValue = PIECE_VALUES[right.captured ?? 'p'] ?? 100;
        return rightValue - leftValue;
      });
      return isCancelled() ? null : toBotMove(captures[0]);
    }
  }

  const context = createSearchContext(searchProfile, isCancelled);
  let bestMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];

  for (let depth = 1; depth <= searchProfile.maxDepth; depth += 1) {
    if (isCancelled()) return null;
    const result = searchRoot(chess, depth, context);
    if (!result.complete) break;
    bestMove = chooseCandidate(result.candidates, searchProfile.moveNoise) ?? bestMove;
    if (Math.abs(result.candidates.find((candidate) => getMoveKey(candidate.move) === getMoveKey(bestMove))?.score ?? 0) >= MATE_SCORE - 20) {
      break;
    }
  }

  return isCancelled() ? null : toBotMove(bestMove);
}

export function chooseBotMove(fen: string, difficulty?: string): BotMove | null;
export function chooseBotMove(fen: string, color: 'w' | 'b', difficulty?: string): BotMove | null;
export function chooseBotMove(
  fen: string,
  colorOrDifficulty: string = 'medium',
  requestedDifficulty: string = 'medium'
): BotMove | null {
  const color = colorOrDifficulty === 'w' || colorOrDifficulty === 'b' ? colorOrDifficulty : undefined;
  const difficulty = color ? requestedDifficulty : colorOrDifficulty;
  try {
    const chess = new Chess(fen);
    if (color && chess.turn() !== color) return null;
    return calculateBotMove(chess, difficulty, () => false, true);
  } catch {
    return null;
  }
}

export async function chooseBotMoveInCurrentThread(
  fen: string,
  color: 'w' | 'b',
  difficulty: string = 'medium',
  isCancelled: () => boolean = () => false
): Promise<BotMove | null> {
  const chess = new Chess(fen);
  if (chess.turn() !== color) return null;

  const profile = getSearchProfile(difficulty);
  const legalMoves = chess.moves({ verbose: true });
  if (legalMoves.length === 0 || isCancelled()) return null;
  if (profile.moveNoise === 0) {
    const captures = legalMoves.filter((move) => move.captured);
    if (captures.length > 0) {
      captures.sort((left, right) => {
        const leftValue = PIECE_VALUES[left.captured ?? 'p'] ?? 100;
        const rightValue = PIECE_VALUES[right.captured ?? 'p'] ?? 100;
        return rightValue - leftValue;
      });
      return toBotMove(captures[0]);
    }
  }

  const context = createSearchContext(profile, isCancelled);
  let bestMove = legalMoves[Math.floor(Math.random() * legalMoves.length)];

  for (let depth = 1; depth <= profile.maxDepth; depth += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    if (isCancelled() || context.stopped) return isCancelled() ? null : toBotMove(bestMove);
    const result = searchRoot(chess, depth, context);
    if (!result.complete) break;
    bestMove = chooseCandidate(result.candidates, profile.moveNoise) ?? bestMove;
    const bestScore = result.candidates.find((candidate) => getMoveKey(candidate.move) === getMoveKey(bestMove))?.score ?? 0;
    if (Math.abs(bestScore) >= MATE_SCORE - 20) break;
  }

  return isCancelled() ? null : toBotMove(bestMove);
}
