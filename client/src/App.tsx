import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { MarketPage } from './pages/MarketPage';
import { ChartPage } from './pages/ChartPage';

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MarketPage />} />
        <Route path="/chart/:symbol" element={<ChartPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
