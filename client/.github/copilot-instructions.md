# Copilot Instructions for BybitSite Client

## Архитектура проекта
- **Фронтенд на React + Vite**: точка входа — `src/main.tsx`, корневой компонент — `src/App.tsx`.
- **Маршрутизация**: используется `react-router-dom`, страницы лежат в `src/pages/` (`MarketPage.tsx`, `ChartPage.tsx`).
- **API и WebSocket**: взаимодействие с сервером через REST и WebSocket:
  - REST-запросы и подписки реализованы в `src/api.ts` и `src/wsClient.ts`.
  - WebSocket URL определяется динамически через переменные окружения Vite (`VITE_MARKET_WS_URL`, `VITE_MARKET_WS_PORT`).
- **Типы и константы**: все типы и константы для данных — в `src/types.ts`.

## Ключевые паттерны и конвенции
- **Асинхронные запросы**: все запросы к серверу реализованы через промисы и подписки (см. `fetchCandles`, `subscribeMarketSnapshots` в `api.ts`).
- **Lazy loading страниц**: страницы подгружаются через React.lazy и Suspense (см. `App.tsx`).
- **Стили**: глобальные стили — в `src/styles.css`, для динамических классов используется `classnames`.
- **Работа с датами**: используется `dayjs` с локалью `ru`.
- **Таблицы и списки**: для виртуализации — `react-window`, для таблиц — `@tanstack/react-table`.
- **Графики**: для отображения свечей — `lightweight-charts`.

## Сборка и запуск
- **Запуск dev-сервера**: `npm run dev` (порт 5173)
- **Сборка**: `npm run build` (проверка типов + билд Vite)
- **Просмотр билда**: `npm run preview` (порт 4173)
- **Прокси для API**: все запросы к `/api` и `/health` проксируются на `localhost:4000` (см. `vite.config.ts`).

## Взаимодействие компонентов
- **MarketPage**: подписывается на обновления рынка через `subscribeMarketSnapshots`, отображает таблицу инструментов.
- **ChartPage**: получает исторические свечи через `fetchCandles`, отображает график выбранного инструмента.
- **Типы данных**: все данные между компонентами и API строго типизированы через интерфейсы из `types.ts`.

## Внешние зависимости
- React, React Router, dayjs, classnames, lightweight-charts, react-window, @tanstack/react-table
- Для разработки: TypeScript, Vite, @vitejs/plugin-react

## Примеры паттернов
- **Подписка на обновления**:
  ```typescript
  // src/api.ts
  subscribeMarketSnapshots((snapshot) => {
    // обработка snapshot
  });
  ```
- **Получение свечей**:
  ```typescript
  // src/api.ts
  const candles = await fetchCandles(symbol, timeframe);
  ```
- **Lazy loading страницы**:
  ```tsx
  // src/App.tsx
  const MarketPage = lazy(() => import('./pages/MarketPage'));
  ```

## Рекомендации для AI-агентов
- Следуйте существующим типам и константам из `types.ts`.
- Для новых API-интеграций используйте паттерны из `api.ts` и `wsClient.ts`.
- Для новых страниц используйте lazy loading и маршрутизацию через `App.tsx`.
- Соблюдайте структуру и стилизацию, принятую в проекте.
