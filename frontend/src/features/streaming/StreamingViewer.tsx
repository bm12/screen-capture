import { Alert, Button, Card, Input, Space, Tag, Typography, message } from 'antd';
import { VideoCameraOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPeerConnection as createRtcPeerConnection } from '../../lib/peerConnection';
import type { SignalEnvelope } from '../../lib/types';
import { useSignalingRoom } from '../../lib/useSignalingRoom';

const STREAM_ROLE_HOST = 'host';
const STREAM_ROLE_VIEWER = 'viewer';

type StreamViewerProps = {
  initialRoomId?: string;
  autoStart?: boolean;
};

export const StreamingViewer = ({ initialRoomId = '', autoStart = false }: StreamViewerProps) => {
  const [roomId, setRoomId] = useState(initialRoomId);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isWatching, setIsWatching] = useState(false);
  const [status, setStatus] = useState<string>('Введите код комнаты, чтобы подключиться.');
  const [messageApi, contextHolder] = message.useMessage();

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const hostIdRef = useRef<string | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const sendSignalRef = useRef<(targetClientId: string, signal: SignalEnvelope) => void>(() => {
    throw new Error('Сигнальное соединение ещё не готово.');
  });
  const isUnmountedRef = useRef(false);

  const pendingConnectionRef = useRef<Promise<RTCPeerConnection> | null>(null);

  const ensurePeerConnection = useCallback(async () => {
    if (peerConnectionRef.current) {
      return peerConnectionRef.current;
    }

    if (pendingConnectionRef.current) {
      return pendingConnectionRef.current;
    }

    const connectionPromise = (async () => {
      try {
        const uid = hostIdRef.current ?? roomId ?? 'viewer';
        const connection = await createRtcPeerConnection({ uid });
        connection.ontrack = (event) => {
          const stream = event.streams[0];
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = stream;
            remoteVideoRef.current.play().catch(() => undefined);
          }
        };
        connection.onicecandidate = (event) => {
          if (!event.candidate || !hostIdRef.current) {
            return;
          }
          const signal: SignalEnvelope = {
            kind: 'candidate',
            candidate: event.candidate.toJSON(),
          };
          try {
            sendSignalRef.current(hostIdRef.current, signal);
          } catch (error) {
            console.error('[viewer] Не удалось отправить ICE-кандидата ведущему', error);
          }
        };
        connection.onconnectionstatechange = () => {
          const state = connection.connectionState;
          console.log('[viewer] Состояние соединения', state);
          if (state === 'failed' || state === 'disconnected') {
            setStatus('Соединение прервано. Попробуйте переподключиться.');
          }
        };

        peerConnectionRef.current = connection;
        return connection;
      } catch (error) {
        console.error('[viewer] Не удалось создать WebRTC соединение', error);
        if (!isUnmountedRef.current) {
          messageApi.error('Не удалось подключиться к ведущему. Попробуйте ещё раз.');
        }
        throw error;
      } finally {
        pendingConnectionRef.current = null;
      }
    })();

    pendingConnectionRef.current = connectionPromise;
    return connectionPromise;
  }, [messageApi, roomId, setStatus]);

  const handleOffer = useCallback(
    async (description: RTCSessionDescriptionInit) => {
      const connection = await ensurePeerConnection().catch(() => null);
      if (!connection) {
        return;
      }
      await connection.setRemoteDescription(description);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      if (!hostIdRef.current) {
        return;
      }
      const signal: SignalEnvelope = {
        kind: 'description',
        description: answer,
      };
      try {
        sendSignalRef.current(hostIdRef.current, signal);
        setIsWatching(true);
        setStatus('Трансляция активна.');
      } catch (error) {
        console.error('[viewer] Не удалось отправить answer ведущему', error);
      }
    },
    [ensurePeerConnection],
  );

  const { joinRoom, leaveRoom, sendSignal } = useSignalingRoom({
    roomId,
    mode: 'stream',
    role: STREAM_ROLE_VIEWER,
    onRoomJoined: async (payload) => {
      console.log('[viewer] Подключены к комнате', payload);
      const host = payload.participants.find((participant) => participant.role === STREAM_ROLE_HOST);
      hostIdRef.current = host?.clientId ?? null;
      if (!host) {
        setStatus('Ведущий пока не подключился. Как только он начнёт трансляцию, видео появится автоматически.');
      } else {
        setStatus('Ведущий уже в комнате. Ожидаем видео.');
      }
    },
    onPeerJoined: async (payload) => {
      if (payload.role === STREAM_ROLE_HOST) {
        hostIdRef.current = payload.clientId;
        setStatus('Ведущий подключился. Ожидаем видео.');
      }
    },
    onPeerLeft: async (payload) => {
      if (payload.clientId === hostIdRef.current) {
        setStatus('Ведущий покинул комнату. Трансляция остановлена.');
        hostIdRef.current = null;
        peerConnectionRef.current?.close();
        peerConnectionRef.current = null;
        pendingConnectionRef.current = null;
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = null;
        }
        setIsWatching(false);
      }
    },
    onSignal: async (payload) => {
      if (!payload || payload.senderId !== hostIdRef.current) {
        return;
      }
      const { signal } = payload;
      if (signal.kind === 'description' && signal.description.type === 'offer') {
        await handleOffer(signal.description);
      }
      if (signal.kind === 'candidate') {
        const connection =
          peerConnectionRef.current ?? (await pendingConnectionRef.current?.catch(() => null));
        await connection?.addIceCandidate(signal.candidate).catch((error) => {
          console.error('[viewer] Ошибка добавления ICE-кандидата', error);
        });
      }
    },
    onError: async (payload) => {
      console.error('[viewer] Ошибка сигналинга', payload);
      messageApi.error('Ошибка сигналинга. Попробуйте переподключиться.');
    },
    onClose: async () => {
      console.warn('[viewer] Сигнальное соединение закрыто');
      peerConnectionRef.current?.close();
      peerConnectionRef.current = null;
      pendingConnectionRef.current = null;
      if (!isUnmountedRef.current) {
        setIsWatching(false);
        setStatus('Сигналинг отключился. Пытаемся переподключиться…');
      }
    },
    onReconnected: async () => {
      console.log('[viewer] Сигналинг переподключился');
      if (!isUnmountedRef.current) {
        setStatus('Сигналинг восстановлен. Ждём ведущего.');
      }
    },
    onReconnectionFailed: async (error) => {
      console.error('[viewer] Не удалось переподключиться', error);
      messageApi.error('Не удалось восстановить соединение. Попробуйте подключиться повторно.');
    },
  });

  sendSignalRef.current = sendSignal;

  const startViewing = useCallback(async () => {
    if (!roomId) {
      messageApi.warning('Введите идентификатор комнаты.');
      return;
    }
    setIsConnecting(true);
    try {
      console.log('[viewer] Отправляем запрос на присоединение к комнате', { roomId });
      await joinRoom();
      setStatus('Подключаемся к комнате…');
    } catch (error) {
      console.error('[viewer] Не удалось подключиться', error);
      messageApi.error('Не удалось подключиться. Проверьте код комнаты.');
    } finally {
      setIsConnecting(false);
    }
  }, [joinRoom, messageApi, roomId]);

  const stopViewing = useCallback(
    (notify = true) => {
      if (notify) {
        leaveRoom();
      }
      peerConnectionRef.current?.close();
      peerConnectionRef.current = null;
      pendingConnectionRef.current = null;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      setIsWatching(false);
    },
    [leaveRoom],
  );

  useEffect(() => {
    isUnmountedRef.current = false;
    if (autoStart && initialRoomId) {
      startViewing().catch(() => undefined);
    }
    return () => {
      isUnmountedRef.current = true;
      stopViewing(false);
      leaveRoom({ close: true });
    };
  }, [autoStart, initialRoomId, leaveRoom, startViewing, stopViewing]);

  return (
    <Card className="section-card" bordered={false}>
      {contextHolder}
      <Space direction="vertical" size="large" className="full-width">
        <div>
          <Typography.Title level={4}>Я зритель</Typography.Title>
          <Typography.Paragraph className="card-description">
            Введите код комнаты или откройте ссылку, которую отправил ведущий. После подключения
            трансляция появится автоматически.
          </Typography.Paragraph>
        </div>
        <Space.Compact className="full-width">
          <Input
            placeholder="Например, AB12CD"
            value={roomId}
            onChange={(event) => setRoomId(event.target.value.toUpperCase())}
            disabled={isWatching}
          />
          <Button type="primary" onClick={startViewing} loading={isConnecting} disabled={isWatching}>
            Подключиться
          </Button>
          <Button onClick={() => stopViewing()} disabled={!isWatching}>
            Отключиться
          </Button>
        </Space.Compact>
        <div className="video-preview">
          <video ref={remoteVideoRef} autoPlay playsInline controls muted={false} />
        </div>
        <Space>
          <Tag icon={<VideoCameraOutlined />} color={isWatching ? 'green' : 'default'}>
            {isWatching ? 'Трансляция активна' : 'Ожидание трансляции'}
          </Tag>
        </Space>
        <Alert type="info" showIcon message={status} />
      </Space>
    </Card>
  );
};
