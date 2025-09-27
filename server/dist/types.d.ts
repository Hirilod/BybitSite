import type { TimeframeId } from './constants';
export interface InstrumentSummary {
    symbol: string;
    baseCoin: string;
    quoteCoin: string;
}
export interface TickerSnapshot {
    symbol: string;
    lastPrice: number | null;
    prevPrice24h: number | null;
    price24hPercent: number | null;
    turnover24h: number | null;
    timestamp: number;
}
export interface CandleSnapshot {
    symbol: string;
    timeframe: TimeframeId;
    startTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    prevClose: number | null;
    volume: number;
    turnover: number;
    fetchedAt: number;
}
export interface TimeframeMetrics {
    timeframe: TimeframeId;
    openPrice: number;
    baselinePrice: number | null;
    openTime: number;
    changePercent: number | null;
    volume: number;
    turnover: number;
    updatedAt: number;
}
export interface MarketEntry {
    instrument: InstrumentSummary;
    lastPrice: number | null;
    lastPriceUpdatedAt: number | null;
    metricsByTimeframe: Partial<Record<TimeframeId, TimeframeMetrics>>;
}
export interface MarketSummary {
    entries: MarketEntry[];
    generatedAt: number;
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
export interface MarketTableEntry {
    symbol: string;
    baseCoin: string;
    quoteCoin: string;
    lastPrice: number | null;
    lastPriceUpdatedAt: number | null;
    metrics: Partial<Record<TimeframeId, TimeframeMetrics>>;
}
//# sourceMappingURL=types.d.ts.map