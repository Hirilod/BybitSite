"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const marketUpdater_1 = require("./marketUpdater");
const constants_1 = require("./constants");
const bybitClient_1 = require("./bybitClient");
const PORT = Number(process.env.PORT ?? '4000');
const TIMEFRAME_SET = new Set(constants_1.TIMEFRAME_CONFIG.map((item) => item.id));
function isTimeframeId(value) {
    return value !== undefined && value !== null && TIMEFRAME_SET.has(value);
}
async function main() {
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    const marketUpdater = new marketUpdater_1.MarketUpdater();
    await marketUpdater.bootstrap();
    marketUpdater.start();
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', time: Date.now() });
    });
    app.get('/api/market', (_req, res) => {
        const snapshot = marketUpdater.getSnapshot();
        res.json(snapshot);
    });
    app.get('/api/market/:symbol/candles', async (req, res) => {
        const symbol = String(req.params.symbol ?? '').toUpperCase();
        if (!symbol) {
            res.status(400).json({ error: 'Symbol is required' });
            return;
        }
        const timeframeParam = typeof req.query.timeframe === 'string' ? req.query.timeframe : undefined;
        const timeframe = isTimeframeId(timeframeParam) ? timeframeParam : 'H1';
        const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : Number.NaN;
        const limit = Number.isFinite(limitRaw) ? limitRaw : 500;
        try {
            const candles = await (0, bybitClient_1.fetchCandleSeries)(symbol, timeframe, limit);
            res.json({
                symbol,
                timeframe,
                candles: candles.map((item) => ({
                    openTime: item.startTime,
                    open: item.open,
                    high: item.high,
                    low: item.low,
                    close: item.close,
                    volume: item.volume
                }))
            });
        }
        catch (error) {
            console.error('Failed to fetch candle series', { symbol, timeframe, error });
            res.status(502).json({ error: 'Failed to load candle data' });
        }
    });
    app.listen(PORT, () => {
        console.log(`Server listening on http://localhost:${PORT}`);
    });
}
void main().catch((error) => {
    console.error('Fatal error while starting server', error);
    process.exitCode = 1;
});
//# sourceMappingURL=index.js.map