import type { MarketResponse, CandlePoint, TimeframeId } from "./types";
import { TIMEFRAME_INTERVAL } from "./types";

const MARKET_ENDPOINT = "/api/market";

export async function fetchMarketSnapshot(init?: RequestInit): Promise<MarketResponse> {
  const response = await fetch(MARKET_ENDPOINT, init);
  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }
  const data = (await response.json()) as MarketResponse;
  return data;
}

export async function fetchCandles(
  symbol: string,
  timeframe: TimeframeId,
  limit = 500
): Promise<CandlePoint[]> {
  const interval = TIMEFRAME_INTERVAL[timeframe];
  const params = new URLSearchParams({ timeframe, interval, limit: limit.toString() });
  const response = await fetch(`${MARKET_ENDPOINT}/${encodeURIComponent(symbol)}/candles?${params}`);
  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }
  const payload = (await response.json()) as { candles: CandlePoint[] };
  return payload.candles;
}
