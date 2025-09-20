import { useCallback, useEffect, useRef } from 'react';
import { SignalingClient } from './signalingClient';
import type {
  PeerUpdatePayload,
  RoomJoinedPayload,
  SignalEnvelope,
  SignalMessagePayload,
} from './types';

type JoinParams = {
  roomId: string;
  mode: 'call' | 'stream';
  role: string;
};

type HandlerContext = {
  client: SignalingClient;
  selfId: string | null;
  lastJoin: JoinParams | null;
  sendSignal: (targetClientId: string, signal: SignalEnvelope) => void;
};

type SignalingRoomHandlers = {
  onRoomJoined?: (payload: RoomJoinedPayload, context: HandlerContext) => void | Promise<void>;
  onPeerJoined?: (payload: PeerUpdatePayload, context: HandlerContext) => void | Promise<void>;
  onPeerLeft?: (payload: PeerUpdatePayload, context: HandlerContext) => void | Promise<void>;
  onSignal?: (payload: SignalMessagePayload, context: HandlerContext) => void | Promise<void>;
  onError?: (payload: unknown, context: HandlerContext) => void | Promise<void>;
  onClose?: (payload: CloseEvent, context: HandlerContext) => void | Promise<void>;
  onReconnected?: (context: HandlerContext) => void | Promise<void>;
  onReconnectionFailed?: (error: unknown, context: HandlerContext) => void | Promise<void>;
};

type UseSignalingRoomOptions = JoinParams & SignalingRoomHandlers;

type LeaveRoomOptions = {
  close?: boolean;
};

type UseSignalingRoomResult = {
  joinRoom: (override?: Partial<JoinParams>) => Promise<void>;
  leaveRoom: (options?: LeaveRoomOptions) => void;
  sendSignal: (targetClientId: string, signal: SignalEnvelope) => void;
};

const runHandler = async <T extends unknown[]>(
  handler: ((...args: T) => void | Promise<void>) | undefined,
  ...args: T
) => {
  if (!handler) {
    return;
  }

  try {
    await handler(...args);
  } catch (error) {
    console.error('[signaling-room] Ошибка при обработке события', error);
  }
};

export const useSignalingRoom = (options: UseSignalingRoomOptions): UseSignalingRoomResult => {
  const { roomId, mode, role, ...handlers } = options;

  const clientRef = useRef<SignalingClient | null>(null);
  const subscriptionsRef = useRef<(() => void)[]>([]);
  const lastJoinParamsRef = useRef<JoinParams | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const handlersRef = useRef<SignalingRoomHandlers>(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const detachListeners = useCallback(() => {
    subscriptionsRef.current.forEach((unsubscribe) => unsubscribe());
    subscriptionsRef.current = [];
  }, []);

  const sendSignal = useCallback(
    (targetClientId: string, signal: SignalEnvelope) => {
      const client = clientRef.current;
      const joinParams = lastJoinParamsRef.current;

      if (!client || !joinParams) {
        throw new Error('Нельзя отправить сигнал без активного подключения к комнате.');
      }

      if (!client.isConnected()) {
        throw new Error('Сигнальное соединение ещё не готово.');
      }

      client.send('signal', {
        roomId: joinParams.roomId,
        targetClientId,
        signal,
      });
    },
    [],
  );

  const createContext = useCallback(
    (client: SignalingClient): HandlerContext => ({
      client,
      selfId: selfIdRef.current,
      lastJoin: lastJoinParamsRef.current,
      sendSignal,
    }),
    [sendSignal],
  );

  const attachListeners = useCallback(
    (client: SignalingClient) => {
      const contextFactory = () => createContext(client);

      const roomJoined = client.on<RoomJoinedPayload>('room-joined', async (payload) => {
        selfIdRef.current = client.getClientId();
        await runHandler(handlersRef.current.onRoomJoined, payload, contextFactory());
      });

      const peerJoined = client.on<PeerUpdatePayload>('peer-joined', async (payload) => {
        await runHandler(handlersRef.current.onPeerJoined, payload, contextFactory());
      });

      const peerLeft = client.on<PeerUpdatePayload>('peer-left', async (payload) => {
        await runHandler(handlersRef.current.onPeerLeft, payload, contextFactory());
      });

      const signalListener = client.on<SignalMessagePayload>('signal', async (payload) => {
        await runHandler(handlersRef.current.onSignal, payload, contextFactory());
      });

      const errorListener = client.on('error', async (payload) => {
        await runHandler(handlersRef.current.onError, payload, contextFactory());
      });

      const closeListener = client.on('close', async (payload) => {
        selfIdRef.current = null;
        await runHandler(handlersRef.current.onClose, payload as CloseEvent, contextFactory());
      });

      const reconnectedListener = client.on('reconnected', async () => {
        const context = contextFactory();
        await runHandler(handlersRef.current.onReconnected, context);

        const joinParams = lastJoinParamsRef.current;
        if (!joinParams) {
          return;
        }

        try {
          if (!client.isConnected()) {
            await client.connect();
          }
          client.send('join-room', joinParams);
        } catch (error) {
          await runHandler(handlersRef.current.onReconnectionFailed, error, context);
        }
      });

      subscriptionsRef.current.push(
        roomJoined,
        peerJoined,
        peerLeft,
        signalListener,
        errorListener,
        closeListener,
        reconnectedListener,
      );
    },
    [createContext],
  );

  const ensureClient = useCallback(async () => {
    if (!clientRef.current) {
      const client = new SignalingClient();
      clientRef.current = client;
      attachListeners(client);
    }

    const client = clientRef.current;
    if (!client) {
      throw new Error('Не удалось инициализировать сигналинг');
    }

    await client.connect();
    return client;
  }, [attachListeners]);

  const joinRoom = useCallback(
    async (override?: Partial<JoinParams>) => {
      const client = await ensureClient();
      const joinPayload: JoinParams = {
        roomId: override?.roomId ?? roomId,
        mode: override?.mode ?? mode,
        role: override?.role ?? role,
      };

      lastJoinParamsRef.current = joinPayload;
      client.send('join-room', joinPayload);
    },
    [ensureClient, mode, role, roomId],
  );

  const leaveRoom = useCallback(
    (options: LeaveRoomOptions = {}) => {
      const { close = false } = options;
      const client = clientRef.current;
      if (!client) {
        return;
      }

      const joined = lastJoinParamsRef.current;
      if (joined && client.isConnected()) {
        try {
          client.send('leave-room', {});
        } catch (error) {
          console.warn('[signaling-room] Не удалось отправить leave-room', error);
        }
      }

      lastJoinParamsRef.current = null;
      selfIdRef.current = null;

      if (close) {
        detachListeners();
        client.close();
        clientRef.current = null;
      }
    },
    [detachListeners],
  );

  useEffect(() => {
    return () => {
      leaveRoom({ close: true });
    };
  }, [leaveRoom]);

  return {
    joinRoom,
    leaveRoom,
    sendSignal,
  };
};

