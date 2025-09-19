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

    console.log('[signaling] Инициализация соединения', { url: this.url });
    this.openPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;

      socket.addEventListener('open', () => {
        console.log('[signaling] Соединение установлено');
        this.emit('open');
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
      });

      socket.addEventListener('error', (event) => {
        console.error('[signaling] Ошибка соединения', event);
        this.emit('error', event);
        reject(event);
        this.openPromise = null;
      });
    });

    return this.openPromise;
  }

  getClientId() {
    return this.clientId;
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
      this.socket.close(code, reason);
      this.socket = null;
      this.openPromise = null;
    }
  }
}
