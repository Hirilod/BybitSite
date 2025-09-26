import type { CandleSnapshot, InstrumentSummary, MarketTableEntry, TimeframeOverviewItem, TickerSnapshot } from './types';
export declare class MarketStore {
    private instruments;
    private entries;
    setInstruments(list: InstrumentSummary[]): void;
    updateTicker(snapshot: TickerSnapshot): void;
    updateCandle(snapshot: CandleSnapshot): void;
    toTableEntries(): MarketTableEntry[];
    buildOverview(): TimeframeOverviewItem[];
}
//# sourceMappingURL=marketStore.d.ts.map