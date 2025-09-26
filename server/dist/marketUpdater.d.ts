import type { MarketResponse } from './types';
interface MarketUpdaterOptions {
    tickerIntervalMs?: number;
    candleIntervalMs?: number;
}
export declare class MarketUpdater {
    private readonly store;
    private readonly options;
    private instrumentsLoaded;
    private running;
    private tickerTimer;
    private candleTimer;
    private symbols;
    private symbolCursor;
    private timeframeCursor;
    constructor(options?: MarketUpdaterOptions);
    bootstrap(): Promise<void>;
    start(): void;
    stop(): void;
    getSnapshot(): MarketResponse;
    private ensureBootstrap;
    private scheduleTickerLoop;
    private scheduleCandleLoop;
    private advanceCursor;
}
export {};
//# sourceMappingURL=marketUpdater.d.ts.map