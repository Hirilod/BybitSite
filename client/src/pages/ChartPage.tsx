import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import classNames from 'classnames';
import {
  CandlestickSeries,
  createChart,
  type CandlestickData,
  type ChartOptions,
  type DeepPartial,
  type TimeScaleOptions,
  type UTCTimestamp
} from 'lightweight-charts';
import { fetchCandles } from '../api';
import { TIMEFRAMES, TIMEFRAME_LABEL, type TimeframeId } from '../types';

const WS_URL = 'wss://stream.bybit.com/v5/public/linear';

const TIMEFRAME_WS_INTERVAL: Record<TimeframeId, string> = {
  M1: '1',
  M5: '5',
  M15: '15',
  M30: '30',
  H1: '60',
  H4: '240',
  D1: 'D'
};

const TIMEFRAME_TIME_FORMAT: Record<TimeframeId, Intl.DateTimeFormatOptions> = {
  M1: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
  M5: { hour: '2-digit', minute: '2-digit', second: '2-digit' },
  M15: { hour: '2-digit', minute: '2-digit' },
  M30: { hour: '2-digit', minute: '2-digit' },
  H1: { hour: '2-digit', minute: '2-digit' },
  H4: { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' },
  D1: { year: 'numeric', month: '2-digit', day: '2-digit' }
};

type ChartInstance = ReturnType<typeof createChart>;
type SeriesApi = ReturnType<ChartInstance['addSeries']>;

type CandlestickEvent = {
  start?: string;
  startTime?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
};

function toCandlestick(point: CandlestickEvent): CandlestickData | null {
  const startRaw = point.start ?? point.startTime;
  if (!startRaw) {
    return null;
  }
  const time = Number(startRaw);
  if (!Number.isFinite(time)) {
    return null;
  }
  const open = Number(point.open ?? 0);
  const high = Number(point.high ?? open);
  const low = Number(point.low ?? open);
  const close = Number(point.close ?? open);
  return {
    time: Math.floor(time / 1000) as UTCTimestamp,
    open,
    high,
    low,
    close
  };
}

function getTimeScaleOptions(timeframe: TimeframeId): DeepPartial<TimeScaleOptions> {
  const format = TIMEFRAME_TIME_FORMAT[timeframe];
  return {
    timeVisible: timeframe !== 'D1',
    secondsVisible: timeframe === 'M1' || timeframe === 'M5',
    tickMarkFormatter: (time: number) => {
      const date = new Date(time * 1000);
      return new Intl.DateTimeFormat('ru-RU', format).format(date);
    }
  };
}

function mergeCandles(base: CandlestickData[], next: CandlestickData[]): CandlestickData[] {
  const map = new Map<number, CandlestickData>();
  for (const candle of base) {
    map.set(Number(candle.time), candle);
  }
  for (const candle of next) {
    map.set(Number(candle.time), candle);
  }
  return Array.from(map.values()).sort((a, b) => Number(a.time) - Number(b.time));
}

export function ChartPage(): JSX.Element {
  const { symbol: rawSymbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const symbol = useMemo(() => (rawSymbol ?? '').toUpperCase(), [rawSymbol]);
  const [timeframe, setTimeframe] = useState<TimeframeId>('H1');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartInstance | null>(null);
  const seriesRef = useRef<SeriesApi | null>(null);
  const dataRef = useRef<CandlestickData[]>([]);

  useEffect(() => {
    if (!symbol) {
      navigate('/', { replace: true });
    }
  }, [symbol, navigate]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const baseOptions: DeepPartial<ChartOptions> = {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { color: '#0f131a' },
        textColor: '#f5f7fa'
      },
      crosshair: { mode: 1 },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' }
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)'
      }
    };

    const chart = createChart(containerRef.current, baseOptions);
    chart.timeScale().applyOptions(getTimeScaleOptions(timeframe));

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#4fd1c5',
      downColor: '#ff6b81',
      borderUpColor: '#4fd1c5',
      borderDownColor: '#ff6b81',
      wickUpColor: '#4fd1c5',
      wickDownColor: '#ff6b81'
    });

    chartRef.current = chart;
    seriesRef.current = series;
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (!containerRef.current) {
        return;
      }
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight
      });
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      dataRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }
    chartRef.current.timeScale().applyOptions(getTimeScaleOptions(timeframe));
  }, [timeframe]);

  useEffect(() => {
    let cancelled = false;
    if (!symbol || !seriesRef.current) {
      return;
    }
    setLoading(true);
    setError(null);

    void fetchCandles(symbol, timeframe)
      .then((candles) => {
        if (cancelled || !seriesRef.current) {
          return;
        }
        const data: CandlestickData[] = candles.map((item) => ({
          time: Math.floor(item.openTime / 1000) as UTCTimestamp,
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close
        }));
        dataRef.current = data;
        seriesRef.current.setData(data);
        chartRef.current?.timeScale().fitContent();
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        console.error('Failed to fetch candles', err);
        setError(err instanceof Error ? err.message : 'Не удалось загрузить данные');
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [symbol, timeframe]);

  useEffect(() => {
    if (!symbol || !seriesRef.current) {
      return;
    }
    const interval = TIMEFRAME_WS_INTERVAL[timeframe];
    const topic = `kline.${interval}.${symbol}`;
    const socket = new WebSocket(WS_URL);
    let alive = true;

    socket.addEventListener('open', () => {
      if (!alive) {
        return;
      }
      socket.send(JSON.stringify({ op: 'subscribe', args: [topic] }));
    });

    socket.addEventListener('message', (event) => {
      if (!alive || !seriesRef.current) {
        return;
      }
      try {
        const payload = JSON.parse(event.data.toString()) as {
          topic?: string;
          type?: string;
          data?: CandlestickEvent[];
        };
        if (payload.topic !== topic || !payload.data) {
          return;
        }
        const items = Array.isArray(payload.data) ? payload.data : [];
        if (payload.type === 'snapshot') {
          if (dataRef.current.length === 0 && items.length > 0) {
            const candleData = items
              .map((item) => toCandlestick(item))
              .filter((candle): candle is CandlestickData => candle !== null);
            if (candleData.length > 0) {
              dataRef.current = candleData.sort((a, b) => Number(a.time) - Number(b.time));
              seriesRef.current.setData(dataRef.current);
              chartRef.current?.timeScale().fitContent();
            }
          }
          return;
        }
        const merged = mergeCandles(dataRef.current, items
          .map((item) => toCandlestick(item))
          .filter((candle): candle is CandlestickData => candle !== null));
        dataRef.current = merged.slice(-1000);
        for (const candle of items) {
          const formatted = toCandlestick(candle);
          if (formatted) {
            seriesRef.current.update(formatted);
          }
        }
      } catch (err) {
        console.error('Failed to process ws candle', err);
      }
    });

    socket.addEventListener('error', (err) => {
      console.error('WebSocket error', err);
    });

    return () => {
      alive = false;
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ op: 'unsubscribe', args: [topic] }));
      }
      socket.close();
    };
  }, [symbol, timeframe]);

  const handleBack = () => {
    navigate(-1);
  };

  return (
    <div className="chart-page">
      <header className="chart-header">
        <button type="button" className="back-button" onClick={handleBack}>
          ← Назад
        </button>
        <div className="chart-title">
          <h1>{symbol}</h1>
          <span>{TIMEFRAME_LABEL[timeframe]}</span>
        </div>
      </header>

      <nav className="timeframe-strip chart-strip" aria-label="Выбор таймфрейма">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            type="button"
            className={classNames('timeframe-chip', { active: tf === timeframe })}
            onClick={() => setTimeframe(tf)}
          >
            <span className="timeframe-label">{tf}</span>
          </button>
        ))}
      </nav>

      <div className="chart-wrapper">
        <div ref={containerRef} className="chart-container" />
        {loading && <div className="chart-overlay">Загрузка графика...</div>}
        {error && !loading && <div className="chart-overlay error">Ошибка: {error}</div>}
      </div>
    </div>
  );
}
