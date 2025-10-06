type AutoReloadOptions = {
  minutes: number;
  pauseWhenHidden?: boolean;   // не перезагружать, если вкладка в фоне
  avoidWhileTyping?: boolean;  // не перезагружать, если пользователь печатает
};

export function startAutoReload(opts: AutoReloadOptions) {
  const {
    minutes,
    pauseWhenHidden = true,
    avoidWhileTyping = true,
  } = opts;

  const intervalMs = Math.max(1, minutes) * 60_000;

  const isTyping = () => {
    if (!avoidWhileTyping) return false;
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return (
      tag === 'input' ||
      tag === 'textarea' ||
      (el as any).isContentEditable === true
    );
  };

  const shouldReloadNow = () => {
    if (pauseWhenHidden && document.visibilityState === 'hidden') return false;
    if (isTyping()) return false;
    return true;
  };

  // первая перезагрузка через полный интервал
  const id = window.setInterval(() => {
    if (shouldReloadNow()) {
      // Полная перезагрузка без кеша
      window.location.reload();
      // или так, если нужен «жёсткий» рефреш с обходом кеша:
      // window.location.reload(true as any);
    }
  }, intervalMs);

  // опционально: если вкладка снова стала видимой и прошло больше интервала — обновить сразу
  let lastTick = Date.now();
  const visHandler = () => {
    const now = Date.now();
    const elapsed = now - lastTick;
    lastTick = now;
    if (document.visibilityState === 'visible' && elapsed > intervalMs && shouldReloadNow()) {
      window.location.reload();
    }
  };
  document.addEventListener('visibilitychange', visHandler);

  // вернуть очистку, если нужно останавливать
  return () => {
    clearInterval(id);
    document.removeEventListener('visibilitychange', visHandler);
  };
}
