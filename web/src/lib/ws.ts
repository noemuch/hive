type EventHandler = (data: Record<string, unknown>) => void;
type StatusListener = (status: ConnectionStatus) => void;
type ConnectionStatus = "connected" | "disconnected" | "reconnecting";

export class HiveSocket {
  private static _instance: HiveSocket | null = null;

  private ws: WebSocket | null = null;
  private url: string | null = null;
  private listeners = new Map<string, Set<EventHandler>>();
  private statusListeners = new Set<StatusListener>();
  private sendBuffer: object[] = [];
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private watchedBureauId: string | null = null;
  private _status: ConnectionStatus = "disconnected";
  private intentionalClose = false;

  private static readonly MAX_RECONNECT_DELAY = 30_000;
  private static readonly IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

  private constructor() {}

  static instance(): HiveSocket {
    if (!HiveSocket._instance) {
      HiveSocket._instance = new HiveSocket();
    }
    return HiveSocket._instance;
  }

  get connected(): boolean {
    return this._status === "connected";
  }

  get reconnecting(): boolean {
    return this._status === "reconnecting";
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  connect(url: string): void {
    this.url = url;
    this.intentionalClose = false;
    this.openSocket();
    this.setupVisibilityHandler();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.clearIdleTimer();
    this.removeVisibilityHandler();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  send(event: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    } else {
      this.sendBuffer.push(event);
    }
  }

  on(eventType: string, handler: EventHandler): () => void {
    let set = this.listeners.get(eventType);
    if (!set) {
      set = new Set();
      this.listeners.set(eventType, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
      if (set!.size === 0) this.listeners.delete(eventType);
    };
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  watchBureau(bureauId: string): void {
    if (this.watchedBureauId) {
      this.send({ type: "unwatch_bureau", bureau_id: this.watchedBureauId });
    }
    this.watchedBureauId = bureauId;
    this.send({ type: "watch_bureau", bureau_id: bureauId });
  }

  unwatchBureau(): void {
    if (this.watchedBureauId) {
      this.send({ type: "unwatch_bureau", bureau_id: this.watchedBureauId });
      this.watchedBureauId = null;
    }
  }

  // --- Private ---

  private openSocket(): void {
    if (!this.url) return;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.setStatus("connected");
      this.flushBuffer();
      if (this.watchedBureauId) {
        this.send({ type: "watch_bureau", bureau_id: this.watchedBureauId });
      }
    };

    ws.onmessage = (event) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(event.data as string);
      } catch {
        return;
      }
      const type = data.type as string;
      if (!type) return;
      const handlers = this.listeners.get(type);
      if (handlers) {
        for (const handler of handlers) {
          handler(data);
        }
      }
    };

    ws.onclose = () => {
      this.ws = null;
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      } else {
        this.setStatus("disconnected");
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  private scheduleReconnect(): void {
    this.setStatus("reconnecting");
    this.clearReconnectTimer();

    const baseDelay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), HiveSocket.MAX_RECONNECT_DELAY);
    const jitter = Math.random() * 1000 - 500; // ±500ms
    const delay = Math.max(0, baseDelay + jitter);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempt++;
      this.openSocket();
    }, delay);
  }

  private flushBuffer(): void {
    const buffered = this.sendBuffer.splice(0);
    for (const event of buffered) {
      this.send(event);
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this._status === status) return;
    this._status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // --- Visibility (idle timeout) ---

  private visibilityHandler = (): void => {
    if (document.hidden) {
      this.clearIdleTimer();
      this.idleTimer = setTimeout(() => {
        this.intentionalClose = true;
        this.ws?.close();
        this.ws = null;
        this.setStatus("disconnected");
      }, HiveSocket.IDLE_TIMEOUT);
    } else {
      this.clearIdleTimer();
      if (this._status === "disconnected" && this.url && !this.intentionalClose) {
        this.openSocket();
      }
      // Also reconnect if we were idle-disconnected
      if (this._status === "disconnected" && this.url) {
        this.intentionalClose = false;
        this.openSocket();
      }
    }
  };

  private setupVisibilityHandler(): void {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }
  }

  private removeVisibilityHandler(): void {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
  }
}
