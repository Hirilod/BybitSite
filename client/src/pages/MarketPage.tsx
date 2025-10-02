import type { CSSProperties, HTMLAttributes } from "react";
import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FixedSizeList, areEqual, type ListChildComponentProps } from "react-window";
import { Link } from "react-router-dom";
import classNames from "classnames";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/ru";
import { fetchMarketSnapshot, subscribeMarketSnapshots } from "../api";
import type { MarketResponse, MarketTableEntry, TimeframeId, TimeframeMetrics } from "../types";
import { TIMEFRAMES, TIMEFRAME_DURATION_MS } from "../types";

dayjs.extend(relativeTime);
dayjs.locale("ru");

type SortDirection = "asc" | "desc";
type FlashDirection = "up" | "down";
type SortMode = "change" | "volume";

interface SortState {
  timeframe: TimeframeId;
  direction: SortDirection;
  mode: SortMode;
}

interface HeaderButtonProps {
  timeframe: TimeframeId;
  mode: SortMode;
  sort: SortState | null;
  onToggle: (timeframe: TimeframeId, mode: SortMode) => void;
  columnIndex: number;
}

interface RowProps {
  entry: MarketTableEntry;
  flashes: Record<string, FlashDirection>;
  isEven?: boolean;
  style?: CSSProperties;
}

interface RowData {
  entries: MarketTableEntry[];
  flashes: Record<string, FlashDirection>;
}

const FLASH_DURATION_MS = 1200;
const ROW_HEIGHT = 64;
const MIN_VISIBLE_ROWS = 8;
const MAX_VISIBLE_ROWS = 18;
const VIRTUALIZATION_THRESHOLD = 60;

const POPULAR_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "BNBUSDT",
  "DOGEUSDT",
  "ADAUSDT",
  "LTCUSDT"
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


function mergeMetrics(
  base: Partial<Record<TimeframeId, TimeframeMetrics>>,
  patch?: Partial<Record<TimeframeId, TimeframeMetrics>>
): Partial<Record<TimeframeId, TimeframeMetrics>> {
  const snapshot = { ...base };
  if (!patch) {
    return snapshot;
  }

  for (const [timeframe, metric] of Object.entries(patch) as Array<
    [TimeframeId, TimeframeMetrics | undefined]
  >) {
    if (metric !== undefined) {
      snapshot[timeframe] = metric;
    }
  }
  return snapshot;
}

function mergeEntry(base: MarketTableEntry, patch: MarketTableEntry): MarketTableEntry {
  const metrics = mergeMetrics(base.metrics, patch.metrics);
  return {
    ...base,
    ...patch,
    metrics
  };
}

function mergeMarketResponses(current: MarketResponse, incoming: MarketResponse): MarketResponse {
  const incomingMap = new Map(incoming.entries.map((entry) => [entry.symbol, entry]));
  const mergedEntries: MarketTableEntry[] = current.entries.map((entry) => {
    const patch = incomingMap.get(entry.symbol);
    if (!patch) {
      return entry;
    }
    incomingMap.delete(entry.symbol);
    return mergeEntry(entry, patch);
  });

  for (const patch of incomingMap.values()) {
    mergedEntries.push(patch);
  }

  const updatedAt = Math.max(current.updatedAt ?? 0, incoming.updatedAt ?? 0);
  const overview = incoming.overview?.length ? incoming.overview : current.overview;

  return {
    updatedAt,
    entries: mergedEntries,
    overview
  };
}

function formatPrice(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  const absValue = Math.abs(value);
  const fractionDigits = absValue >= 1000 ? 0 : absValue >= 100 ? 1 : absValue >= 1 ? 2 : 4;
  return value.toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits
  });
}

function formatPercent(value: number | null): { text: string; direction?: FlashDirection } {
  if (value === null || !Number.isFinite(value)) {
    return { text: "-" };
  }
  const fixed = Math.abs(value) >= 100 ? 1 : 2;
  const formatted = Math.abs(value).toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: fixed
  });
  if (value > 0) {
    return { text: `▲ ${formatted}%`, direction: "up" };
  }
  if (value < 0) {
    return { text: `▼ ${formatted}%`, direction: "down" };
  }
  return { text: `${formatted}%` };
}

function formatVolume(value: number | null | undefined, direction?: FlashDirection): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  const arrow = direction === "up" ? "▲ " : direction === "down" ? "▼ " : "";
  return `${arrow}${value.toLocaleString("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 2
  })}`;
}

function getChangeClass(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "";
  }
  if (value > 0) {
    return "change-positive";
  }
  if (value < 0) {
    return "change-negative";
  }
  return "";
}

function applySort(entries: MarketTableEntry[], sort: SortState | null): MarketTableEntry[] {
  if (!sort) {
    return sortByPopularity(entries);
  }
  const { timeframe, direction, mode } = sort;
  const factor = direction === "desc" ? -1 : 1;
  return [...entries].sort((a, b) => {
    const metricsA = a.metrics[timeframe];
    const metricsB = b.metrics[timeframe];
    const aValue = mode === "volume" ? metricsA?.turnover : metricsA?.changePercent;
    const bValue = mode === "volume" ? metricsB?.turnover : metricsB?.changePercent;
    const safe = (value: number | null | undefined): number => {
      if (value === null || value === undefined || !Number.isFinite(value)) {
        return direction === "desc" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
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

const HeaderButton = memo(function HeaderButton({
  timeframe,
  mode,
  sort,
  onToggle,
  columnIndex
}: HeaderButtonProps) {
  const isActive = sort?.timeframe === timeframe && sort?.mode === mode;
  const direction = isActive ? sort?.direction : undefined;
  return (
    <div
      role="columnheader"
      className={classNames("cell", "header", "sortable", { active: isActive })}
      style={{ gridColumn: columnIndex }}
    >
      <button type="button" onClick={() => onToggle(timeframe, mode)}>
        <span>{timeframe}</span>
        {isActive && <span className="sort-indicator">{direction === "desc" ? "▼" : "▲"}</span>}
      </button>
    </div>
  );
});

HeaderButton.displayName = "HeaderButton";

// const DesktopRow = memo(function DesktopRow({ entry, flashes, isEven, style }: RowProps) {
//   const mergedStyle = style ? { ...style, display: "grid" } : undefined;
//   return (
//     <div
//       role="row"
//       className={classNames("table-row", isEven ? "table-row-even" : "table-row-odd")}
//       style={mergedStyle}
//     >
//       <div role="cell" className="cell pair-cell">
//         <div className="pair-symbol">{entry.symbol}</div>
//         <div className="pair-sub">
//           {entry.baseCoin} / {entry.quoteCoin}
//         </div>
//       </div>
//       <div role="cell" className="cell price-cell">
//         {formatPrice(entry.lastPrice)}
//       </div>
//       {TIMEFRAMES.map((tf, index) => {
//         const metric = entry.metrics[tf];
//         const change = metric?.changePercent ?? null;
//         const percentInfo = formatPercent(change);
//         const flashKey = `change|${entry.symbol}|${tf}`;
//         const flashDirection = flashes[flashKey] ?? percentInfo.direction;
//         return (
//           <div
//             key={`change-${entry.symbol}-${tf}`}
//             role="cell"
//             className={classNames("cell", "metric-cell", getChangeClass(change), {
//               "flash-up": flashDirection === "up",
//               "flash-down": flashDirection === "down",
//               "first-change-cell": index === 0
//             })}
//           >
//             {percentInfo.text}
//           </div>
//         );
//       })}
//       {TIMEFRAMES.map((tf, index) => {
//         const metric = entry.metrics[tf];
//         const flashKey = `volume|${entry.symbol}|${tf}`;
//         const flashDirection = flashes[flashKey];
//         return (
//           <div
//             key={`volume-${entry.symbol}-${tf}`}
//             role="cell"
//             className={classNames("cell", "metric-cell", {
//               "flash-up": flashDirection === "up",
//               "flash-down": flashDirection === "down",
//               "first-volume-cell": index === 0
//             })}
//           >
//             {formatVolume(metric?.turnover, flashDirection)}
//           </div>
//         );
//       })}
//       <div role="cell" className="cell chart-cell">
//         <Link className="chart-link" to={`/chart/${entry.symbol}`} target="_blank" rel="noopener noreferrer">
//           График
//         </Link>
//       </div>
//     </div>
//   );
// });


const DesktopRow = memo(function DesktopRow({ entry, flashes, isEven, style }: RowProps) {
  // Переопределяем ширину, которую прокидывает react-window (обычно width: 100%)
  const mergedStyle: CSSProperties = {
    ...(style ?? {}),
    width: "auto",
    minWidth: "max-content",
    display: "grid",
  };

  return (
    <div
      role="row"
      className={classNames("table-row", isEven ? "table-row-even" : "table-row-odd")}
      style={mergedStyle}
    >
      <div role="cell" className="cell pair-cell">
        <div className="pair-symbol">{entry.symbol}</div>
        <div className="pair-sub">
          {entry.baseCoin} / {entry.quoteCoin}
        </div>
      </div>

      <div role="cell" className="cell price-cell">
        {formatPrice(entry.lastPrice)}
      </div>

      {TIMEFRAMES.map((tf, index) => {
        const metric = entry.metrics[tf];
        const change = metric?.changePercent ?? null;
        const percentInfo = formatPercent(change);
        const flashKey = `change|${entry.symbol}|${tf}`;
        const flashDirection = flashes[flashKey] ?? percentInfo.direction;
        return (
          <div
            key={`change-${entry.symbol}-${tf}`}
            role="cell"
            className={classNames("cell", "metric-cell", getChangeClass(change), {
              "flash-up": flashDirection === "up",
              "flash-down": flashDirection === "down",
              "first-change-cell": index === 0,
            })}
            color="red"
          >
            {percentInfo.text}
          </div>
        );
      })}

      {TIMEFRAMES.map((tf, index) => {
        const metric = entry.metrics[tf];
        const flashKey = `volume|${entry.symbol}|${tf}`;
        const flashDirection = flashes[flashKey];
        return (
          <div
            key={`volume-${entry.symbol}-${tf}`}
            role="cell"
            className={classNames("cell", "metric-cell", {
              "flash-up": flashDirection === "up",
              "flash-down": flashDirection === "down",
              "first-volume-cell": index === 0,
            })}
          >
            {formatVolume(metric?.turnover, flashDirection)}
          </div>
        );
      })}

      <div role="cell" className="cell chart-cell">
        <Link className="chart-link" to={`/chart/${entry.symbol}`} target="_blank" rel="noopener noreferrer">
          График
        </Link>
      </div>
    </div>
  );
});

DesktopRow.displayName = "DesktopRow";
// const VirtualListOuter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function VirtualListOuter({ style, ...rest }, ref) {
//   // const mergedStyle: CSSProperties = style ? { ...style } : {};
//   // mergedStyle.width = "100%";
//   // mergedStyle.overflowX = mergedStyle.overflowX ?? "hidden";
//   // return <div ref={ref} {...rest} style={mergedStyle} />;
//   const merged: CSSProperties = { ...(style ?? {}), overflowX: "visible" };
//   (merged as any).width = "auto";
//   (merged as any).minWidth = "max-content";
//   return <div ref={ref} {...rest} style={merged} />;
// });

// const VirtualListInner = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
//   function VirtualListInner({ style, ...rest }, ref) {
//     // сохраняем высоту, но убираем фиксированную ширину
//     const merged: CSSProperties = { ...(style ?? {}) };
//     merged.width = "auto";
//     (merged as any).minWidth = "max-content";
//     return <div ref={ref} {...rest} style={merged} />;
//   }
// );

const VirtualListOuter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function VirtualListOuter({ style, ...rest }, ref) {
    const { width, ...restStyle } = (style ?? {}) as CSSProperties; // выкинули width
    const merged: CSSProperties = {
      ...restStyle,
      overflowX: "visible",
      width: "auto",
      minWidth: "max-content",
    };
    return <div ref={ref} {...rest} style={merged} />;
  }
);

// 2) Внутренняя обёртка: react-window тоже ставит width — убираем
const VirtualListInner = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function VirtualListInner({ style, ...rest }, ref) {
    const { width, ...restStyle } = (style ?? {}) as CSSProperties; // выкинули width
    const merged: CSSProperties = {
      ...restStyle,               // высота/позиционирование оставляем
      width: "auto",
      minWidth: "max-content",
    };
    return <div ref={ref} {...rest} style={merged} />;
  }
);


const VirtualizedRow = memo(function VirtualizedRow({ index, style, data }: ListChildComponentProps<RowData>) {
  const entry = data.entries[index];
  if (!entry) {
    return null;
  }
  return <DesktopRow entry={entry} flashes={data.flashes} isEven={index % 2 === 0} style={style} />;
}, areEqual);

VirtualizedRow.displayName = "VirtualizedRow";

const MobileCard = memo(function MobileCard({ entry, flashes }: RowProps) {
  return (
    <article className="mobile-card" key={entry.symbol}>
      <header className="mobile-card-header">
        <div>
          <div className="pair-symbol">{entry.symbol}</div>
          <div className="pair-sub">
            {entry.baseCoin} / {entry.quoteCoin}
          </div>
        </div>
        <div className="mobile-price">{formatPrice(entry.lastPrice)}</div>
      </header>
      <div className="mobile-metrics">
        {TIMEFRAMES.map((tf) => {
          const metric = entry.metrics[tf];
          const change = metric?.changePercent ?? null;
          const percentInfo = formatPercent(change);
          const flashKeyChange = `change|${entry.symbol}|${tf}`;
          const flashDirectionChange = flashes[flashKeyChange] ?? percentInfo.direction;
          const flashKeyVolume = `volume|${entry.symbol}|${tf}`;
          const flashDirectionVolume = flashes[flashKeyVolume];
          return (
            <div className="mobile-metric-row" key={`${entry.symbol}-${tf}`}>
              <span className="mobile-metric-timeframe">{tf}</span>
              <span
                className={classNames("mobile-metric-change", getChangeClass(change), {
                  "flash-up": flashDirectionChange === "up",
                  "flash-down": flashDirectionChange === "down"
                })}
              >
                {percentInfo.text}
              </span>
              <span
                className={classNames("mobile-metric-volume", {
                  "flash-up": flashDirectionVolume === "up",
                  "flash-down": flashDirectionVolume === "down"
                })}
              >
                {formatVolume(metric?.turnover, flashDirectionVolume)}
              </span>
            </div>
          );
        })}
      </div>
      <footer className="mobile-card-footer">
        <Link className="chart-link" to={`/chart/${entry.symbol}`} target="_blank" rel="noopener noreferrer">
          График
        </Link>
      </footer>
    </article>
  );
});

MobileCard.displayName = "MobileCard";

function useViewportHeight(): number {
  const [height, setHeight] = useState(() => (typeof window === "undefined" ? 900 : window.innerHeight));
  useEffect(() => {
    const handler = () => setHeight(window.innerHeight);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return height;
}

export function MarketPage(): JSX.Element {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [flashes, setFlashes] = useState<Record<string, FlashDirection>>({});

  const previousSnapshotRef = useRef<MarketResponse | null>(null);
  const snapshotRef = useRef<MarketResponse | null>(null);
  const flashTimersRef = useRef<Map<string, number>>(new Map());
  const viewportHeight = useViewportHeight();
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridContentWidth, setGridContentWidth] = useState<number>(1200);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const handleChange = () => setIsMobile(media.matches);
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;
    const abortController = new AbortController();

    setLoading(true);

    const startSubscription = () => {
      if (unsubscribe) {
        return;
      }
      unsubscribe = subscribeMarketSnapshots(
        (snapshot) => {
          if (!active || !snapshotRef.current) {
            return;
          }
          setData((previous) => {
            const base = previous ?? snapshotRef.current!;
            const merged = mergeMarketResponses(base, snapshot);
            snapshotRef.current = merged;
            return merged;
          });
        },
        (err) => {
          if (!active) {
            return;
          }
          console.error(err);
          setError((prev) => prev ?? err.message ?? "Не удалось получить данные");
        }
      );
    };

    fetchMarketSnapshot({ signal: abortController.signal })
      .then((snapshot) => {
        if (!active) {
          return;
        }
        snapshotRef.current = snapshot;
        setData(snapshot);
        setError(null);
        setLoading(false);
        startSubscription();
      })
      .catch((err) => {
        if (!active) {
          return;
        }
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        console.error(err);
        setError(err instanceof Error ? err.message : "Неизвестная ошибка");
        setLoading(false);
      });

    return () => {
      active = false;
      abortController.abort();
      if (unsubscribe) {
        unsubscribe();
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
              updates[`change|${entry.symbol}|${timeframe}`] = delta >= 0 ? "up" : "down";
            }
            const currentVolume = metric.turnover;
            const previousVolume = prevMetric.turnover;
            if (Number.isFinite(currentVolume) && Number.isFinite(previousVolume) && currentVolume !== previousVolume) {
              const delta = (currentVolume ?? 0) - (previousVolume ?? 0);
              updates[`volume|${entry.symbol}|${timeframe}`] = delta >= 0 ? "up" : "down";
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
      for (const [key] of Object.entries(updates)) {
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

  const handleSortToggle = useCallback((timeframe: TimeframeId, mode: SortMode) => {
    setSort((current) => {
      if (!current || current.timeframe !== timeframe || current.mode !== mode) {
        return { timeframe, mode, direction: "desc" };
      }
      if (current.direction === "desc") {
        return { timeframe, mode, direction: "asc" };
      }
      return null;
    });
  }, []);

  const overviewMap = useMemo(() => {
    if (!data) {
      return new Map<TimeframeId, { gainers: number; losers: number }>();
    }
    const now = data.updatedAt ?? Date.now();
    const result = new Map<TimeframeId, { gainers: number; losers: number }>();
    for (const timeframe of TIMEFRAMES) {
      const windowMs = TIMEFRAME_DURATION_MS[timeframe];
      let gainers = 0;
      let losers = 0;
      for (const entry of data.entries) {
        const metric = entry.metrics[timeframe];
        if (!metric || metric.changePercent === null) {
          continue;
        }
        if (Number.isFinite(windowMs)) {
          const age = now - metric.openTime;
          if (age > windowMs) {
            continue;
          }
        }
        if (metric.changePercent > 0) {
          gainers += 1;
        } else if (metric.changePercent < 0) {
          losers += 1;
        }
      }
      result.set(timeframe, { gainers, losers });
    }
    return result;
  }, [data]);

  const sortedEntries = useMemo(() => {
    if (!data) {
      return [];
    }
    return applySort(data.entries, sort);
  }, [data, sort]);

  const updatedLabel = useMemo(() => {
    if (!data) {
      return "";
    }
    return dayjs(data.updatedAt).fromNow();
  }, [data]);

  const gridTemplate = useMemo(() => {
    const changeColumns = new Array(TIMEFRAMES.length).fill("120px");
    const volumeColumns = new Array(TIMEFRAMES.length).fill("140px");
    return ["220px", "120px", ...changeColumns, ...volumeColumns, "120px"].join(" ");
  }, []);

  const changeStart = 3;
  const volumeStart = 3 + TIMEFRAMES.length;
  const chartStart = volumeStart + TIMEFRAMES.length;

  const containerStyle = useMemo(
    () => ({ "--grid-template": gridTemplate }) as CSSProperties & { "--grid-template": string },
    [gridTemplate]
  );

  const visibleRowCount = useMemo(() => {
    if (sortedEntries.length === 0) {
      return 1;
    }
    const availableRows = Math.floor((viewportHeight - 320) / ROW_HEIGHT);
    const clamped = Math.max(MIN_VISIBLE_ROWS, Math.min(MAX_VISIBLE_ROWS, availableRows));
    return Math.min(sortedEntries.length, Math.max(1, clamped));
  }, [sortedEntries.length, viewportHeight]);

  const listHeight = useMemo(() => visibleRowCount * ROW_HEIGHT, [visibleRowCount]);

  const shouldVirtualize = sortedEntries.length > VIRTUALIZATION_THRESHOLD;

  const rowData = useMemo<RowData>(() => ({ entries: sortedEntries, flashes }), [sortedEntries, flashes]);

  const itemKey = useCallback<(index: number, data: RowData) => string | number>((index, data) => {
    return data.entries[index]?.symbol ?? index;
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Монитор рынков Bybit</h1>
          <p className="subtitle">Свежие изменения цен и оборотов без перезагрузки страницы</p>
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
        <h2>�?зменение %</h2>
        <div className="overview-row">
          {TIMEFRAMES.map((timeframe) => {
            const dataPoint = overviewMap.get(timeframe) ?? { gainers: 0, losers: 0 };
            const isActive = sort?.timeframe === timeframe && sort?.mode === "change";
            const direction = isActive ? sort?.direction : undefined;
            return (
              <button
                key={timeframe}
                type="button"
                className={classNames("overview-card", { active: isActive })}
                onClick={() => handleSortToggle(timeframe, "change")}
              >
                <div className="overview-header">
                  <span>{timeframe}</span>
                  {isActive && <span className="overview-direction">{direction === "desc" ? "▼" : "▲"}</span>}
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

      {!isMobile && (
        <section className="table-section">
          <div className="table-scroll">
            <div className="table-grid" role="table" style={containerStyle}>
              <div className="table-header" role="rowgroup">
                <div className="table-header-row" role="row">
                  <div role="columnheader" className="cell header pair-header">
                    Торговая пара
                  </div>
                  <div role="columnheader" className="cell header price-header">
                    Последняя цена
                  </div>
                  <div
                    role="columnheader"
                    className="cell header group-header"
                    style={{ gridColumn: `${changeStart} / span ${TIMEFRAMES.length}` }}
                  >
                    �?зменение %
                  </div>
                  <div
                    role="columnheader"
                    className="cell header group-header"
                    style={{ gridColumn: `${volumeStart} / span ${TIMEFRAMES.length}` }}
                  >
                    Оборот (USDT)
                  </div>
                  <div
                    role="columnheader"
                    className="cell header chart-header-cell"
                    style={{ gridColumn: `${chartStart} / span 1` }}
                  >
                    График
                  </div>
                </div>
                <div className="table-header-row secondary" role="row">
                  {TIMEFRAMES.map((tf, index) => (
                    <HeaderButton
                      key={`change-header-${tf}`}
                      timeframe={tf}
                      mode="change"
                      sort={sort}
                      onToggle={handleSortToggle}
                      columnIndex={changeStart + index}
                    />
                  ))}
                  {TIMEFRAMES.map((tf, index) => (
                    <HeaderButton
                      key={`volume-header-${tf}`}
                      timeframe={tf}
                      mode="volume"
                      sort={sort}
                      onToggle={handleSortToggle}
                      columnIndex={volumeStart + index}
                    />
                  ))}
                </div>
              </div>
              <div className="table-body" role="rowgroup">
                {loading && (
                  <div role="row" className="table-placeholder">
                    <div className="cell" style={{ gridColumn: `1 / span ${chartStart}` }}>
                      Загружаем данные...
                    </div>
                  </div>
                )}
                {!loading && sortedEntries.length === 0 && (
                  <div role="row" className="table-placeholder">
                    <div className="cell" style={{ gridColumn: `1 / span ${chartStart}` }}>
                      Нет данных для отображения.
                    </div>
                  </div>
                )}
                {!loading && sortedEntries.length > 0 && shouldVirtualize && (
                  <FixedSizeList
                    height={listHeight}
                    itemCount={sortedEntries.length}
                    itemData={rowData}
                    itemSize={ROW_HEIGHT}
                    width="100%"
                    itemKey={itemKey}
                    className="virtual-list"
                    outerElementType={VirtualListOuter}
                    innerElementType={VirtualListInner}
                  >
                    {VirtualizedRow}
                  </FixedSizeList>
                )}
                {!loading && sortedEntries.length > 0 && !shouldVirtualize && (
                  <div className="static-rows">
                    {sortedEntries.map((entry, index) => (
                      <DesktopRow
                        key={entry.symbol}
                        entry={entry}
                        flashes={flashes}
                        isEven={index % 2 === 0}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {isMobile && (
        <section className="mobile-list">
          {sortedEntries.map((entry) => (
            <MobileCard key={`mobile-${entry.symbol}`} entry={entry} flashes={flashes} />
          ))}
        </section>
      )}
    </div>
  );
}