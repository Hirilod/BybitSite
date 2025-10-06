import type { CandlePoint, IndexCandle, IndexSummary, MarketResponse, TimeframeId } from "./types";
import { TIMEFRAME_INTERVAL } from "./types";
import { subscribeMarketSnapshots as wsSubscribe } from "./wsClient";

const MARKET_ENDPOINT = "/api/market";
const SNAPSHOT_TIMEOUT_MS = 15000;

export type { CandlePoint, IndexCandle, IndexSummary, MarketResponse, TimeframeId };

export async function fetchMarketSnapshot(init?: RequestInit): Promise<MarketResponse> {
  const signal = init?.signal as AbortSignal | undefined;

  return new Promise<MarketResponse>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    let done = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: () => void = () => undefined;

    const finish = (complete: () => void) => {
      if (done) {
        return;
      }
      done = true;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      unsubscribe();
      unsubscribe = () => undefined;
      complete();
    };

    const onAbort = () => {
      finish(() => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    };

    unsubscribe = wsSubscribe(
      (snapshot) => {
        finish(() => {
          resolve(snapshot);
        });
      },
      (error) => {
        finish(() => {
          reject(error);
        });
      }
    );

    if (signal) {
      signal.addEventListener("abort", onAbort);
    }

    timeoutId = setTimeout(() => {
      finish(() => {
        reject(new Error("Timed out waiting for market snapshot"));
      });
    }, SNAPSHOT_TIMEOUT_MS);
  });
}

export function subscribeMarketSnapshots(
  handler: (snapshot: MarketResponse) => void,
  onError?: (error: Error) => void
): () => void {
  return wsSubscribe(handler, onError);
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
