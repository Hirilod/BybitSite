#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import asyncio
import time
import json
import math
import os
from typing import Dict, Any, List, Tuple, Set, Optional
from contextlib import suppress

import aiohttp
import websockets
from websockets import WebSocketServerProtocol
from websockets.exceptions import ConnectionClosed, ConnectionClosedError, ConnectionClosedOK

try:
    import redis.asyncio as redis_asyncio
except Exception:  # pragma: no cover - redis optional
    redis_asyncio = None

# ========================= Конфиг =========================
BYBIT_HTTP_BASE = "https://api.bybit.com"
BYBIT_WS_LINEAR = "wss://stream.bybit.com/v5/public/linear"

TF_INTERVALS = {  # наши ТФ → интервалы Bybit v5
    "M1": "1",
    "M5": "5",
    "M15": "15",
    "H1": "60",
    "H4": "240",
    "D1": "D",
}
INTERVAL_TO_TF = {v: k for k, v in TF_INTERVALS.items()}
TF_ORDER = ["M1", "M5", "M15", "H1", "H4", "D1"]

BIND_HOST = "0.0.0.0"
BIND_PORT = 8765

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:7000/0")
INDEX_SLOT_MS = 60 * 60 * 1000
INDEX_BASE_VALUE = 0
INDEX_MAX_CANDLES = 1000
INDEX_HISTORY_EXPORT = 720
INDEX_REDIS_KEY = "market:index:candles:h1"
INDEX_POLL_INTERVAL_SEC = 60

MAX_TOPICS_PER_CONN = 200
PING_INTERVAL = 20
HTTP_CONCURRENCY = 10
HTTP_RETRY = 3
DEBOUNCE_MS = 200  # сглаживание бурста перед общей рассылкой

# ========================= Кодеки =========================
try:
    import orjson as _json
    def dumps(obj: Any) -> bytes: return _json.dumps(obj)
    def loads(b: bytes) -> Any: return _json.loads(b)
except Exception:
    def dumps(obj: Any) -> bytes: return json.dumps(obj, separators=(",", ":")).encode()
    def loads(b: bytes) -> Any: return json.loads(b.decode())

# ========================= Состояние =========================
symbols: List[Dict[str, Any]] = []  # [{symbol, baseCoin, quoteCoin}]
entries: Dict[str, Dict[str, Any]] = {}  # symbol -> entry
prev_close: Dict[Tuple[str, str], float] = {}  # (symbol, TF) -> previous closed bar close
overview: Dict[str, Dict[str, int]] = {tf: {"timeframe": tf, "gainers": 0, "losers": 0} for tf in TF_ORDER}

clients: Set[WebSocketServerProtocol] = set()
clients_lock = asyncio.Lock()
_dirty_event = asyncio.Event()  # сигнал «изменилось — пора выслать полный снапшот»

redis_client: Optional["redis_asyncio.Redis"] = None
index_history: List[Dict[str, Any]] = []  # Только закрытые свечи
index_prev_close_value: float = INDEX_BASE_VALUE
index_active_candle: Optional[Dict[str, Any]] = None

# ========================= Утилиты =========================
def now_ms() -> int:
    return int(time.time() * 1000)

def make_metric(tf: str) -> dict:
    return {
        "timeframe": tf,
        "openTime": 0,
        "openPrice": None,
        "prevClose": None,           # добавлено: закрытие предыдущего бара
        "baselinePrice": None,       # = openPrice (база для changePercent «как на Bybit»)
        "changePercent": None,       # (last - open)/open * 100  ← то, что на графике
        "closeToClosePercent": None, # (last - prevClose)/prevClose * 100  ← старая логика
        "volume": 0.0,
        "turnover": 0.0,
        "updatedAt": 0
    }

def ensure_entry(sym: str, base: str, quote: str) -> Dict[str, Any]:
    if sym not in entries:
        entries[sym] = {
            "symbol": sym,
            "baseCoin": base,
            "quoteCoin": quote,
            "lastPrice": None,
            "lastPriceUpdatedAt": 0,
            "metrics": {tf: make_metric(tf) for tf in TF_ORDER},  # новый dict на каждый ТФ
        }
    return entries[sym]

def _gv(d, key, idx):
    if isinstance(d, dict): return d.get(key)
    if isinstance(d, (list, tuple)) and len(d) > idx: return d[idx]
    return None

def _kline_start_ms(k) -> int:
    v = _gv(k, "start", 0)
    return int(v)

# === обновление одной метрики по свече ===
def set_from_kline(sym: str, tf: str, k):
    """
    Заполняем метрику по одной свече (в т.ч. текущей, confirm=false).
    Процент считаем «как на графике Bybit»: (close_now - open_cur) / open_cur * 100.
    Дополнительно считаем close→close (от prevClose) — как вспомогательную метрику.
    """
    start = _gv(k, "start", 0)
    open_ = _gv(k, "open", 1)
    close_ = _gv(k, "close", 4)
    vol = _gv(k, "volume", 5)
    turn = _gv(k, "turnover", 6)

    start_ms = int(start)
    o = float(open_)
    c = float(close_)
    v = float(vol)
    t = float(turn)

    m = entries[sym]["metrics"][tf]
    m["openTime"] = start_ms
    m["openPrice"] = o
    m["baselinePrice"] = o          # база для «как на Bybit»
    m["volume"] = v
    m["turnover"] = t
    m["updatedAt"] = now_ms()

    # Основной процент (как на Bybit / TradingView для текущего бара)
    if o > 0:
        m["changePercent"] = (c - o) / o * 100.0

    # Вспомогательная метрика: от прошлого закрытия
    base = prev_close.get((sym, tf))
    if base is not None and base > 0:
        m["prevClose"] = base
        m["closeToClosePercent"] = (c - base) / base * 100.0

def roll_prev_close_on_close(sym: str, tf: str, close_price: float):
    prev_close[(sym, tf)] = float(close_price)

def recompute_overview():
    # для «обзора» берём changePercent (как на Bybit)
    for tf in TF_ORDER:
        g = l = 0
        for e in entries.values():
            ch = e["metrics"][tf]["changePercent"]
            if ch is None: continue
            if ch > 0: g += 1
            elif ch < 0: l += 1
        overview[tf]["gainers"] = g
        overview[tf]["losers"] = l


def compute_d1_stats() -> Dict[str, Any]:
    positive_sum = 0.0
    negative_sum = 0.0
    count = 0
    for entry in entries.values():
        metrics = entry.get("metrics") or {}
        metric = metrics.get("D1")
        if not metric:
            continue
        change = metric.get("changePercent")
        if change is None or not math.isfinite(change):
            continue
        count += 1
        change_value = float(change)
        if change_value > 0:
            positive_sum += change_value
        elif change_value < 0:
            negative_sum += abs(change_value)
    net_percent = 0.0
    if count > 0:
        net_percent = (negative_sum - positive_sum) / count
    return {
        "positiveSum": positive_sum,
        "negativeSum": negative_sum,
        "count": count,
        "netPercent": net_percent,
    }

def build_snapshot_json() -> Dict[str, Any]:
    stats = compute_d1_stats()
    history = export_index_history()
    current_slot = 0
    current_value = index_prev_close_value
    if index_active_candle:
        current_slot = int(index_active_candle.get("startTime", 0))
        current_value = float(index_active_candle.get("close", current_value))
    elif index_history:
        current_slot = int(index_history[-1].get("startTime", 0))
        current_value = float(index_history[-1].get("close", current_value))
    summary = {
        "latest": round(float(current_value), 4),
        "baseValue": INDEX_BASE_VALUE,
        "lastSlot": current_slot,
        "netPercent": round(float(stats.get("netPercent", 0.0)), 4),
        "positiveSum": round(float(stats.get("positiveSum", 0.0)), 4),
        "negativeSum": round(float(stats.get("negativeSum", 0.0)), 4),
        "count": int(stats.get("count", 0)),
        "slotDuration": INDEX_SLOT_MS,
    }
    return {
        "entries": list(entries.values()),
        "overview": list(overview.values()),
        "indexSummary": summary,
        "indexHistory": history,
        "updatedAt": now_ms(),
    }

def mark_dirty():
    _dirty_event.set()


async def init_index_storage():
    global redis_client, index_history, index_prev_close_value, index_active_candle
    if redis_asyncio is None:
        print("[index] redis module is not available, using in-memory history only")
        return
    try:
        redis_client = redis_asyncio.from_url(REDIS_URL, encoding="utf-8", decode_responses=True)
        await redis_client.ping()
    except Exception as exc:  # pragma: no cover - best effort connection
        print(f"[index] failed to connect to redis ({exc}), using in-memory history")
        redis_client = None
        return

    try:
        raw_items = await redis_client.zrange(INDEX_REDIS_KEY, -INDEX_MAX_CANDLES, -1)
        history: List[Dict[str, Any]] = []
        for item in raw_items:
            with suppress(Exception):
                parsed = json.loads(item)
                if isinstance(parsed, dict) and "startTime" in parsed:
                    history.append(parsed)
        history.sort(key=lambda it: it.get("startTime", 0))
        index_history = history
        if history:
            last = history[-1]
            index_prev_close_value = float(last.get("close", INDEX_BASE_VALUE))
        else:
            index_prev_close_value = INDEX_BASE_VALUE
        index_active_candle = None
        print(f"[index] loaded {len(history)} candles from redis")
    except Exception as exc:  # pragma: no cover - best effort load
        print(f"[index] failed to load history from redis ({exc}), using in-memory history")
        index_history = []
        index_prev_close_value = INDEX_BASE_VALUE
        index_active_candle = None


async def store_closed_candle(candle: Dict[str, Any]):
    global index_history, index_prev_close_value, redis_client
    snapshot = dict(candle)
    index_history.append(snapshot)
    if len(index_history) > INDEX_MAX_CANDLES:
        index_history = index_history[-INDEX_MAX_CANDLES:]
    index_prev_close_value = float(snapshot.get("close", index_prev_close_value))

    if redis_client is None:
        return

    try:
        payload = json.dumps(snapshot, separators=(",", ":"))
        score = snapshot["startTime"]
        await redis_client.zremrangebyscore(INDEX_REDIS_KEY, score, score)
        await redis_client.zadd(INDEX_REDIS_KEY, {payload: score})
        count = await redis_client.zcard(INDEX_REDIS_KEY)
        excess = count - INDEX_MAX_CANDLES
        if excess > 0:
            await redis_client.zremrangebyrank(INDEX_REDIS_KEY, 0, excess - 1)
    except Exception as exc:  # pragma: no cover - best effort persistence
        print(f"[index] redis write failed ({exc}), switching to in-memory mode")
        with suppress(Exception):
            await redis_client.close()
        redis_client = None


async def maybe_capture_index_candle(force: bool = False):
    global index_active_candle, index_prev_close_value

    stats = compute_d1_stats()
    count = int(stats.get("count", 0))
    now = now_ms()
    slot_start = (now // INDEX_SLOT_MS) * INDEX_SLOT_MS

    # закрываем предыдущую свечу, если перешли на новый слот
    if index_active_candle and slot_start > int(index_active_candle.get("startTime", 0)):
        await store_closed_candle(index_active_candle)
        index_active_candle = None

    if index_active_candle is None:
        if not force and count == 0:
            return
        open_value = index_prev_close_value
        index_active_candle = {
            "startTime": slot_start,
            "open": round(open_value, 4),
            "high": round(open_value, 4),
            "low": round(open_value, 4),
            "close": round(open_value, 4),
            "netPercent": 0.0,
            "positiveSum": 0.0,
            "negativeSum": 0.0,
            "count": 0,
        }

    if index_active_candle is None:
        return

    open_value = float(index_active_candle.get("open", index_prev_close_value))
    net_percent = float(stats.get("netPercent", 0.0))
    positive_sum = float(stats.get("positiveSum", 0.0))
    negative_sum = float(stats.get("negativeSum", 0.0))
    close_value = -net_percent

    high_prev = float(index_active_candle.get("high", open_value))
    low_prev = float(index_active_candle.get("low", open_value))
    high_value = max(high_prev, close_value, open_value)
    low_value = min(low_prev, close_value, open_value)

    index_active_candle.update(
        {
            "close": round(close_value, 4),
            "high": round(high_value, 4),
            "low": round(low_value, 4),
            "netPercent": round(net_percent, 4),
            "positiveSum": round(positive_sum, 4),
            "negativeSum": round(negative_sum, 4),
            "count": count,
        }
    )

    mark_dirty()


async def index_candle_loop():
    while True:
        try:
            await maybe_capture_index_candle()
        except Exception as exc:  # pragma: no cover - guard loop
            print(f"[index] capture loop error: {exc}")
        await asyncio.sleep(INDEX_POLL_INTERVAL_SEC)


def export_index_history() -> List[Dict[str, Any]]:
    if len(index_history) <= INDEX_HISTORY_EXPORT:
        history = list(index_history)
    else:
        history = index_history[-INDEX_HISTORY_EXPORT:]
    if index_active_candle:
        history = history + [dict(index_active_candle)]
    return history

# ========================= HTTP (REST) =========================
async def http_get_json(session: aiohttp.ClientSession, url: str, params: Dict[str, Any]) -> Any:
    for attempt in range(1, HTTP_RETRY + 1):
        try:
            async with session.get(url, params=params, timeout=aiohttp.ClientTimeout(total=20)) as r:
                r.raise_for_status()
                return await r.json()
        except Exception:
            if attempt == HTTP_RETRY:
                raise
            await asyncio.sleep(0.6 * attempt)

async def fetch_instruments(session: aiohttp.ClientSession) -> List[Dict[str, Any]]:
    data = await http_get_json(session, f"{BYBIT_HTTP_BASE}/v5/market/instruments-info",
                               {"category": "linear", "limit": 1000})
    lst = data.get("result", {}).get("list") or []
    out = []
    for it in lst:
        if it.get("quoteCoin") == "USDT" and it.get("status") == "Trading":
            out.append({"symbol": it["symbol"], "baseCoin": it.get("baseCoin"), "quoteCoin": it.get("quoteCoin")})
    return out

async def fetch_tickers(session: aiohttp.ClientSession) -> Dict[str, Dict[str, Any]]:
    data = await http_get_json(session, f"{BYBIT_HTTP_BASE}/v5/market/tickers", {"category": "linear"})
    mp: Dict[str, Dict[str, Any]] = {}
    for it in (data.get("result", {}).get("list") or []):
        sym = it.get("symbol")
        mp[sym] = it
    return mp

async def fetch_last2_klines_one(session: aiohttp.ClientSession, symbol: str, interval: str):
    data = await http_get_json(session, f"{BYBIT_HTTP_BASE}/v5/market/kline",
                               {"category": "linear", "symbol": symbol, "interval": interval, "limit": 2})
    return data.get("result", {}).get("list") or []

async def fetch_last2_klines_all(session: aiohttp.ClientSession, syms: List[str]) -> Dict[Tuple[str, str], List]:
    sem = asyncio.Semaphore(HTTP_CONCURRENCY)
    out: Dict[Tuple[str, str], List] = {}

    async def one(sym: str, tf: str, interval: str):
        async with sem:
            out[(sym, tf)] = await fetch_last2_klines_one(session, sym, interval)

    tasks = [asyncio.create_task(one(sym, tf, itv)) for sym in syms for tf, itv in TF_INTERVALS.items()]
    await asyncio.gather(*tasks)
    return out

# ========================= WS: подписка к Bybit =========================
async def ws_linear_conn(topics: List[str], on_msg):
    async for ws in websockets.connect(BYBIT_WS_LINEAR, ping_interval=PING_INTERVAL, ping_timeout=10):
        try:
            await ws.send(dumps({"op": "subscribe", "args": topics}))
            async for raw in ws:
                with suppress(Exception):
                    msg = loads(raw if isinstance(raw, (bytes, bytearray)) else raw.encode())
                    await on_msg(msg)
        except (ConnectionClosed, ConnectionClosedError, ConnectionClosedOK):
            await asyncio.sleep(1.0)
            continue
        except Exception:
            await asyncio.sleep(2.0)
            continue

def buckets(lst: List[str], n: int) -> List[List[str]]:
    return [lst[i:i+n] for i in range(0, len(lst), n)]

# ========================= Обработка входящих от Bybit =========================
def update_ticker(sym: str, data: Dict[str, Any]):
    e = entries.get(sym)
    if not e: return
    lp = data.get("lastPrice")
    ts = data.get("ts") or data.get("timestamp") or now_ms()
    with suppress(Exception):
        if lp is not None:
            e["lastPrice"] = float(lp)
        e["lastPriceUpdatedAt"] = int(ts)

def parse_ws_kline_and_update(sym: str, tf: str, payload: Dict[str, Any]):
    arr = payload.get("data") or []
    if not arr: return
    k = arr[-1]
    confirm = bool(k.get("confirm", False))
    set_from_kline(sym, tf, k)  # обновляем open/last-процент
    with suppress(Exception):
        if confirm:
            roll_prev_close_on_close(sym, tf, float(k.get("close")))  # для close→close метрики

# ========================= Наш WS-сервер (всегда полный снапшот) =========================
async def safe_send(ws: WebSocketServerProtocol, payload: Dict[str, Any]) -> bool:
    try:
        await ws.send(dumps(payload))
        return True
    except (ConnectionClosed, ConnectionClosedError, ConnectionClosedOK, asyncio.CancelledError):
        return False
    except Exception:
        return False

async def broadcast_snapshot():
    payload = build_snapshot_json()
    async with clients_lock:
        targets = list(clients)
    if not targets:
        return
    results = await asyncio.gather(*(safe_send(ws, payload) for ws in targets), return_exceptions=True)
    to_drop = {ws for ws, ok in zip(targets, results) if ok is not True}
    if to_drop:
        async with clients_lock:
            for ws in to_drop:
                clients.discard(ws)
                with suppress(Exception):
                    await ws.close()

async def debounce_broadcaster():
    while True:
        await _dirty_event.wait()
        await asyncio.sleep(DEBOUNCE_MS / 1000.0)
        _dirty_event.clear()
        recompute_overview()   # overview считает по changePercent (open→last)
        await broadcast_snapshot()

async def handle_client(ws: WebSocketServerProtocol):
    async with clients_lock:
        clients.add(ws)

    with suppress(Exception):
        await ws.send(dumps(build_snapshot_json()))

    try:
        async for _ in ws:
            pass
    except (ConnectionClosed, ConnectionClosedError, ConnectionClosedOK, asyncio.CancelledError):
        pass
    finally:
        async with clients_lock:
            clients.discard(ws)

# ========================= Инициализация и запуск =========================
async def init_state_and_ws():
    global symbols
    async with aiohttp.ClientSession() as session:
        # 1) Инструменты
        instruments = await fetch_instruments(session)
        seen = set()
        symbols = []
        for it in instruments:
            s = it["symbol"]
            if s in seen: continue
            seen.add(s)
            symbols.append(it)

        # 2) Тикеры (lastPrice)
        tick_mp = await fetch_tickers(session)

        # 3) Последние 2 свечи по каждому ТФ (для prevClose и текущего бара)
        last2 = await fetch_last2_klines_all(session, [x["symbol"] for x in symbols])

        # 4) Сборка entries
        for it in symbols:
            sym, base, quote = it["symbol"], it["baseCoin"], it["quoteCoin"]
            e = ensure_entry(sym, base, quote)

            t = tick_mp.get(sym, {})
            with suppress(Exception):
                if t.get("lastPrice") is not None:
                    e["lastPrice"] = float(t.get("lastPrice"))
                e["lastPriceUpdatedAt"] = int(t.get("ts") or t.get("timestamp") or now_ms())

            for tf, interval in TF_INTERVALS.items():
                kl = last2.get((sym, tf)) or []
                if not kl:
                    continue
                # на всякий случай сортируем по start ASC
                with suppress(Exception):
                    kl = sorted(kl, key=_kline_start_ms)

                if len(kl) >= 2:
                    prev_k, cur_k = kl[-2], kl[-1]
                    pc = _gv(prev_k, "close", 4)
                    with suppress(Exception):
                        prev_close[(sym, tf)] = float(pc)  # для close→close
                    set_from_kline(sym, tf, cur_k)        # сразу посчитаем open→last
                else:
                    set_from_kline(sym, tf, kl[-1])

        recompute_overview()

    # 5) Подписки по WS
    topics: List[str] = []
    for it in symbols:
        s = it["symbol"]
        topics.append(f"tickers.{s}")
        for tf, interval in TF_INTERVALS.items():
            topics.append(f"kline.{interval}.{s}")

    topic_buckets = buckets(topics, MAX_TOPICS_PER_CONN)

    async def on_msg(msg: Dict[str, Any]):
        topic = msg.get("topic")
        if not topic:
            return

        if topic.startswith("tickers."):
            sym = topic.split(".", 1)[1]
            update_ticker(sym, msg.get("data") or {})
            mark_dirty()
            return

        if topic.startswith("kline."):
            parts = topic.split(".")
            if len(parts) != 3:
                return
            interval, sym = parts[1], parts[2]
            tf = INTERVAL_TO_TF.get(interval)
            if tf is None:
                return
            parse_ws_kline_and_update(sym, tf, msg)
            mark_dirty()

    tasks = [asyncio.create_task(ws_linear_conn(tb, on_msg)) for tb in topic_buckets]
    return tasks

async def main():
    await init_index_storage()

    # 1) Холодный старт + подписки Bybit
    ws_tasks = await init_state_and_ws()

    await maybe_capture_index_candle(force=True)

    # 2) Бродкастер полного снапшота (с дебаунсом)
    debouncer_task = asyncio.create_task(debounce_broadcaster(), name="debouncer")
    index_task = asyncio.create_task(index_candle_loop(), name="index-candles")

    # 3) Наш WebSocket-сервер
    async with websockets.serve(
        handle_client,
        BIND_HOST,
        BIND_PORT,
        ping_interval=25,
        ping_timeout=10,
        close_timeout=1,
        max_size=2**21,
        max_queue=0
    ):
        print(f"Local WS server: ws://{BIND_HOST}:{BIND_PORT} | Symbols={len(symbols)}")
        try:
            while True:
                await asyncio.sleep(3600)
        finally:
            debouncer_task.cancel()
            with suppress(asyncio.CancelledError):
                await debouncer_task
            index_task.cancel()
            with suppress(asyncio.CancelledError):
                await index_task
            for t in ws_tasks:
                t.cancel()
            with suppress(asyncio.CancelledError):
                await asyncio.gather(*ws_tasks)

    if redis_client is not None:
        with suppress(Exception):
            await redis_client.close()

if __name__ == "__main__":
    asyncio.run(main())
