import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import classNames from 'classnames';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/ru';
import { fetchMarketSnapshot } from '../api';
import type { MarketResponse, MarketTableEntry, TimeframeId } from '../types';
import { TIMEFRAMES } from '../types';

dayjs.extend(relativeTime);
dayjs.locale('ru');

type SortDirection = 'asc' | 'desc';

type FlashDirection = 'up' | 'down';

interface SortState {
  timeframe: TimeframeId;
  direction: SortDirection;
}

const POLL_INTERVAL_MS = 3000;
const FLASH_DURATION_MS = 1200;

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

const POPULAR_PRIORITY = new Map<string, number>(
  POPULAR_SYMBOLS.map((symbol, index) => [symbol, index])
);

function popularityRank(symbol: string): number {
  return POPULAR_PRIORITY.get(symbol) ?? Number.POSITIVE_INFINITY;
}

function sortByPopularity(entries: MarketTableEntry[]): MarketTableEntry[] {
  return [...entries].sort((a, b) => {
    const rankDiff = popularityRank(a.symbol) - popularityRank(b.symbol);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return a.symbol.localeCompare(b.symbol);
  });
}

function formatPrice(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return '—';
  }
  const absValue = Math.abs(value);
  const fractionDigits = absValue >= 1000 ? 0 : absValue >= 100 ? 1 : absValue >= 1 ? 2 : 4;
  return value.toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits
  });
}

function formatPercent(value: number | null): { text: string; direction?: FlashDirection } {
  if (value === null || !Number.isFinite(value)) {
    return { text: '—' };
  }
  const fixed = Math.abs(value) >= 100 ? 1 : 2;
  const formatted = Math.abs(value).toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: fixed
  });
  if (value > 0) {
    return { text: `▲ ${formatted}%`, direction: 'up' };
  }
  if (value < 0) {
    return { text: `▼ ${formatted}%`, direction: 'down' };
  }
  return { text: `${formatted}%` };
}

function formatVolume(value: number | null | undefined, direction?: FlashDirection): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  const arrow = direction === 'up' ? '▲ ' : direction === 'down' ? '▼ ' : '';
  return `${arrow}${value.toLocaleString('ru-RU', {
    notation: 'compact',
    maximumFractionDigits: 2
  })}`;
}

function getChangeClass(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '';
  }
  if (value > 0) {
    return 'change-positive';
  }
  if (value < 0) {
    return 'change-negative';
  }
  return '';
}

function applySort(entries: MarketTableEntry[], sort: SortState | null): MarketTableEntry[] {
  const list = [...entries];
  if (!sort) {
    return sortByPopularity(list);
  }
  const { timeframe, direction } = sort;
  const factor = direction === 'desc' ? -1 : 1;
  return list.sort((a, b) => {
    const aValue = a.metrics[timeframe]?.changePercent;
    const bValue = b.metrics[timeframe]?.changePercent;
    const safe = (value: number | null | undefined): number => {
      if (value === null || value === undefined || !Number.isFinite(value)) {
        return direction === 'desc' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
      }
      return value;
    };
    const diff = safe(aValue) - safe(bValue);
    if (diff !== 0) {
      return diff * factor;
    }
    const popularityDiff = popularityRank(a.symbol) - popularityRank(b.symbol);
    if (popularityDiff !== 0) {
      return popularityDiff;
    }
    return a.symbol.localeCompare(b.symbol);
  });
}

export function MarketPage(): JSX.Element {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState | null>(null);
  const [flashes, setFlashes] = useState<Record<string, FlashDirection>>({});

  const previousSnapshotRef = useRef<MarketResponse | null>(null);
  const flashTimersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const load = async () => {
      try {
        const snapshot = await fetchMarketSnapshot();
        if (!active) {
          return;
        }
        setData(snapshot);
        setError(null);
        setLoading(false);
      } catch (err) {
        console.error(err);
        if (!active) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Неизвестная ошибка');
        setLoading(false);
      }
    };

    void load();
    timer = window.setInterval(load, POLL_INTERVAL_MS);

    return () => {
      active = false;
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const timer of flashTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      flashTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!data) {
      return;
    }
    const previous = previousSnapshotRef.current;
    const updates: Record<string, FlashDirection> = {};

    if (previous) {
      const previousMap = new Map(previous.entries.map((entry) => [entry.symbol, entry]));
      for (const entry of data.entries) {
        const prevEntry = previousMap.get(entry.symbol);
        if (!prevEntry) {
          continue;
        }
        for (const timeframe of TIMEFRAMES) {
          const metric = entry.metrics[timeframe];
          const prevMetric = prevEntry.metrics[timeframe];
          if (metric && prevMetric) {
            const currentChange = metric.changePercent;
            const previousChange = prevMetric.changePercent;
            if (currentChange !== null && previousChange !== null && currentChange !== previousChange) {
              const delta = currentChange - previousChange;
              updates[`change|${entry.symbol}|${timeframe}`] = delta >= 0 ? 'up' : 'down';
            }
            const currentVolume = metric.turnover;
            const previousVolume = prevMetric.turnover;
            if (Number.isFinite(currentVolume) && Number.isFinite(previousVolume) && currentVolume !== previousVolume) {
              const delta = currentVolume - previousVolume;
              updates[`volume|${entry.symbol}|${timeframe}`] = delta >= 0 ? 'up' : 'down';
            }
          }
        }
      }
    }

    previousSnapshotRef.current = data;

    if (Object.keys(updates).length === 0) {
      return;
    }

    setFlashes((prev) => {
      const next = { ...prev, ...updates };
      for (const [key, direction] of Object.entries(updates)) {
        if (!direction) {
          continue;
        }
        const existingTimer = flashTimersRef.current.get(key);
        if (existingTimer) {
          window.clearTimeout(existingTimer);
        }
        const timer = window.setTimeout(() => {
          setFlashes((inner) => {
            if (!(key in inner)) {
              return inner;
            }
            const { [key]: _, ...rest } = inner;
            return rest;
          });
          flashTimersRef.current.delete(key);
        }, FLASH_DURATION_MS);
        flashTimersRef.current.set(key, timer);
      }
      return next;
    });
  }, [data]);

  const handleTimeframeClick = (timeframe: TimeframeId) => {
    setSort((current) => {
      if (!current || current.timeframe !== timeframe) {
        return { timeframe, direction: 'desc' };
      }
      if (current.direction === 'desc') {
        return { timeframe, direction: 'asc' };
      }
      return null;
    });
  };

  const overviewMap = useMemo(() => {
    if (!data) {
      return new Map<TimeframeId, { gainers: number; losers: number }>();
    }
    const map = new Map<TimeframeId, { gainers: number; losers: number }>();
    for (const item of data.overview) {
      map.set(item.timeframe, { gainers: item.gainers, losers: item.losers });
    }
    return map;
  }, [data]);

  const sortedEntries = useMemo(() => {
    if (!data) {
      return [];
    }
    return applySort(data.entries, sort);
  }, [data, sort]);

  const updatedLabel = useMemo(() => {
    if (!data) {
      return '';
    }
    return dayjs(data.updatedAt).fromNow();
  }, [data]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Мониторинг рынка Bybit</h1>
          <p className="subtitle">Перерасчёт изменения с открытия бара по таймфреймам</p>
        </div>
        <div className="status-block">
          {loading ? (
            <span className="status">Загрузка...</span>
          ) : error ? (
            <span className="status status-error">Ошибка: {error}</span>
          ) : (
            <span className="status">Обновлено {updatedLabel}</span>
          )}
        </div>
      </header>

      <section className="overview">
        <h2>Изменение %</h2>
        <div className="overview-row">
          {TIMEFRAMES.map((timeframe) => {
            const dataPoint = overviewMap.get(timeframe) ?? { gainers: 0, losers: 0 };
            const isActive = sort?.timeframe === timeframe;
            const direction = isActive ? sort.direction : undefined;
            return (
              <button
                key={timeframe}
                type="button"
                className={classNames('overview-card', { active: isActive })}
                onClick={() => handleTimeframeClick(timeframe)}
              >
                <div className="overview-header">
                  <span>{timeframe}</span>
                  {isActive && <span className="overview-direction">{direction === 'desc' ? '▼' : '▲'}</span>}
                </div>
                <div className="overview-content">
                  <span className="positive">▲ Рост {dataPoint.gainers}</span>
                  <span className="negative">▼ Падение {dataPoint.losers}</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="table-section">
        <div className="table-scroll">
          <table className="market-table">
            <colgroup>
              <col className="col-pair" />
              <col className="col-price" />
              {TIMEFRAMES.map((tf) => (
                <col key={`col-change-${tf}`} className="col-change" />
              ))}
              {TIMEFRAMES.map((tf) => (
                <col key={`col-volume-${tf}`} className="col-volume" />
              ))}
              <col className="col-chart" />
            </colgroup>
            <thead>
              <tr>
                <th rowSpan={2}>Торговая пара</th>
                <th rowSpan={2}>Последняя цена</th>
                <th colSpan={TIMEFRAMES.length}>Изменение %</th>
                <th colSpan={TIMEFRAMES.length}>Объем (USDT)</th>
                <th rowSpan={2} className="chart-header-cell">
                  График
                </th>
              </tr>
              <tr>
                {TIMEFRAMES.map((tf) => (
                  <th key={`change-${tf}`}>{tf}</th>
                ))}
                {TIMEFRAMES.map((tf) => (
                  <th key={`volume-${tf}`}>{tf}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={TIMEFRAMES.length * 2 + 3} className="placeholder">
                    Загрузка данных...
                  </td>
                </tr>
              )}
              {!loading && sortedEntries.length === 0 && (
                <tr>
                  <td colSpan={TIMEFRAMES.length * 2 + 3} className="placeholder">
                    Нет данных для отображения.
                  </td>
                </tr>
              )}
              {sortedEntries.map((entry) => (
                <tr key={entry.symbol}>
                  <td className="pair-cell">
                    <div className="pair-symbol">{entry.symbol}</div>
                    <div className="pair-sub">{entry.baseCoin} / {entry.quoteCoin}</div>
                  </td>
                  <td className="price-cell">{formatPrice(entry.lastPrice)}</td>
                  {TIMEFRAMES.map((tf) => {
                    const metric = entry.metrics[tf];
                    const change = metric?.changePercent ?? null;
                    const percentInfo = formatPercent(change);
                    const flashKey = `change|${entry.symbol}|${tf}`;
                    const flashDirection = flashes[flashKey] ?? percentInfo.direction;
                    return (
                      <td
                        key={`change-${entry.symbol}-${tf}`}
                        className={classNames('metric-cell', getChangeClass(change), {
                          'flash-up': flashDirection === 'up',
                          'flash-down': flashDirection === 'down'
                        })}
                      >
                        {percentInfo.text}
                      </td>
                    );
                  })}
                  {TIMEFRAMES.map((tf) => {
                    const metric = entry.metrics[tf];
                    const flashKey = `volume|${entry.symbol}|${tf}`;
                    const flashDirection = flashes[flashKey];
                    return (
                      <td
                        key={`volume-${entry.symbol}-${tf}`}
                        className={classNames('metric-cell', {
                          'flash-up': flashDirection === 'up',
                          'flash-down': flashDirection === 'down'
                        })}
                      >
                        {formatVolume(metric?.turnover, flashDirection)}
                      </td>
                    );
                  })}
                  <td className="chart-cell">
                    <Link className="chart-link" to={`/chart/${entry.symbol}`}>
                      График
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
