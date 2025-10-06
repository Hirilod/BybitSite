import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  createChart,
  type CandlestickData,
  type ChartOptions,
  type DeepPartial,
  type TimeScaleOptions,
  type UTCTimestamp
} from "lightweight-charts";
import type { IndexCandle } from "../types";

interface IndexChartProps {
  candles: IndexCandle[];
}

function mapCandles(candles: IndexCandle[]): CandlestickData[] {
  console.log(candles)
  return candles
    .map((item) => ({
      time: Math.floor(item.startTime / 1000) as UTCTimestamp,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close
    }))
    .sort((a, b) => Number(a.time) - Number(b.time));
}

function formatTimeLabel(time: number, locale: string): string {
  const date = new Date(time * 1000);
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

type ChartInstance = ReturnType<typeof createChart>;
type SeriesInstance = ReturnType<ChartInstance["addSeries"]>;

export function IndexChart({ candles }: IndexChartProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ChartInstance | null>(null);
  const seriesRef = useRef<SeriesInstance | null>(null);
  const localeRef = useRef<string>(
    typeof navigator !== "undefined" && navigator.language ? navigator.language : "ru-RU"
  );

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const locale = localeRef.current;
    const timeScaleOptions: DeepPartial<TimeScaleOptions> = {
      timeVisible: true,
      secondsVisible: false,
      tickMarkFormatter: (time: number) => formatTimeLabel(time, locale)
    };

    const baseOptions: DeepPartial<ChartOptions> = {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { color: "rgba(16, 21, 30, 0.95)" },
        textColor: "#e5e9f0"
      },
      crosshair: { mode: 1 },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.06)" },
        horzLines: { color: "rgba(255, 255, 255, 0.06)" }
      },
      rightPriceScale: { borderColor: "rgba(255, 255, 255, 0.1)" },
      localization: {
        timeFormatter: (time: UTCTimestamp) => formatTimeLabel(Number(time), locale)
      }
    };

    const chart = createChart(containerRef.current, baseOptions);
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#4fd1c5",
      downColor: "#ff6b81",
      borderUpColor: "#4fd1c5",
      borderDownColor: "#ff6b81",
      wickUpColor: "#4fd1c5",
      wickDownColor: "#ff6b81"
    });
    chart.timeScale().applyOptions(timeScaleOptions);

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (!containerRef.current) {
        return;
      }
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight
      });
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current) {
      return;
    }
    const data = mapCandles(candles);
    seriesRef.current.setData(data);
    chartRef.current.timeScale().fitContent();
  }, [candles]);

  return <div className="index-chart" ref={containerRef} style={{height:420}}/>;
}

export default IndexChart;
