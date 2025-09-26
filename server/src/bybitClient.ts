import { BYBIT_API_BASE, TIMEFRAME_CONFIG, type TimeframeId } from './constants';
import type { CandleSnapshot, InstrumentSummary, TickerSnapshot } from './types';

const API_TIMEOUT_MS = 15000;

interface BybitResponse<T> {
  retCode: number;
  retMsg: string;
  result: T;
  retExtInfo?: unknown;
  time: number;
}

interface InstrumentsResult {
  category: string;
  list: Array<{
    symbol: string;
    contractType: string;
    status: string;
    baseCoin: string;
    quoteCoin: string;
  }>;
  nextPageCursor?: string;
}

interface TickersResult {
  category: string;
  list: Array<{
    symbol: string;
    lastPrice: string;
    bid1Price: string;
    ask1Price: string;
    prevPrice24h: string;
    price24hPcnt: string;
    highPrice24h: string;
    lowPrice24h: string;
    turnover24h: string;
    volume24h: string;
  }>;
}

interface KlineResult {
  symbol: string;
  category: string;
  list: Array<[
    string,
    string,
    string,
    string,
    string,
    string,
    string
  ]>;
}

function parseNumber(value: string | undefined | null): number | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchJson<T>(path: string): Promise<BybitResponse<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(`${BYBIT_API_BASE}${path}`, {
      method: 'GET',
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while fetching ${path}`);
    }
    const data = (await response.json()) as BybitResponse<T>;
    if (data.retCode !== 0) {
      throw new Error(`Bybit error ${data.retCode}: ${data.retMsg}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchLinearInstruments(): Promise<InstrumentSummary[]> {
  const instruments: InstrumentSummary[] = [];
  let cursor: string | undefined;
  do {
    const query = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const { result } = await fetchJson<InstrumentsResult>(
      `/v5/market/instruments-info?category=linear${query}`
    );
    for (const item of result.list) {
      if (item.status !== 'Trading') {
        continue;
      }
      instruments.push({
        symbol: item.symbol,
        baseCoin: item.baseCoin,
        quoteCoin: item.quoteCoin
      });
    }
    cursor = result.nextPageCursor && result.nextPageCursor !== '' ? result.nextPageCursor : undefined;
  } while (cursor);
  return instruments;
}

export async function fetchLinearTickers(): Promise<TickerSnapshot[]> {
  const { result } = await fetchJson<TickersResult>(
    '/v5/market/tickers?category=linear'
  );
  const now = Date.now();
  return result.list.map((item) => ({
    symbol: item.symbol,
    lastPrice: parseNumber(item.lastPrice),
    timestamp: now
  }));
}

const INTERVAL_BY_TIMEFRAME: Record<TimeframeId, string> = TIMEFRAME_CONFIG.reduce(
  (acc, item) => {
    acc[item.id] = item.interval;
    return acc;
  },
  {} as Record<TimeframeId, string>
);

export async function fetchLatestCandle(
  symbol: string,
  timeframe: TimeframeId
): Promise<CandleSnapshot | null> {
  const interval = INTERVAL_BY_TIMEFRAME[timeframe];
  const path = `/v5/market/kline?category=linear&symbol=${encodeURIComponent(
    symbol
  )}&interval=${interval}&limit=1`;
  const { result } = await fetchJson<KlineResult>(path);
  const [latest] = result.list;
  if (!latest) {
    return null;
  }
  const [start, open, high, low, close, volume, turnover] = latest;
  return {
    symbol,
    timeframe,
    startTime: Number(start),
    open: Number(open),
    high: Number(high),
    low: Number(low),
    close: Number(close),
    volume: Number(volume),
    turnover: Number(turnover),
    fetchedAt: Date.now()
  };
}

export async function fetchCandleSeries(
  symbol: string,
  timeframe: TimeframeId,
  limit: number
): Promise<CandleSnapshot[]> {
  const interval = INTERVAL_BY_TIMEFRAME[timeframe];
  const boundedLimit = Math.max(1, Math.min(limit, 1000));
  const path = `/v5/market/kline?category=linear&symbol=${encodeURIComponent(
    symbol
  )}&interval=${interval}&limit=${boundedLimit}`;
  const { result } = await fetchJson<KlineResult>(path);
  const now = Date.now();
  const items = result.list.map((row) => {
    const [start, open, high, low, close, volume, turnover] = row;
    return {
      symbol,
      timeframe,
      startTime: Number(start),
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
      turnover: Number(turnover),
      fetchedAt: now
    } satisfies CandleSnapshot;
  });
  return items.reverse();
}
