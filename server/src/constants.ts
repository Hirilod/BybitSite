export const BYBIT_API_BASE = 'https://api.bybit.com';

export const TIMEFRAME_CONFIG = [
  { id: 'M1', label: 'M1', interval: '1', durationMs: 60 * 1000 },
  { id: 'M5', label: 'M5', interval: '5', durationMs: 5 * 60 * 1000 },
  { id: 'M15', label: 'M15', interval: '15', durationMs: 15 * 60 * 1000 },
  { id: 'M30', label: 'M30', interval: '30', durationMs: 30 * 60 * 1000 },
  { id: 'H1', label: 'H1', interval: '60', durationMs: 60 * 60 * 1000 },
  { id: 'H4', label: 'H4', interval: '240', durationMs: 4 * 60 * 60 * 1000 },
  { id: 'D1', label: 'D1', interval: 'D', durationMs: 24 * 60 * 60 * 1000 }
] as const;

export type TimeframeId = typeof TIMEFRAME_CONFIG[number]['id'];
