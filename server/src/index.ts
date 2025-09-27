import cors from 'cors';
import express from 'express';
import { MarketUpdater } from './marketUpdater';
import { TIMEFRAME_CONFIG, type TimeframeId } from './constants';
import { fetchCandleSeries } from './bybitClient';

const PORT = Number(process.env.PORT ?? '4000');

const TIMEFRAME_SET = new Set(TIMEFRAME_CONFIG.map((item) => item.id));

function isTimeframeId(value: string | undefined | null): value is TimeframeId {
  return value !== undefined && value !== null && TIMEFRAME_SET.has(value as TimeframeId);
}

async function main(): Promise<void> {
  const app = express();
  app.use(cors());

  const marketUpdater = new MarketUpdater();
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
    const timeframe: TimeframeId = isTimeframeId(timeframeParam) ? timeframeParam : 'H1';
    const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : Number.NaN;
    const limit = Number.isFinite(limitRaw) ? limitRaw : 500;

    try {
      const candles = await fetchCandleSeries(symbol, timeframe, limit);
      res.json({
        symbol,
        timeframe,
        candles: candles.map((item) => ({
          openTime: item.startTime,
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close,
          prevClose: item.prevClose,
          volume: item.volume
        }))
      });
    } catch (error) {
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
