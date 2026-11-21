import {
  getBotUciSettings,
  parseUciOption,
  type BotProfile,
  type UciOption,
} from '@/lib/chess/botProfiles';

const ENGINE_WASM_URL = '/stockfish/stockfish-19-single.wasm';
const ENGINE_WORKER_URL = '/stockfish/stockfish-19-single.js';
const INITIALIZATION_TIMEOUT_MS = 30_000;
const PROGRESS_REPORT_INTERVAL_MS = 500;
const PROGRESS_REPORT_BYTES = 2 * 1024 * 1024;

export interface StockfishProgress {
  loadedBytes: number;
  totalBytes: number | null;
  phase: 'download' | 'engine';
}

export interface StockfishSearchResult {
  bestMove: string;
  scoreCp: number;
  depth: number;
}

interface StockfishWorker {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: string): void;
  terminate(): void;
}

interface UciWaiter {
  matches: (line: string) => boolean;
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingSearch {
  resolve: (result: StockfishSearchResult | null) => void;
  reject: (error: Error) => void;
  scoreCp: number;
  depth: number;
  cancelled: boolean;
}

async function preloadEngineWasm(
  onProgress?: (progress: StockfishProgress) => void,
): Promise<void> {
  const response = await fetch(ENGINE_WASM_URL, { cache: 'force-cache' });
  if (!response.ok) {
    throw new Error(`Stockfish engine download failed (HTTP ${response.status}).`);
  }
  if (!response.body) {
    throw new Error('This browser cannot stream the Stockfish engine download.');
  }

  const totalBytes = Number(response.headers.get('content-length')) || null;
  const reader = response.body.getReader();
  let loadedBytes = 0;
  let lastReportedBytes = 0;
  let lastReportedAt = 0;
  const reportProgress = (force = false) => {
    const now = Date.now();
    if (
      !force
      && loadedBytes - lastReportedBytes < PROGRESS_REPORT_BYTES
      && now - lastReportedAt < PROGRESS_REPORT_INTERVAL_MS
    ) {
      return;
    }
    onProgress?.({ loadedBytes, totalBytes, phase: 'download' });
    lastReportedBytes = loadedBytes;
    lastReportedAt = now;
  };
  reportProgress(true);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      loadedBytes += value.byteLength;
      reportProgress();
    }
  } finally {
    reader.releaseLock();
  }
  reportProgress(true);
}

export class StockfishClient {
  private readonly worker: StockfishWorker;
  private readonly waiters = new Set<UciWaiter>();
  private readonly options = new Map<string, UciOption>();
  private pendingSearch: PendingSearch | null = null;
  private initialized: Promise<void> | null = null;
  private configuredKey: string | null = null;

  constructor(workerFactory: () => StockfishWorker = () => new Worker(ENGINE_WORKER_URL)) {
    this.worker = workerFactory();
    this.worker.onmessage = (event) => this.handleLine(String(event.data));
    this.worker.onerror = (event) => this.fail(new Error(event.message || 'Stockfish worker failed.'));
  }

  async initialize(): Promise<void> {
    if (this.initialized) return this.initialized;

    this.initialized = (async () => {
      const uciReady = this.waitForLine((line) => line === 'uciok');
      this.worker.postMessage('uci');
      await uciReady;

      const engineReady = this.waitForLine((line) => line === 'readyok');
      this.worker.postMessage('isready');
      await engineReady;
    })().catch((error: unknown) => {
      this.initialized = null;
      throw error;
    });

    return this.initialized;
  }

  async configure(profile: BotProfile, fullStrength = false): Promise<void> {
    await this.initialize();
    const settings = getBotUciSettings(profile, [...this.options.values()]);
    const key = fullStrength
      ? 'analysis-full-strength'
      : `${profile.id}:${settings.limitStrength}:${settings.elo}:${settings.skillLevel}`;
    if (this.configuredKey === key) return;

    const canSet = (name: string) => this.options.has(name);
    if (canSet('UCI_LimitStrength')) {
      this.worker.postMessage(`setoption name UCI_LimitStrength value ${fullStrength ? 'false' : settings.limitStrength ? 'true' : 'false'}`);
    }
    if (!fullStrength && settings.elo !== null && canSet('UCI_Elo')) {
      this.worker.postMessage(`setoption name UCI_Elo value ${settings.elo}`);
    }
    if (canSet('Skill Level')) {
      this.worker.postMessage(`setoption name Skill Level value ${fullStrength ? 20 : settings.skillLevel}`);
    }
    if (canSet('Hash')) {
      this.worker.postMessage('setoption name Hash value 64');
    }

    const ready = this.waitForLine((line) => line === 'readyok');
    this.worker.postMessage('isready');
    await ready;
    this.configuredKey = key;
  }

  async search(
    fen: string,
    moveTimeMs: number,
    isCancelled: () => boolean = () => false,
    moveHistory: readonly string[] = [],
  ): Promise<StockfishSearchResult | null> {
    await this.initialize();
    if (this.pendingSearch) {
      throw new Error('A Stockfish search is already in progress.');
    }

    return new Promise<StockfishSearchResult | null>((resolve, reject) => {
      const pending: PendingSearch = {
        resolve,
        reject,
        scoreCp: 0,
        depth: 0,
        cancelled: false,
      };
      this.pendingSearch = pending;
      const cancellationPoll = setInterval(() => {
        if (!pending.cancelled && isCancelled()) {
          pending.cancelled = true;
          this.worker.postMessage('stop');
        }
      }, 50);
      const timeout = setTimeout(() => {
        this.worker.postMessage('stop');
        this.finishSearch(new Error('Stockfish search timed out.'));
      }, Math.max(15_000, moveTimeMs * 10));

      const finish = (result: StockfishSearchResult | null) => {
        clearInterval(cancellationPoll);
        clearTimeout(timeout);
        resolve(result);
      };
      pending.resolve = finish;
      pending.reject = (error) => {
        clearInterval(cancellationPoll);
        clearTimeout(timeout);
        reject(error);
      };

      this.worker.postMessage(moveHistory.length > 0
        ? `position startpos moves ${moveHistory.join(' ')}`
        : `position fen ${fen}`);
      this.worker.postMessage(`go movetime ${Math.max(50, Math.round(moveTimeMs))}`);
    });
  }

  terminate(): void {
    this.worker.terminate();
    this.fail(new Error('Stockfish worker terminated.'));
  }

  private waitForLine(matches: (line: string) => boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      const waiter: UciWaiter = {
        matches,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error('Stockfish did not respond to the UCI initialization command.'));
        }, INITIALIZATION_TIMEOUT_MS),
      };
      this.waiters.add(waiter);
    });
  }

  private handleLine(line: string): void {
    const option = parseUciOption(line);
    if (option) this.options.set(option.name, option);

    for (const waiter of [...this.waiters]) {
      if (waiter.matches(line)) {
        clearTimeout(waiter.timeout);
        this.waiters.delete(waiter);
        waiter.resolve(line);
      }
    }

    const pending = this.pendingSearch;
    if (!pending) return;
    const depth = /\bdepth (\d+)\b/.exec(line);
    if (depth) pending.depth = Number(depth[1]);
    const centipawns = /\bscore cp (-?\d+)\b/.exec(line);
    const mate = /\bscore mate (-?\d+)\b/.exec(line);
    if (centipawns) pending.scoreCp = Number(centipawns[1]);
    else if (mate) pending.scoreCp = Math.sign(Number(mate[1])) * 10_000;

    const bestMove = /^bestmove (\S+)/.exec(line);
    if (!bestMove) return;
    const result = pending.cancelled || bestMove[1] === '(none)'
      ? null
      : { bestMove: bestMove[1], scoreCp: pending.scoreCp, depth: pending.depth };
    this.finishSearch(undefined, result);
  }

  private finishSearch(
    error?: Error,
    result: StockfishSearchResult | null = null,
  ): void {
    const pending = this.pendingSearch;
    if (!pending) return;
    this.pendingSearch = null;
    if (error) pending.reject(error);
    else pending.resolve(result);
  }

  private fail(error: Error): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.waiters.clear();
    this.finishSearch(error);
  }
}

let sharedClientPromise: Promise<StockfishClient> | null = null;
let sharedClient: StockfishClient | null = null;

export async function getStockfishClient(
  onProgress?: (progress: StockfishProgress) => void,
): Promise<StockfishClient> {
  if (typeof window === 'undefined') {
    throw new Error('Stockfish is only available in a browser.');
  }
  if (!sharedClientPromise) {
    sharedClientPromise = (async () => {
      await preloadEngineWasm(onProgress);
      onProgress?.({ loadedBytes: 0, totalBytes: null, phase: 'engine' });
      const client = new StockfishClient();
      await client.initialize();
      sharedClient = client;
      return client;
    })().catch((error: unknown) => {
      sharedClient = null;
      sharedClientPromise = null;
      throw error;
    });
  }
  return sharedClientPromise;
}

export function resetStockfishClient(): void {
  const client = sharedClient;
  sharedClient = null;
  sharedClientPromise = null;
  client?.terminate();
}
