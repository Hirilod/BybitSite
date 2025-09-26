export const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'] as const;
export type TimeframeId = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_INTERVAL: Record<TimeframeId, string> = {
  M1: '1',
  M5: '5',
  M15: '15',
  M30: '30',
  H1: '60',
  H4: '240',
  D1: 'D'
};

export const TIMEFRAME_LABEL: Record<TimeframeId, string> = {
  M1: '1 минута',
  M5: '5 минут',
  M15: '15 минут',
  M30: '30 минут',
  H1: '1 час',
  H4: '4 часа',
  D1: '1 день'
};

export interface TimeframeMetrics {
  timeframe: TimeframeId;
  openPrice: number;
  openTime: number;
  changePercent: number | null;
  volume: number;
  turnover: number;
  updatedAt: number;
}

export interface MarketTableEntry {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  lastPrice: number | null;
  lastPriceUpdatedAt: number | null;
  metrics: Partial<Record<TimeframeId, TimeframeMetrics>>;
}

export interface TimeframeOverviewItem {
  timeframe: TimeframeId;
  gainers: number;
  losers: number;
}

export interface MarketResponse {
  updatedAt: number;
  entries: MarketTableEntry[];
  overview: TimeframeOverviewItem[];
}

export interface CandlePoint {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export const TIMEFRAME_DURATION_MS: Record<TimeframeId, number> = {
  M1: 60 * 1000,
  M5: 5 * 60 * 1000,
  M15: 15 * 60 * 1000,
  M30: 30 * 60 * 1000,
  H1: 60 * 60 * 1000,
  H4: 4 * 60 * 60 * 1000,
  D1: 24 * 60 * 60 * 1000
};