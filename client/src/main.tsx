import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { startAutoReload } from './autoreload';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

const minutes = Number(5);
startAutoReload({
  minutes,
  pauseWhenHidden: false,   // можно поставить false, если нужно обновлять и в фоне
  avoidWhileTyping: false,  // отключить, если хочешь строгий рефреш всегда
});