import { Alert, Button, Card, Input, Space, Tag, Typography, message } from 'antd';
import { VideoCameraOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import { SignalingClient } from '../../lib/signalingClient';
import { iceServers } from '../../lib/constants';
import type {
  PeerUpdatePayload,
  RoomJoinedPayload,
  SignalEnvelope,
  SignalMessagePayload,
} from '../../lib/types';

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

  const signalingRef = useRef<SignalingClient | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const hostIdRef = useRef<string | null>(null);
  const subscriptionsRef = useRef<(() => void)[]>([]);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const attachListeners = (client: SignalingClient) => {
    const roomJoined = client.on<RoomJoinedPayload>('room-joined', (payload) => {
      setStatus('Ожидание ведущего.');
      const host = payload.participants.find((participant) => participant.role === STREAM_ROLE_HOST);
      hostIdRef.current = host?.clientId ?? null;
      if (!host) {
        setStatus('Ведущий пока не подключился. Как только он начнёт трансляцию, видео появится автоматически.');
      }
    });

    const peerJoined = client.on<PeerUpdatePayload>('peer-joined', (payload) => {
      if (payload.role === STREAM_ROLE_HOST) {
        hostIdRef.current = payload.clientId;
        setStatus('Ведущий подключился. Ожидаем видео.');
      }
    });

    const peerLeft = client.on<PeerUpdatePayload>('peer-left', (payload) => {
      if (payload.clientId === hostIdRef.current) {
        setStatus('Ведущий покинул комнату. Трансляция остановлена.');
        stopViewing(false);
      }
    });

    const signalListener = client.on<SignalMessagePayload>('signal', async (payload) => {
      if (!payload || payload.senderId !== hostIdRef.current) {
        return;
      }
      const { signal } = payload;
      if (signal.kind === 'description' && signal.description.type === 'offer') {
        await handleOffer(signal.description);
      }
      if (signal.kind === 'candidate') {
        await peerConnectionRef.current?.addIceCandidate(signal.candidate).catch((error) => {
          console.error('[viewer] Ошибка добавления ICE-кандидата', error);
        });
      }
    });

    const errorListener = client.on('error', (payload) => {
      console.error('[viewer] Ошибка сигналинга', payload);
      messageApi.error('Ошибка сигналинга. Попробуйте переподключиться.');
    });

    subscriptionsRef.current.push(roomJoined, peerJoined, peerLeft, signalListener, errorListener);
  };

  const detachListeners = () => {
    subscriptionsRef.current.forEach((unsubscribe) => unsubscribe());
    subscriptionsRef.current = [];
  };

  const ensureSignaling = async () => {
    if (!signalingRef.current) {
      signalingRef.current = new SignalingClient();
      attachListeners(signalingRef.current);
    }
    await signalingRef.current.connect();
    return signalingRef.current;
  };

  const createPeerConnection = () => {
    if (peerConnectionRef.current) {
      return peerConnectionRef.current;
    }
    const connection = new RTCPeerConnection({ iceServers });
    connection.ontrack = (event) => {
      const stream = event.streams[0];
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play().catch(() => undefined);
      }
    };
    connection.onicecandidate = (event) => {
      if (!event.candidate || !signalingRef.current || !hostIdRef.current) {
        return;
      }
      const signal: SignalEnvelope = {
        kind: 'candidate',
        candidate: event.candidate.toJSON(),
      };
      signalingRef.current.send('signal', {
        roomId,
        targetClientId: hostIdRef.current,
        signal,
      });
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
  };

  const handleOffer = async (description: RTCSessionDescriptionInit) => {
    const connection = createPeerConnection();
    await connection.setRemoteDescription(description);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    if (!signalingRef.current || !hostIdRef.current) {
      return;
    }
    const signal: SignalEnvelope = {
      kind: 'description',
      description: answer,
    };
    signalingRef.current.send('signal', {
      roomId,
      targetClientId: hostIdRef.current,
      signal,
    });
    setIsWatching(true);
    setStatus('Трансляция активна.');
  };

  const startViewing = async () => {
    if (!roomId) {
      messageApi.warning('Введите идентификатор комнаты.');
      return;
    }
    setIsConnecting(true);
    try {
      const client = await ensureSignaling();
      client.send('join-room', { roomId, mode: 'stream', role: STREAM_ROLE_VIEWER });
      setStatus('Подключаемся к комнате…');
    } catch (error) {
      console.error('[viewer] Не удалось подключиться', error);
      messageApi.error('Не удалось подключиться. Проверьте код комнаты.');
    } finally {
      setIsConnecting(false);
    }
  };

  const stopViewing = (notify = true) => {
    if (notify) {
      signalingRef.current?.send('leave-room', {});
    }
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    setIsWatching(false);
  };

  useEffect(() => {
    if (autoStart && initialRoomId) {
      startViewing().catch(() => undefined);
    }
    return () => {
      stopViewing(false);
      detachListeners();
      signalingRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
