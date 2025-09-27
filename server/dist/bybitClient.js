"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchLinearInstruments = fetchLinearInstruments;
exports.fetchLinearTickers = fetchLinearTickers;
exports.fetchLatestCandle = fetchLatestCandle;
exports.fetchCandleSeries = fetchCandleSeries;
const constants_1 = require("./constants");
const API_TIMEOUT_MS = 15000;
function parseNumber(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
async function fetchJson(path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
        const response = await fetch(`${constants_1.BYBIT_API_BASE}${path}`, {
            method: 'GET',
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} while fetching ${path}`);
        }
        const data = (await response.json());
        if (data.retCode !== 0) {
            throw new Error(`Bybit error ${data.retCode}: ${data.retMsg}`);
        }
        return data;
    }
    finally {
        clearTimeout(timeout);
    }
}
async function fetchLinearInstruments() {
    const instruments = [];
    let cursor;
    do {
        const query = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
        const { result } = await fetchJson(`/v5/market/instruments-info?category=linear${query}`);
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
async function fetchLinearTickers() {
    const { result } = await fetchJson('/v5/market/tickers?category=linear');
    const now = Date.now();
    return result.list.map((item) => ({
        symbol: item.symbol,
        lastPrice: parseNumber(item.lastPrice),
        prevPrice24h: parseNumber(item.prevPrice24h),
        price24hPercent: parseNumber(item.price24hPcnt),
        turnover24h: parseNumber(item.turnover24h),
        timestamp: now
    }));
}
const INTERVAL_BY_TIMEFRAME = constants_1.TIMEFRAME_CONFIG.reduce((acc, item) => {
    acc[item.id] = item.interval;
    return acc;
}, {});
async function fetchLatestCandle(symbol, timeframe) {
    const interval = INTERVAL_BY_TIMEFRAME[timeframe];
    const path = `/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=2`;
    const { result } = await fetchJson(path);
    if (!result.list || result.list.length === 0) {
        return null;
    }
    const sorted = [...result.list].sort((a, b) => Number(a[0]) - Number(b[0]));
    const latest = sorted[sorted.length - 1];
    if (!latest) {
        return null;
    }
    const previous = sorted.length > 1 ? sorted[sorted.length - 2] : undefined;
    const [start, open, high, low, close, volume, turnover] = latest;
    const prevClose = previous ? Number(previous[4]) : null;
    return {
        symbol,
        timeframe,
        startTime: Number(start),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        prevClose,
        volume: Number(volume),
        turnover: Number(turnover),
        fetchedAt: Date.now(),
    };
}
async function fetchCandleSeries(symbol, timeframe, limit) {
    const interval = INTERVAL_BY_TIMEFRAME[timeframe];
    const boundedLimit = Math.max(1, Math.min(limit, 1000));
    const path = `/v5/market/kline?category=linear&symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${boundedLimit}`;
    const { result } = await fetchJson(path);
    const now = Date.now();
    const sorted = [...result.list].sort((a, b) => Number(a[0]) - Number(b[0]));
    const items = sorted.map((row, index, array) => {
        const [start, open, high, low, close, volume, turnover] = row;
        const prev = index > 0 ? array[index - 1] : undefined;
        return {
            symbol,
            timeframe,
            startTime: Number(start),
            open: Number(open),
            high: Number(high),
            low: Number(low),
            close: Number(close),
            prevClose: prev ? Number(prev[4]) : null,
            volume: Number(volume),
            turnover: Number(turnover),
            fetchedAt: now,
        };
    });
    return items;
}
//# sourceMappingURL=bybitClient.js.map