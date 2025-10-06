import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import classNames from "classnames";
import { fetchMarketSnapshot, subscribeMarketSnapshots } from "../api";
import type { IndexCandle, IndexSummary, MarketResponse } from "../types";
import { IndexChart } from "../components/IndexChart";

interface IndexSnapshotState {
  history: IndexCandle[];
  summary: IndexSummary | null;
  updatedAt: number | null;
}

const INITIAL_STATE: IndexSnapshotState = {
  history: [],
  summary: null,
  updatedAt: null
};

export function IndexPage(): JSX.Element {
  const [state, setState] = useState<IndexSnapshotState>(INITIAL_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;
    const abortController = new AbortController();

    const handleSnapshot = (snapshot: MarketResponse) => {
      if (!active) {
        return;
      }
      setState({
        history: (snapshot.indexHistory ?? []) as IndexCandle[],
        summary: snapshot.indexSummary ?? null,
        updatedAt: snapshot.updatedAt ?? null
      });
      setLoading(false);
      setError(null);
    };

    setLoading(true);
    setError(null);

    fetchMarketSnapshot({ signal: abortController.signal })
      .then((snapshot) => {
        handleSnapshot(snapshot);
        unsubscribe = subscribeMarketSnapshots(handleSnapshot, (err) => {
          if (!active) {
            return;
          }
          console.error("Index snapshot stream error", err);
          setError(err.message ?? "Не удалось получить данные");
        });
      })
      .catch((err) => {
        if (!active) {
          return;
        }
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        console.error("Index snapshot load failed", err);
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

  const formattedUpdatedAt = useMemo(() => {
    if (!state.updatedAt) {
      return "";
    }
    return new Date(state.updatedAt).toLocaleString("ru-RU");
  }, [state.updatedAt]);

  const summary = state.summary;
  const netDirection = summary?.netPercent ?? 0;
  const netClass = netDirection >= 0 ? "negative" : "positive";
  const netArrow = netDirection >= 0 ? "▼" : "▲";
  const netValue = Math.abs(netDirection);

  return (
    <div className="app index-page">
      <header className="index-page-header">
        <div>
          <h1>Индекс изменения криптовалют</h1>
          <p className="subtitle">Свечи H1 на основе сводных процентов столбца D1</p>
          {formattedUpdatedAt && <p className="updated-at">Обновлено {formattedUpdatedAt}</p>}
        </div>
        <Link className="back-link" to="/">
          ← Назад к рынку
        </Link>
      </header>

      {summary && (
        <section className="index-summary-block">
          <div className="summary-item">
            <span className="label">Текущее значение</span>
            <span className="value">{summary.latest.toFixed(2)}</span>
          </div>
          <div className="summary-item">
            <span className="label">Изменение за час</span>
            <span className={classNames("value", netClass)}>
              {netArrow} {netValue.toFixed(2)}%
            </span>
          </div>
          <div className="summary-item">
            <span className="label">Рост суммарно</span>
            <span className="value positive">{summary.positiveSum.toFixed(2)}%</span>
          </div>
          <div className="summary-item">
            <span className="label">Падение суммарно</span>
            <span className="value negative">{summary.negativeSum.toFixed(2)}%</span>
          </div>
          <div className="summary-item">
            <span className="label">Всего инструментов</span>
            <span className="value">{summary.count}</span>
          </div>
        </section>
      )}

      <section className="index-chart-section">
        {loading && <div className="chart-placeholder">Загружаем данные...</div>}
        {error && <div className="chart-placeholder error">{error}</div>}
        {!loading && !error && (
          <>
            <IndexChart candles={state.history} />
            {state.history.length === 0 && (
              <div className="chart-placeholder info">Нет данных для отображения</div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

export default IndexPage;
