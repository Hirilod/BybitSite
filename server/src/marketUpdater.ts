import { TIMEFRAME_CONFIG, type TimeframeId } from './constants';
import {
  fetchLatestCandle,
  fetchLinearInstruments,
  fetchLinearTickers
} from './bybitClient';
import { MarketStore } from './marketStore';
import type { MarketResponse } from './types';

interface MarketUpdaterOptions {
  tickerIntervalMs?: number;
  candleIntervalMs?: number;
}

const DEFAULT_OPTIONS: Required<MarketUpdaterOptions> = {
  tickerIntervalMs: 3000,
  candleIntervalMs: 100
};

const POPULAR_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'XRPUSDT',
  'BNBUSDT',
  'DOGEUSDT',
  'ADAUSDT',
  'LTCUSDT'
];

const POPULAR_PRIORITY = new Map<string, number>(
  POPULAR_SYMBOLS.map((symbol, index) => [symbol, index])
);

function popularityRank(symbol: string): number {
  return POPULAR_PRIORITY.get(symbol) ?? Number.POSITIVE_INFINITY;
}

export class MarketUpdater {
  private readonly store = new MarketStore();
  private readonly options: Required<MarketUpdaterOptions>;
  private instrumentsLoaded = false;
  private running = false;
  private tickerTimer: NodeJS.Timeout | null = null;
  private candleTimer: NodeJS.Timeout | null = null;
  private symbols: string[] = [];
  private symbolCursor = 0;
  private timeframeCursor = 0;

  constructor(options: MarketUpdaterOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async bootstrap(): Promise<void> {
    const instruments = await fetchLinearInstruments();
    const sortedInstruments = [...instruments].sort((a, b) => {
      const diff = popularityRank(a.symbol) - popularityRank(b.symbol);
      if (diff !== 0) {
        return diff;
      }
      return a.symbol.localeCompare(b.symbol);
    });
    this.store.setInstruments(sortedInstruments);
    this.symbols = sortedInstruments.map((item) => item.symbol);
    this.instrumentsLoaded = true;
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    void this.ensureBootstrap().then(() => {
      this.scheduleTickerLoop();
      this.scheduleCandleLoop();
    });
  }

  stop(): void {
    this.running = false;
    if (this.tickerTimer) {
      clearTimeout(this.tickerTimer);
      this.tickerTimer = null;
    }
    if (this.candleTimer) {
      clearTimeout(this.candleTimer);
      this.candleTimer = null;
    }
  }

  getSnapshot(): MarketResponse {
    return {
      updatedAt: Date.now(),
      entries: this.store.toTableEntries(),
      overview: this.store.buildOverview()
    };
  }

  private async ensureBootstrap(): Promise<void> {
    if (this.instrumentsLoaded) {
      return;
    }
    await this.bootstrap();
  }

  private scheduleTickerLoop(): void {
    const loop = async (): Promise<void> => {
      if (!this.running) {
        return;
      }
      try {
        const tickers = await fetchLinearTickers();
        for (const ticker of tickers) {
          this.store.updateTicker(ticker);
        }
      } catch (error) {
        console.error('[market] ticker update failed', error);
      } finally {
        if (this.running) {
          this.tickerTimer = setTimeout(loop, this.options.tickerIntervalMs);
        }
      }
    };
    void loop();
  }

  private scheduleCandleLoop(): void {
    const loop = async (): Promise<void> => {
      if (!this.running) {
        return;
      }
      if (this.symbols.length === 0) {
        this.candleTimer = setTimeout(loop, this.options.candleIntervalMs);
        return;
      }
      const timeframe = TIMEFRAME_CONFIG[this.timeframeCursor]!.id as TimeframeId;
      const symbol = this.symbols[this.symbolCursor]!;
      try {
        const candle = await fetchLatestCandle(symbol, timeframe);
        if (candle) {
          this.store.updateCandle(candle);
        }
      } catch (error) {
        console.error('[market] candle update failed', { symbol, timeframe, error });
      } finally {
        this.advanceCursor();
        if (this.running) {
          this.candleTimer = setTimeout(loop, this.options.candleIntervalMs);
        }
      }
    };
    void loop();
  }

  private advanceCursor(): void {
    if (this.symbols.length === 0) {
      this.symbolCursor = 0;
      this.timeframeCursor = 0;
      return;
    }
    this.timeframeCursor += 1;
    if (this.timeframeCursor >= TIMEFRAME_CONFIG.length) {
      this.timeframeCursor = 0;
      this.symbolCursor += 1;
      if (this.symbolCursor >= this.symbols.length) {
        this.symbolCursor = 0;
      }
    }
  }
}

