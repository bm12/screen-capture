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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { generateRoomId } from '../../lib/constants';
import { createPeerConnection as createRtcPeerConnection } from '../../lib/peerConnection';
import type { SignalEnvelope } from '../../lib/types';
import { useSignalingRoom } from '../../lib/useSignalingRoom';

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

  const sendSignalRef = useRef<(targetClientId: string, signal: SignalEnvelope) => void>(() => {
    throw new Error('Сигнальное соединение ещё не готово.');
  });
  const screenStreamRef = useRef<MediaStream | null>(null);
  const userStreamRef = useRef<MediaStream | null>(null);
  const composedStreamRef = useRef<MediaStream | null>(null);
  const audioMixerRef = useRef<AudioStreamMixer | null>(null);
  const videoMixerRef = useRef<VideoStreamMixer | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingConnectionsRef = useRef<Map<string, Promise<RTCPeerConnection>>>(new Map());

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const isUnmountedRef = useRef(false);

  const shareLink = useMemo(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    return `${window.location.origin}/stream/${roomId}`;
  }, [roomId]);

  const closePeerConnection = useCallback((viewerId: string) => {
    const connection = peerConnectionsRef.current.get(viewerId);
    if (connection) {
      connection.onicecandidate = null;
      connection.ontrack = null;
      connection.close();
      peerConnectionsRef.current.delete(viewerId);
    }
    pendingConnectionsRef.current.delete(viewerId);
  }, []);

  const stopAllPeerConnections = useCallback(() => {
    peerConnectionsRef.current.forEach((connection) => {
      connection.onicecandidate = null;
      connection.ontrack = null;
      connection.close();
    });
    peerConnectionsRef.current.clear();
    pendingConnectionsRef.current.clear();
  }, []);

  const cleanupStreams = useCallback(() => {
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
  }, []);

  const createBaseStream = useCallback(async () => {
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
  }, [includeCamera, includeMicrophone, includeSystemAudio]);

  const createPeerConnection = useCallback(
    async (viewerId: string) => {
      const existing = peerConnectionsRef.current.get(viewerId);
      if (existing) {
        return existing;
      }

      const pending = pendingConnectionsRef.current.get(viewerId);
      if (pending) {
        return pending;
      }

      const stream = composedStreamRef.current;
      if (!stream) {
        throw new Error('Нет доступного медиапотока для трансляции');
      }

      const connectionPromise = (async () => {
        try {
          const connection = await createRtcPeerConnection({ uid: viewerId });
          stream.getTracks().forEach((track) => connection.addTrack(track, stream));

          connection.onicecandidate = (event) => {
            if (!event.candidate) {
              return;
            }
            const candidate: SignalEnvelope = {
              kind: 'candidate',
              candidate: event.candidate.toJSON(),
            };
            try {
              sendSignalRef.current(viewerId, candidate);
            } catch (error) {
              console.error('[stream-host] Не удалось отправить ICE-кандидата зрителю', error);
            }
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
        } catch (error) {
          console.error('[stream-host] Не удалось создать WebRTC соединение', {
            viewerId,
            error,
          });
          if (!isUnmountedRef.current) {
            messageApi.error('Не удалось установить соединение со зрителем. Попробуйте ещё раз.');
          }
          throw error;
        } finally {
          pendingConnectionsRef.current.delete(viewerId);
        }
      })();

      pendingConnectionsRef.current.set(viewerId, connectionPromise);
      return connectionPromise;
    },
    [closePeerConnection, isUnmountedRef, messageApi, setViewerIds],
  );

  const createOfferForViewer = useCallback(
    async (viewerId: string) => {
      const connection = await createPeerConnection(viewerId).catch((error) => {
        console.error('[stream-host] Не удалось подготовить соединение для зрителя', {
          viewerId,
          error,
        });
        return null;
      });
      if (!connection) {
        return;
      }
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);

      const signal: SignalEnvelope = {
        kind: 'description',
        description: offer,
      };

      try {
        sendSignalRef.current(viewerId, signal);
      } catch (error) {
        console.error('[stream-host] Не удалось отправить оффер зрителю', error);
      }
    },
    [createPeerConnection],
  );

  const { joinRoom, leaveRoom, sendSignal } = useSignalingRoom({
    roomId,
    mode: 'stream',
    role: STREAM_ROLE_HOST,
    onRoomJoined: async (payload) => {
      console.log('[stream-host] Подключены к комнате', payload);
      const currentViewers = payload.participants
        .filter((participant) => participant.role === STREAM_ROLE_VIEWER)
        .map((participant) => participant.clientId);
      if (!isUnmountedRef.current) {
        setViewerIds(currentViewers);
      }
      for (const viewerId of currentViewers) {
        await createOfferForViewer(viewerId);
      }
    },
    onPeerJoined: async (payload) => {
      console.log('[stream-host] К комнате подключился участник', payload);
      if (payload.role !== STREAM_ROLE_VIEWER) {
        return;
      }
      setViewerIds((prev) => Array.from(new Set([...prev, payload.clientId])));
      await createOfferForViewer(payload.clientId);
    },
    onPeerLeft: async (payload) => {
      console.log('[stream-host] Участник покинул комнату', payload);
      if (payload.clientId) {
        closePeerConnection(payload.clientId);
        setViewerIds((prev) => prev.filter((id) => id !== payload.clientId));
      }
    },
    onSignal: async (payload) => {
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
    },
    onError: async (payload) => {
      console.error('[stream-host] Ошибка сигналинга', payload);
      messageApi.error('Ошибка сигналинга. Попробуйте перезапустить трансляцию.');
    },
    onClose: async () => {
      console.warn('[stream-host] Сигнальное соединение закрыто');
      stopAllPeerConnections();
      if (!isUnmountedRef.current) {
        setViewerIds([]);
        messageApi.warning('Соединение сигналинга потеряно. Пытаемся переподключиться…');
      }
    },
    onReconnected: async () => {
      console.log('[stream-host] Сигналинг переподключился');
      if (!isUnmountedRef.current) {
        messageApi.info('Сигналинг восстановлен. Переподключаем зрителей…');
      }
    },
    onReconnectionFailed: async (error) => {
      console.error('[stream-host] Не удалось переподключиться к сигналингу', error);
      messageApi.error('Не удалось восстановить сигналинг. Попробуйте перезапустить трансляцию.');
    },
  });

  sendSignalRef.current = sendSignal;

  const startStreaming = useCallback(async () => {
    if (isStreaming) {
      return;
    }
    setIsLoading(true);
    try {
      await createBaseStream();
      console.log('[stream-host] Отправляем запрос на присоединение к комнате', { roomId });
      await joinRoom();
      setIsStreaming(true);
      messageApi.success('Трансляция запущена. Поделитесь ссылкой со зрителями.');
    } catch (error) {
      console.error('[stream-host] Не удалось запустить трансляцию', error);
      messageApi.error('Не удалось запустить трансляцию. Проверьте разрешения и попробуйте ещё раз.');
      cleanupStreams();
    } finally {
      setIsLoading(false);
    }
  }, [createBaseStream, isStreaming, joinRoom, messageApi, roomId, cleanupStreams]);

  const stopStreaming = useCallback(() => {
    if (!isStreaming) {
      return;
    }
    leaveRoom();
    stopAllPeerConnections();
    cleanupStreams();
    setViewerIds([]);
    setIsStreaming(false);
    messageApi.info('Трансляция остановлена.');
  }, [cleanupStreams, isStreaming, leaveRoom, messageApi, stopAllPeerConnections]);

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
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      stopStreaming();
      leaveRoom({ close: true });
    };
  }, [leaveRoom, stopStreaming]);

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
