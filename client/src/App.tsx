import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

const MarketPage = lazy(async () => {
  const module = await import("./pages/MarketPage");
  return { default: module.MarketPage };
});

const ChartPage = lazy(async () => {
  const module = await import("./pages/ChartPage");
  return { default: module.ChartPage };
});

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="app-loading">Загрузка...</div>}>
        <Routes>
          <Route path="/" element={<MarketPage />} />
          <Route path="/chart/:symbol" element={<ChartPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

