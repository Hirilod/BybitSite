import { TIMEFRAME_CONFIG, type TimeframeId } from './constants';
import type {
  CandleSnapshot,
  InstrumentSummary,
  MarketEntry,
  MarketTableEntry,
  TimeframeMetrics,
  TimeframeOverviewItem,
  TickerSnapshot
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

function createEmptyEntry(instrument: InstrumentSummary): MarketEntry {
  return {
    instrument,
    lastPrice: null,
    lastPriceUpdatedAt: null,
    metricsByTimeframe: {}
  };
}

function calculateChangePercent(price: number | null, openPrice: number): number | null {
  if (price === null) {
    return null;
  }
  if (openPrice === 0) {
    return null;
  }
  const change = ((price - openPrice) / openPrice) * 100;
  if (!Number.isFinite(change)) {
    return null;
  }
  return change;
}

const TIMEFRAME_DURATION = new Map<TimeframeId, number>(
  TIMEFRAME_CONFIG.map((item) => [item.id as TimeframeId, item.durationMs])
);

export class MarketStore {
  private instruments = new Map<string, InstrumentSummary>();
  private entries = new Map<string, MarketEntry>();

  setInstruments(list: InstrumentSummary[]): void {
    const incoming = new Set<string>();
    for (const instrument of list) {
      incoming.add(instrument.symbol);
      this.instruments.set(instrument.symbol, instrument);
      if (!this.entries.has(instrument.symbol)) {
        this.entries.set(instrument.symbol, createEmptyEntry(instrument));
      } else {
        const existing = this.entries.get(instrument.symbol)!;
        existing.instrument = instrument;
      }
    }
    for (const key of this.entries.keys()) {
      if (!incoming.has(key)) {
        this.entries.delete(key);
        this.instruments.delete(key);
      }
    }
  }

  updateTicker(snapshot: TickerSnapshot): void {
    const instrument = this.instruments.get(snapshot.symbol) ?? {
      symbol: snapshot.symbol,
      baseCoin: snapshot.symbol,
      quoteCoin: ''
    };
    if (!this.entries.has(snapshot.symbol)) {
      this.entries.set(snapshot.symbol, createEmptyEntry(instrument));
    }
    const entry = this.entries.get(snapshot.symbol);
    if (!entry) {
      return;
    }
    entry.lastPrice = snapshot.lastPrice;
    entry.lastPriceUpdatedAt = snapshot.timestamp;
    const metrics = entry.metricsByTimeframe;
    for (const item of TIMEFRAME_CONFIG) {
      const tf = item.id as TimeframeId;
      if (tf === 'D1') {
        continue;
      }
      const tfMetrics = metrics[tf];
      if (!tfMetrics) {
        continue;
      }
      tfMetrics.changePercent = calculateChangePercent(snapshot.lastPrice, tfMetrics.openPrice);
      tfMetrics.updatedAt = snapshot.timestamp;
    }

    const { prevPrice24h, price24hPercent, turnover24h } = snapshot;
    if (prevPrice24h !== null || price24hPercent !== null || turnover24h !== null) {
      const existing = metrics.D1;
      const openPrice = prevPrice24h ?? existing?.openPrice ?? snapshot.lastPrice ?? 0;
      const changePercent = price24hPercent !== null
        ? price24hPercent * 100
        : calculateChangePercent(snapshot.lastPrice, openPrice);
      const turnover = turnover24h ?? existing?.turnover ?? 0;
      const volume = turnover24h ?? existing?.volume ?? 0;
      metrics.D1 = {
        timeframe: 'D1',
        openPrice,
        openTime: snapshot.timestamp - DAY_MS,
        changePercent,
        volume,
        turnover,
        updatedAt: snapshot.timestamp
      };
    }
  }

  updateCandle(snapshot: CandleSnapshot): void {
    if (snapshot.timeframe === 'D1') {
      return;
    }
    const instrument = this.instruments.get(snapshot.symbol) ?? {
      symbol: snapshot.symbol,
      baseCoin: snapshot.symbol,
      quoteCoin: ''
    };
    if (!this.entries.has(snapshot.symbol)) {
      this.entries.set(snapshot.symbol, createEmptyEntry(instrument));
    }
    const entry = this.entries.get(snapshot.symbol);
    if (!entry) {
      return;
    }
    const changePercent = calculateChangePercent(snapshot.close, snapshot.open);
    const metrics: TimeframeMetrics = {
      timeframe: snapshot.timeframe,
      openPrice: snapshot.open,
      openTime: snapshot.startTime,
      changePercent,
      volume: snapshot.volume,
      turnover: snapshot.turnover,
      updatedAt: snapshot.fetchedAt
    };
    entry.metricsByTimeframe[snapshot.timeframe] = metrics;
  }

  toTableEntries(): MarketTableEntry[] {
    const entries: MarketTableEntry[] = [];
    for (const entry of this.entries.values()) {
      entries.push({
        symbol: entry.instrument.symbol,
        baseCoin: entry.instrument.baseCoin,
        quoteCoin: entry.instrument.quoteCoin,
        lastPrice: entry.lastPrice,
        lastPriceUpdatedAt: entry.lastPriceUpdatedAt,
        metrics: entry.metricsByTimeframe
      });
    }
    return entries;
  }

  buildOverview(): TimeframeOverviewItem[] {
    const overview: TimeframeOverviewItem[] = [];
    const now = Date.now();
    for (const { id } of TIMEFRAME_CONFIG) {
      const timeframe = id as TimeframeId;
      const duration = TIMEFRAME_DURATION.get(timeframe) ?? Number.POSITIVE_INFINITY;
      let gainers = 0;
      let losers = 0;
      for (const entry of this.entries.values()) {
        const metrics = entry.metricsByTimeframe[timeframe];
        if (!metrics || metrics.changePercent === null) {
          continue;
        }
        const age = now - metrics.openTime;
        if (age > duration) {
          continue;
        }
        if (metrics.changePercent > 0) {
          gainers += 1;
        } else if (metrics.changePercent < 0) {
          losers += 1;
        }
      }
      overview.push({ timeframe, gainers, losers });
    }
    return overview;
  }
}
