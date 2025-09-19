type Listener<T = unknown> = (payload: T) => void;

type ListenerMap = Map<string, Set<Listener>>;

type MessageEnvelope<T = unknown> = {
  type: string;
  payload?: T;
};

export class SignalingClient {
  private socket: WebSocket | null = null;

  private listeners: ListenerMap = new Map();

  private openPromise: Promise<void> | null = null;

  private clientId: string | null = null;

  private url: string;

  private shouldReconnect = true;

  private reconnectAttempts = 0;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string = SignalingClient.buildUrl()) {
    this.url = url;
  }

  static buildUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${protocol}://${window.location.host}`;
  }

  async connect() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.openPromise) {
      return this.openPromise;
    }

    this.shouldReconnect = true;
    console.log('[signaling] Инициализация соединения', { url: this.url });
    this.openPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;

      socket.addEventListener('open', () => {
        console.log('[signaling] Соединение установлено');
        this.emit('open');
        this.reconnectAttempts = 0;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        resolve();
      });

      socket.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(event.data) as MessageEnvelope;
          if (message.type === 'welcome') {
            const welcomePayload = message.payload as { clientId?: string } | undefined;
            this.clientId = welcomePayload?.clientId ?? null;
            console.log('[signaling] Получен идентификатор клиента', { clientId: this.clientId });
          }

          this.emit(message.type, message.payload);
        } catch (error) {
          console.error('[signaling] Ошибка при разборе сообщения', error);
        }
      });

      socket.addEventListener('close', (event) => {
        console.log('[signaling] Соединение закрыто', event);
        this.emit('close', event);
        this.socket = null;
        this.openPromise = null;
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });

      socket.addEventListener('error', (event) => {
        console.error('[signaling] Ошибка соединения', event);
        this.emit('error', event);
        reject(event);
        this.openPromise = null;
        if (this.shouldReconnect && (!this.socket || this.socket.readyState !== WebSocket.OPEN)) {
          this.scheduleReconnect();
        }
      });
    });

    return this.openPromise;
  }

  getClientId() {
    return this.clientId;
  }

  isConnected() {
    return Boolean(this.socket && this.socket.readyState === WebSocket.OPEN);
  }

  send<T>(type: string, payload: T) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket соединение ещё не готово. Вызовите connect().');
    }

    const envelope: MessageEnvelope<T> = { type, payload };
    console.log('[signaling] Отправка сообщения', envelope);
    this.socket.send(JSON.stringify(envelope));
  }

  on<T = unknown>(type: string, listener: Listener<T>) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener as Listener);
    this.listeners.set(type, listeners);
    return () => this.off(type, listener as Listener);
  }

  off(type: string, listener: Listener) {
    const listeners = this.listeners.get(type);
    if (!listeners) {
      return;
    }
    listeners.delete(listener);
    if (listeners.size === 0) {
      this.listeners.delete(type);
    }
  }

  emit<T = unknown>(type: string, payload?: T) {
    const listeners = this.listeners.get(type);
    if (!listeners) {
      return;
    }
    listeners.forEach((listener) => listener(payload));
  }

  close(code?: number, reason?: string) {
    if (this.socket) {
      console.log('[signaling] Закрытие соединения', { code, reason });
      this.shouldReconnect = false;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.socket.close(code, reason);
      this.socket = null;
      this.openPromise = null;
    }
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect || this.reconnectTimer) {
      return;
    }

    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 10000);
    this.reconnectAttempts += 1;
    console.log('[signaling] Планируем переподключение', { delay, attempts: this.reconnectAttempts });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect()
        .then(() => {
          console.log('[signaling] Соединение восстановлено после обрыва');
          this.emit('reconnected');
        })
        .catch((error) => {
          console.error('[signaling] Ошибка при переподключении', error);
          this.scheduleReconnect();
        });
    }, delay);
  }
}
