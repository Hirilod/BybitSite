import { type TimeframeId } from './constants';
import type { CandleSnapshot, InstrumentSummary, TickerSnapshot } from './types';
export declare function fetchLinearInstruments(): Promise<InstrumentSummary[]>;
export declare function fetchLinearTickers(): Promise<TickerSnapshot[]>;
export declare function fetchLatestCandle(symbol: string, timeframe: TimeframeId): Promise<CandleSnapshot | null>;
export declare function fetchCandleSeries(symbol: string, timeframe: TimeframeId, limit: number): Promise<CandleSnapshot[]>;
//# sourceMappingURL=bybitClient.d.ts.map