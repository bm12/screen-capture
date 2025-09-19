import {
  Alert,
  Button,
  Card,
  Checkbox,
  Input,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { CopyOutlined, ReloadOutlined, UserSwitchOutlined } from '@ant-design/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addTracksToStream,
  getCameraImageSizes,
  getDisplayMedia,
  getScreenSizes,
  getUserMedia,
  stopStream,
} from '../../lib/media';
import { AudioStreamMixer } from '../../lib/audioMixer';
import { VideoStreamMixer } from '../../lib/videoMixer';
import { SignalingClient } from '../../lib/signalingClient';
import { generateRoomId, iceServers } from '../../lib/constants';
import type {
  PeerUpdatePayload,
  RoomJoinedPayload,
  SignalEnvelope,
  SignalMessagePayload,
} from '../../lib/types';

const STREAM_ROLE_HOST = 'host';
const STREAM_ROLE_VIEWER = 'viewer';

export const StreamingHostPanel = () => {
  const [roomId, setRoomId] = useState(generateRoomId());
  const [includeSystemAudio, setIncludeSystemAudio] = useState(true);
  const [includeMicrophone, setIncludeMicrophone] = useState(true);
  const [includeCamera, setIncludeCamera] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [viewerIds, setViewerIds] = useState<string[]>([]);

  const [messageApi, contextHolder] = message.useMessage();

  const signalingRef = useRef<SignalingClient | null>(null);
  const signalingSubscriptionsRef = useRef<(() => void)[]>([]);
  const listenersAttachedRef = useRef(false);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const userStreamRef = useRef<MediaStream | null>(null);
  const composedStreamRef = useRef<MediaStream | null>(null);
  const audioMixerRef = useRef<AudioStreamMixer | null>(null);
  const videoMixerRef = useRef<VideoStreamMixer | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);

  const shareLink = useMemo(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    return `${window.location.origin}/stream/${roomId}`;
  }, [roomId]);

  const ensureSignaling = async () => {
    if (!signalingRef.current) {
      signalingRef.current = new SignalingClient();
    }
    await signalingRef.current.connect();

    if (!listenersAttachedRef.current) {
      attachSignalingListeners(signalingRef.current);
    }

    return signalingRef.current;
  };

  const attachSignalingListeners = (client: SignalingClient) => {
    const roomJoined = client.on<RoomJoinedPayload>('room-joined', (payload) => {
      console.log('[stream-host] Подключены к комнате', payload);
      const currentViewers = payload.participants
        .filter((participant) => participant.role === STREAM_ROLE_VIEWER)
        .map((participant) => participant.clientId);
      setViewerIds(currentViewers);
      currentViewers.forEach((viewerId) => {
        createOfferForViewer(viewerId).catch((error) =>
          console.error('[stream-host] Не удалось отправить оффер существующему зрителю', error),
        );
      });
    });

    const peerJoined = client.on<PeerUpdatePayload>('peer-joined', async (payload) => {
      console.log('[stream-host] К комнате подключился участник', payload);
      if (payload.role !== STREAM_ROLE_VIEWER) {
        return;
      }
      setViewerIds((prev) => Array.from(new Set([...prev, payload.clientId])));
      await createOfferForViewer(payload.clientId);
    });

    const peerLeft = client.on<PeerUpdatePayload>('peer-left', (payload) => {
      console.log('[stream-host] Участник покинул комнату', payload);
      if (payload.clientId) {
        closePeerConnection(payload.clientId);
        setViewerIds((prev) => prev.filter((id) => id !== payload.clientId));
      }
    });

    const signalListener = client.on<SignalMessagePayload>('signal', async (payload) => {
      if (!payload || !payload.senderId) {
        return;
      }

      const { senderId, signal } = payload;
      if (signal.kind === 'description' && signal.description.type === 'answer') {
        const connection = peerConnectionsRef.current.get(senderId);
        if (!connection) {
          console.warn('[stream-host] Не найдено соединение для зрителя', senderId);
          return;
        }
        await connection.setRemoteDescription(signal.description);
      }

      if (signal.kind === 'candidate') {
        const connection = peerConnectionsRef.current.get(senderId);
        if (!connection) {
          console.warn('[stream-host] Не найдено соединение для добавления ICE', senderId);
          return;
        }
        try {
          await connection.addIceCandidate(signal.candidate);
        } catch (error) {
          console.error('[stream-host] Ошибка при добавлении ICE-кандидата', error);
        }
      }
    });

    const errorListener = client.on('error', (payload) => {
      console.error('[stream-host] Ошибка сигналинга', payload);
      messageApi.error('Ошибка сигналинга. Попробуйте перезапустить трансляцию.');
    });

    signalingSubscriptionsRef.current.push(roomJoined, peerJoined, peerLeft, signalListener, errorListener);
    listenersAttachedRef.current = true;
  };

  const detachSignalingListeners = () => {
    signalingSubscriptionsRef.current.forEach((unsubscribe) => unsubscribe());
    signalingSubscriptionsRef.current = [];
    listenersAttachedRef.current = false;
  };

  const closePeerConnection = (viewerId: string) => {
    const connection = peerConnectionsRef.current.get(viewerId);
    if (connection) {
      connection.onicecandidate = null;
      connection.ontrack = null;
      connection.close();
      peerConnectionsRef.current.delete(viewerId);
    }
  };

  const stopAllPeerConnections = () => {
    peerConnectionsRef.current.forEach((connection) => {
      connection.onicecandidate = null;
      connection.ontrack = null;
      connection.close();
    });
    peerConnectionsRef.current.clear();
  };

  const cleanupStreams = () => {
    stopStream(screenStreamRef.current);
    stopStream(userStreamRef.current);
    stopStream(composedStreamRef.current);
    audioMixerRef.current?.destroy();
    audioMixerRef.current = null;
    videoMixerRef.current?.destroy();
    videoMixerRef.current = null;
    screenStreamRef.current = null;
    userStreamRef.current = null;
    composedStreamRef.current = null;
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null;
    }
  };

  const createBaseStream = async () => {
    const screenSizes = getScreenSizes();
    const displayStream = await getDisplayMedia(includeSystemAudio, screenSizes);
    const userStream = await getUserMedia(includeMicrophone, includeCamera);

    screenStreamRef.current = displayStream;
    userStreamRef.current = userStream;

    let videoSource: MediaStream = displayStream;

    if (includeCamera && userStream && cameraVideoRef.current && screenVideoRef.current) {
      const cameraTrack = userStream.getVideoTracks()[0];
      if (cameraTrack) {
        const cameraSettings = cameraTrack.getSettings();
        const [cameraWidth, cameraHeight] = getCameraImageSizes(
          cameraSettings,
          screenSizes.width,
          screenSizes.height,
        );

        const container = canvasContainerRef.current ?? document.body;
        videoMixerRef.current = new VideoStreamMixer({
          container,
          firstStream: {
            stream: displayStream,
            videoElement: screenVideoRef.current,
            width: screenSizes.width,
            height: screenSizes.height,
          },
          secondStream: {
            stream: userStream,
            videoElement: cameraVideoRef.current,
            width: cameraWidth,
            height: cameraHeight,
            left: screenSizes.width - cameraWidth - 32,
            top: screenSizes.height - cameraHeight - 32,
          },
          sizes: screenSizes,
          previewClassName: 'previewCanvas',
        });
        videoMixerRef.current.init();
        const mixed = videoMixerRef.current.getVideoStream();
        if (mixed) {
          videoSource = mixed;
        }
      }
    }

    const composedStream = new MediaStream();
    addTracksToStream(videoSource.getVideoTracks(), composedStream);

    if (displayStream.getAudioTracks().length > 0) {
      audioMixerRef.current = new AudioStreamMixer({
        systemAudioStream: displayStream,
        userAudioStream: userStream,
      });
      audioMixerRef.current.start();
      const audioStream = audioMixerRef.current.getAudioStream();
      if (audioStream) {
        addTracksToStream(audioStream.getAudioTracks(), composedStream);
      }
    } else if (userStream) {
      addTracksToStream(userStream.getAudioTracks(), composedStream);
    }

    composedStreamRef.current = composedStream;
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = composedStream;
      previewVideoRef.current.muted = true;
      previewVideoRef.current.playsInline = true;
      await previewVideoRef.current.play().catch(() => undefined);
    }
  };

  const createPeerConnection = (viewerId: string) => {
    const stream = composedStreamRef.current;
    if (!stream) {
      throw new Error('Нет доступного медиапотока для трансляции');
    }

    const connection = new RTCPeerConnection({ iceServers });
    stream.getTracks().forEach((track) => connection.addTrack(track, stream));

    connection.onicecandidate = (event) => {
      if (!event.candidate || !signalingRef.current) {
        return;
      }
      const candidate: SignalEnvelope = {
        kind: 'candidate',
        candidate: event.candidate.toJSON(),
      };
      signalingRef.current.send('signal', {
        roomId,
        targetClientId: viewerId,
        signal: candidate,
      });
    };

    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      console.log('[stream-host] Состояние соединения', { viewerId, state });
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        closePeerConnection(viewerId);
        setViewerIds((prev) => prev.filter((id) => id !== viewerId));
      }
    };

    peerConnectionsRef.current.set(viewerId, connection);
    return connection;
  };

  const createOfferForViewer = async (viewerId: string) => {
    if (!signalingRef.current) {
      console.warn('[stream-host] Нет сигналинга для отправки оффера');
      return;
    }
    const connection = createPeerConnection(viewerId);
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);

    const signal: SignalEnvelope = {
      kind: 'description',
      description: offer,
    };

    signalingRef.current.send('signal', {
      roomId,
      targetClientId: viewerId,
      signal,
    });
  };

  const startStreaming = async () => {
    if (isStreaming) {
      return;
    }
    setIsLoading(true);
    try {
      await createBaseStream();
      await ensureSignaling();
      signalingRef.current?.send('join-room', {
        roomId,
        mode: 'stream',
        role: STREAM_ROLE_HOST,
      });
      setIsStreaming(true);
      messageApi.success('Трансляция запущена. Поделитесь ссылкой со зрителями.');
    } catch (error) {
      console.error('[stream-host] Не удалось запустить трансляцию', error);
      messageApi.error('Не удалось запустить трансляцию. Проверьте разрешения и попробуйте ещё раз.');
      cleanupStreams();
    } finally {
      setIsLoading(false);
    }
  };

  const stopStreaming = () => {
    if (!isStreaming) {
      return;
    }
    signalingRef.current?.send('leave-room', {});
    stopAllPeerConnections();
    cleanupStreams();
    setViewerIds([]);
    setIsStreaming(false);
    messageApi.info('Трансляция остановлена.');
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      messageApi.success('Ссылка скопирована в буфер обмена');
    } catch (error) {
      console.error('Не удалось скопировать ссылку', error);
      messageApi.warning('Не удалось скопировать ссылку автоматически. Скопируйте вручную.');
    }
  };

  useEffect(() => {
    return () => {
      stopStreaming();
      detachSignalingListeners();
      signalingRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card className="section-card" bordered={false}>
      {contextHolder}
      <Space direction="vertical" size="large" className="full-width">
        <div className="stack-gap">
          <div>
            <Typography.Title level={4}>Я транслирую экран</Typography.Title>
            <Typography.Paragraph className="card-description">
              Получите ссылку для зрителей и выберите, что нужно транслировать. Зрители смогут
              подключиться из браузера, введя ссылку или номер комнаты.
            </Typography.Paragraph>
          </div>
          <Space direction="vertical" size={12} className="full-width">
            <Typography.Text strong>Идентификатор комнаты</Typography.Text>
            <Space.Compact className="full-width">
              <Input
                value={roomId}
                disabled={isStreaming}
                onChange={(event) => setRoomId(event.target.value.toUpperCase())}
              />
              <Tooltip title="Сгенерировать новый идентификатор">
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => setRoomId(generateRoomId())}
                  disabled={isStreaming}
                />
              </Tooltip>
            </Space.Compact>
          </Space>
          <Space direction="vertical" size={12}>
            <Typography.Text strong>Ссылка для зрителей</Typography.Text>
            <Space>
              <Typography.Text className="link-copy">{shareLink}</Typography.Text>
              <Button icon={<CopyOutlined />} onClick={copyLink} />
            </Space>
          </Space>
          <div>
            <Typography.Text strong>Что включить в трансляцию</Typography.Text>
            <Space size={[12, 12]} wrap style={{ marginTop: 12 }}>
              <Checkbox
                checked={includeSystemAudio}
                onChange={(event) => setIncludeSystemAudio(event.target.checked)}
                disabled={isStreaming}
              >
                Системный звук
              </Checkbox>
              <Checkbox
                checked={includeMicrophone}
                onChange={(event) => setIncludeMicrophone(event.target.checked)}
                disabled={isStreaming}
              >
                Микрофон
              </Checkbox>
              <Checkbox
                checked={includeCamera}
                onChange={(event) => setIncludeCamera(event.target.checked)}
                disabled={isStreaming}
              >
                Камера поверх экрана
              </Checkbox>
            </Space>
          </div>
        </div>

        <div className="video-preview">
          <video ref={previewVideoRef} autoPlay muted playsInline controls={false} />
          <div ref={canvasContainerRef} />
          <video ref={screenVideoRef} className="hidden-video" muted playsInline />
          <video ref={cameraVideoRef} className="hidden-video" muted playsInline />
        </div>

        <Space size="middle" wrap>
          <Button
            type="primary"
            onClick={startStreaming}
            loading={isLoading}
            disabled={isStreaming}
          >
            Запустить трансляцию
          </Button>
          <Button danger onClick={stopStreaming} disabled={!isStreaming}>
            Остановить
          </Button>
          <Tag icon={<UserSwitchOutlined />} color="blue">
            Зрителей: {viewerIds.length}
          </Tag>
          {isStreaming && <Tag color="processing">Трансляция идёт</Tag>}
        </Space>

        {viewerIds.length === 0 && isStreaming && (
          <Alert
            type="info"
            showIcon
            message="Ожидаем подключение зрителей"
            description="Когда кто-то откроет ссылку, вы увидите количество подключённых пользователей."
          />
        )}
      </Space>
    </Card>
  );
};
