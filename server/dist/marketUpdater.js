"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketUpdater = void 0;
const constants_1 = require("./constants");
const bybitClient_1 = require("./bybitClient");
const marketStore_1 = require("./marketStore");
const DEFAULT_OPTIONS = {
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
const POPULAR_PRIORITY = new Map(POPULAR_SYMBOLS.map((symbol, index) => [symbol, index]));
function popularityRank(symbol) {
    return POPULAR_PRIORITY.get(symbol) ?? Number.POSITIVE_INFINITY;
}
class MarketUpdater {
    store = new marketStore_1.MarketStore();
    options;
    instrumentsLoaded = false;
    running = false;
    tickerTimer = null;
    candleTimer = null;
    symbols = [];
    symbolCursor = 0;
    timeframeCursor = 0;
    constructor(options = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }
    async bootstrap() {
        const instruments = await (0, bybitClient_1.fetchLinearInstruments)();
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
    start() {
        if (this.running) {
            return;
        }
        this.running = true;
        void this.ensureBootstrap().then(() => {
            this.scheduleTickerLoop();
            this.scheduleCandleLoop();
        });
    }
    stop() {
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
    getSnapshot() {
        return {
            updatedAt: Date.now(),
            entries: this.store.toTableEntries(),
            overview: this.store.buildOverview()
        };
    }
    async ensureBootstrap() {
        if (this.instrumentsLoaded) {
            return;
        }
        await this.bootstrap();
    }
    scheduleTickerLoop() {
        const loop = async () => {
            if (!this.running) {
                return;
            }
            try {
                const tickers = await (0, bybitClient_1.fetchLinearTickers)();
                for (const ticker of tickers) {
                    this.store.updateTicker(ticker);
                }
            }
            catch (error) {
                console.error('[market] ticker update failed', error);
            }
            finally {
                if (this.running) {
                    this.tickerTimer = setTimeout(loop, this.options.tickerIntervalMs);
                }
            }
        };
        void loop();
    }
    scheduleCandleLoop() {
        const loop = async () => {
            if (!this.running) {
                return;
            }
            if (this.symbols.length === 0) {
                this.candleTimer = setTimeout(loop, this.options.candleIntervalMs);
                return;
            }
            const timeframe = constants_1.TIMEFRAME_CONFIG[this.timeframeCursor].id;
            const symbol = this.symbols[this.symbolCursor];
            try {
                const candle = await (0, bybitClient_1.fetchLatestCandle)(symbol, timeframe);
                if (candle) {
                    this.store.updateCandle(candle);
                }
            }
            catch (error) {
                console.error('[market] candle update failed', { symbol, timeframe, error });
            }
            finally {
                this.advanceCursor();
                if (this.running) {
                    this.candleTimer = setTimeout(loop, this.options.candleIntervalMs);
                }
            }
        };
        void loop();
    }
    advanceCursor() {
        if (this.symbols.length === 0) {
            this.symbolCursor = 0;
            this.timeframeCursor = 0;
            return;
        }
        this.timeframeCursor += 1;
        if (this.timeframeCursor >= constants_1.TIMEFRAME_CONFIG.length) {
            this.timeframeCursor = 0;
            this.symbolCursor += 1;
            if (this.symbolCursor >= this.symbols.length) {
                this.symbolCursor = 0;
            }
        }
    }
}
exports.MarketUpdater = MarketUpdater;
//# sourceMappingURL=marketUpdater.js.map