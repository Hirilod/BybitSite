"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketStore = void 0;
const constants_1 = require("./constants");
function createEmptyEntry(instrument) {
    return {
        instrument,
        lastPrice: null,
        lastPriceUpdatedAt: null,
        metricsByTimeframe: {}
    };
}
function calculateChangePercent(price, openPrice) {
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
const TIMEFRAME_DURATION = new Map(constants_1.TIMEFRAME_CONFIG.map((item) => [item.id, item.durationMs]));
class MarketStore {
    instruments = new Map();
    entries = new Map();
    setInstruments(list) {
        const incoming = new Set();
        for (const instrument of list) {
            incoming.add(instrument.symbol);
            this.instruments.set(instrument.symbol, instrument);
            if (!this.entries.has(instrument.symbol)) {
                this.entries.set(instrument.symbol, createEmptyEntry(instrument));
            }
            else {
                const existing = this.entries.get(instrument.symbol);
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
    updateTicker(snapshot) {
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
        for (const item of constants_1.TIMEFRAME_CONFIG) {
            const tf = item.id;
            const tfMetrics = metrics[tf];
            if (!tfMetrics) {
                continue;
            }
            const baseline = tfMetrics.baselinePrice ?? tfMetrics.openPrice;
            if (baseline === null || baseline === undefined) {
                continue;
            }
            tfMetrics.changePercent = calculateChangePercent(snapshot.lastPrice, baseline);
            tfMetrics.updatedAt = snapshot.timestamp;
        }
        const d1Metrics = metrics.D1;
        if (!d1Metrics && snapshot.prevPrice24h !== null) {
            metrics.D1 = {
                timeframe: 'D1',
                openPrice: snapshot.prevPrice24h,
                baselinePrice: snapshot.prevPrice24h,
                openTime: snapshot.timestamp,
                changePercent: calculateChangePercent(snapshot.lastPrice, snapshot.prevPrice24h),
                volume: snapshot.turnover24h ?? 0,
                turnover: snapshot.turnover24h ?? 0,
                updatedAt: snapshot.timestamp
            };
        }
        else if (d1Metrics) {
            if ((d1Metrics.baselinePrice === null || d1Metrics.baselinePrice === undefined) && snapshot.prevPrice24h !== null) {
                d1Metrics.baselinePrice = snapshot.prevPrice24h;
            }
            const baseline = d1Metrics.baselinePrice ?? d1Metrics.openPrice;
            if (baseline !== null && baseline !== undefined) {
                d1Metrics.changePercent = calculateChangePercent(snapshot.lastPrice, baseline);
                d1Metrics.updatedAt = snapshot.timestamp;
            }
        }
    }
    updateCandle(snapshot) {
        const instrument = this.instruments.get(snapshot.symbol) ?? {
            symbol: snapshot.symbol,
            baseCoin: snapshot.symbol,
            quoteCoin: '',
        };
        if (!this.entries.has(snapshot.symbol)) {
            this.entries.set(snapshot.symbol, createEmptyEntry(instrument));
        }
        const entry = this.entries.get(snapshot.symbol);
        if (!entry) {
            return;
        }
        const baseline = snapshot.prevClose ?? snapshot.open;
        const changePercent = baseline !== null ? calculateChangePercent(snapshot.close, baseline) : null;
        const metrics = {
            timeframe: snapshot.timeframe,
            openPrice: snapshot.open,
            baselinePrice: baseline ?? null,
            openTime: snapshot.startTime,
            changePercent,
            volume: snapshot.volume,
            turnover: snapshot.turnover,
            updatedAt: snapshot.fetchedAt,
        };
        entry.metricsByTimeframe[snapshot.timeframe] = metrics;
    }
    toTableEntries() {
        const entries = [];
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
    buildOverview() {
        const overview = [];
        const now = Date.now();
        for (const { id } of constants_1.TIMEFRAME_CONFIG) {
            const timeframe = id;
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
                }
                else if (metrics.changePercent < 0) {
                    losers += 1;
                }
            }
            overview.push({ timeframe, gainers, losers });
        }
        return overview;
    }
}
exports.MarketStore = MarketStore;
//# sourceMappingURL=marketStore.js.map