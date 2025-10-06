import type { MarketResponse } from "./types";

const RECONNECT_INITIAL_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;

function resolveWsUrl(): string {
  const env = (typeof import.meta !== "undefined" ? (import.meta as any).env : undefined) as
    | Record<string, string | undefined>
    | undefined;
  const envUrl = env?.VITE_MARKET_WS_URL ?? env?.VITE_WS_URL ?? env?.VITE_API_WS_URL;
  if (envUrl) {
    return envUrl;
  }
  if (typeof window === "undefined") {
    return "ws://45.130.215.131:8765";
  }
  const { protocol, hostname } = window.location;
  const wsProtocol = protocol === "https:" ? "wss" : "ws";
  const port = env?.VITE_MARKET_WS_PORT ?? "8765";
  return "ws://45.130.215.131:8765";
}

function decodeBinaryMessage(data: ArrayBuffer | ArrayBufferView): string | null {
  try {
    const view =
      data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return new TextDecoder().decode(view);
  } catch (err) {
    console.error("Failed to decode market stream payload", err);
    return null;
  }
}

function isMarketResponse(value: unknown): value is MarketResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.entries) &&
    Array.isArray(candidate.overview) &&
    typeof candidate.updatedAt === "number"
  );
}

interface SnapshotSubscriber {
  handler: (snapshot: MarketResponse) => void;
  onError?: (error: Error) => void;
}

class MarketSnapshotSocket {
  private socket: WebSocket | null = null;
  private subscribers = new Map<number, SnapshotSubscriber>();
  private nextSubscriberId = 1;
  private reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;
  private lastSnapshot: MarketResponse | null = null;
  private outboundQueue: string[] = [];

  subscribe(
    handler: (snapshot: MarketResponse) => void,
    onError?: (error: Error) => void
  ): () => void {
    if (typeof window === "undefined") {
      if (onError) {
        onError(new Error("WebSocket environment is not available"));
      }
      return () => undefined;
    }

    const id = this.nextSubscriberId++;
    this.subscribers.set(id, { handler, onError });

    if (this.lastSnapshot) {
      void Promise.resolve().then(() => handler(this.lastSnapshot!));
    } else if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.send({ action: "snapshot" });
    }

    this.ensureConnected();

    return () => {
      this.subscribers.delete(id);
      if (this.subscribers.size === 0) {
        this.teardown();
      }
    };
  }

  private ensureConnected(): void {
    if (typeof window === "undefined") {
      return;
    }
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.manualClose = false;
    let socket: WebSocket;
    try {
      socket = new WebSocket(resolveWsUrl());
    } catch (err) {
      this.notifyError(err instanceof Error ? err : new Error("Failed to open market stream"));
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    socket.addEventListener("open", this.handleOpen);
    socket.addEventListener("message", this.handleMessage);
    socket.addEventListener("close", this.handleClose);
    socket.addEventListener("error", this.handleSocketError);
  }

  private teardown(): void {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    if (socket) {
      socket.removeEventListener("open", this.handleOpen);
      socket.removeEventListener("message", this.handleMessage);
      socket.removeEventListener("close", this.handleClose);
      socket.removeEventListener("error", this.handleSocketError);
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
    this.socket = null;
  }

  private handleOpen = (): void => {
    this.reconnectDelay = RECONNECT_INITIAL_DELAY_MS;
    this.flushQueue();
    this.send({ action: "snapshot" });
  };

  private handleMessage = (event: MessageEvent): void => {
    const { data } = event;

    if (typeof data === "string") {
      this.parseMessage(data);
      return;
    }

    if (data instanceof Blob) {
      data
        .text()
        .then((text) => this.parseMessage(text))
        .catch((err) => console.error("Failed to read market stream blob", err));
      return;
    }

    if (data instanceof ArrayBuffer) {
      const decoded = decodeBinaryMessage(data);
      if (decoded !== null) {
        this.parseMessage(decoded);
      }
      return;
    }

    if (ArrayBuffer.isView(data)) {
      const decoded = decodeBinaryMessage(data);
      if (decoded !== null) {
        this.parseMessage(decoded);
      }
      return;
    }

    console.warn("Unsupported market stream payload", data);
  };

  private parseMessage(raw: string): void {
    if (raw === "pong") {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("Failed to parse market stream message", err, raw);
      return;
    }

    if (isMarketResponse(parsed)) {
      this.lastSnapshot = parsed;
      this.notifySnapshot(parsed);
      return;
    }

    if (parsed && typeof parsed === "object") {
      const payload = parsed as Record<string, unknown>;
      if (payload.ok === true) {
        return;
      }
    }

    console.warn("Unknown market stream message", parsed);
  }

  private handleClose = (): void => {
    const socket = this.socket;
    if (socket) {
      socket.removeEventListener("open", this.handleOpen);
      socket.removeEventListener("message", this.handleMessage);
      socket.removeEventListener("close", this.handleClose);
      socket.removeEventListener("error", this.handleSocketError);
    }
    this.socket = null;

    if (this.manualClose || this.subscribers.size === 0) {
      this.manualClose = false;
      return;
    }

    this.notifyError(new Error("Market stream connection lost"));
    this.scheduleReconnect();
  };

  private handleSocketError = (): void => {
    if (this.subscribers.size > 0) {
      this.notifyError(new Error("Market stream connection error"));
    }
  };

  private notifySnapshot(snapshot: MarketResponse): void {
    for (const subscriber of this.subscribers.values()) {
      try {
        subscriber.handler(snapshot);
      } catch (err) {
        console.error("Failed to process market snapshot", err);
      }
    }
  }

  private notifyError(error: Error): void {
    let handled = false;
    for (const subscriber of this.subscribers.values()) {
      if (!subscriber.onError) {
        continue;
      }
      handled = true;
      try {
        subscriber.onError(error);
      } catch (err) {
        console.error("Failed to notify market stream error", err);
      }
    }
    if (!handled) {
      console.error("Market stream error", error);
    }
  }

  private scheduleReconnect(): void {
    if (this.manualClose || this.subscribers.size === 0) {
      return;
    }
    if (this.reconnectTimer) {
      return;
    }

    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_DELAY_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnected();
    }, delay);
  }

  private send(payload: unknown): void {
    const message = typeof payload === "string" ? payload : JSON.stringify(payload);
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.outboundQueue.push(message);
      this.ensureConnected();
      return;
    }

    try {
      this.socket.send(message);
    } catch (err) {
      console.error("Failed to send market stream message", err);
    }
  }

  private flushQueue(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    while (this.outboundQueue.length > 0) {
      const message = this.outboundQueue.shift();
      if (!message) {
        continue;
      }
      try {
        this.socket.send(message);
      } catch (err) {
        console.error("Failed to flush market stream message", err);
        this.outboundQueue.unshift(message);
        break;
      }
    }
  }
}

const sharedSocket = new MarketSnapshotSocket();

export function subscribeMarketSnapshots(
  handler: (snapshot: MarketResponse) => void,
  onError?: (error: Error) => void
): () => void {
  return sharedSocket.subscribe(handler, onError);
}
