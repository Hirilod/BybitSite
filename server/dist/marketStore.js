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
            if (tf === 'D1') {
                continue;
            }
            const duration = TIMEFRAME_DURATION.get(tf);
            if (!duration || !Number.isFinite(duration)) {
                continue;
            }
            const periodStart = Math.floor(snapshot.timestamp / duration) * duration;
            let tfMetrics = metrics[tf];
            if (!tfMetrics || tfMetrics.openTime !== periodStart) {
                tfMetrics = {
                    timeframe: tf,
                    openPrice: snapshot.lastPrice ?? 0,
                    openTime: periodStart,
                    changePercent: 0,
                    volume: 0,
                    turnover: 0,
                    updatedAt: snapshot.timestamp
                };
                metrics[tf] = tfMetrics;
            }
            tfMetrics.changePercent = calculateChangePercent(snapshot.lastPrice, tfMetrics.openPrice);
            tfMetrics.updatedAt = snapshot.timestamp;
        }
        const { prevPrice24h, price24hPercent, turnover24h } = snapshot;
        const d1Duration = TIMEFRAME_DURATION.get('D1') ?? 24 * 60 * 60 * 1000;
        const periodStart = Math.floor(snapshot.timestamp / d1Duration) * d1Duration;
        const existingD1 = metrics.D1;
        const openPrice = prevPrice24h ?? existingD1?.openPrice ?? snapshot.lastPrice ?? 0;
        const changePercent = price24hPercent !== null
            ? price24hPercent * 100
            : calculateChangePercent(snapshot.lastPrice, openPrice);
        const volume = turnover24h ?? existingD1?.volume ?? 0;
        const turnover = turnover24h ?? existingD1?.turnover ?? 0;
        metrics.D1 = {
            timeframe: 'D1',
            openPrice,
            openTime: periodStart,
            changePercent,
            volume,
            turnover,
            updatedAt: snapshot.timestamp
        };
    }
    updateCandle(snapshot) {
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
        const metrics = {
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