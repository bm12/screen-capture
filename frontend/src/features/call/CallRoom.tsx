import {
  Alert,
  Button,
  Card,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  AudioMutedOutlined,
  AudioOutlined,
  CopyOutlined,
  RetweetOutlined,
  TeamOutlined,
  VideoCameraAddOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SignalingClient } from '../../lib/signalingClient';
import { iceServers } from '../../lib/constants';
import type {
  PeerUpdatePayload,
  RoomJoinedPayload,
  SignalEnvelope,
  SignalMessagePayload,
} from '../../lib/types';

const CALL_ROLE = 'participant';

const guessFacingMode = (device?: MediaDeviceInfo | null): 'user' | 'environment' | null => {
  if (!device?.label) {
    return null;
  }
  const label = device.label.toLowerCase();
  if (label.includes('back') || label.includes('rear') || label.includes('environment') || label.includes('задн')) {
    return 'environment';
  }
  if (label.includes('front') || label.includes('user') || label.includes('face') || label.includes('фронт') || label.includes('лицев')) {
    return 'user';
  }
  return null;
};

const buildVideoConstraints = (
  deviceId?: string | null,
  facingMode?: 'user' | 'environment' | null,
): MediaTrackConstraints => {
  if (deviceId) {
    return { deviceId: { exact: deviceId } };
  }
  if (facingMode) {
    return { facingMode: { exact: facingMode } };
  }
  return { facingMode: 'user' };
};

type CallRoomProps = {
  roomId: string;
};

type RemoteParticipant = {
  id: string;
  stream: MediaStream;
};

export const CallRoom = ({ roomId }: CallRoomProps) => {
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCameraEnabled, setIsCameraEnabled] = useState(true);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeVideoDeviceId, setActiveVideoDeviceId] = useState<string | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([]);
  const [status, setStatus] = useState<string>('Соединение устанавливается…');
  const [messageApi, contextHolder] = message.useMessage();

  const signalingRef = useRef<SignalingClient | null>(null);
  const subscriptionsRef = useRef<(() => void)[]>([]);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const desiredFacingModeRef = useRef<'user' | 'environment' | null>(null);
  const isUnmountedRef = useRef(false);

  const shareLink = useMemo(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    return `${window.location.origin}/call/${roomId}`;
  }, [roomId]);

  const updatePeerSenders = useCallback((stream: MediaStream) => {
    peerConnectionsRef.current.forEach((connection, participantId) => {
      stream.getTracks().forEach((track) => {
        const sender = connection
          .getSenders()
          .find((connectionSender) => connectionSender.track?.kind === track.kind);
        if (sender) {
          sender
            .replaceTrack(track)
            .catch((error) => console.error('[call] Не удалось заменить трек при рассылке', { participantId, error }));
        }
      });
    });
  }, []);

  const applyLocalStream = useCallback(
    async (stream: MediaStream, options: { micEnabled?: boolean; cameraEnabled?: boolean } = {}) => {
      console.log('[call] Применяем локальный поток', {
        audioTracks: stream.getAudioTracks().length,
        videoTracks: stream.getVideoTracks().length,
      });

    const previousStream = localStreamRef.current;
    const { micEnabled, cameraEnabled } = options;

    if (typeof micEnabled === 'boolean') {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = micEnabled;
      });
    }

    if (typeof cameraEnabled === 'boolean') {
      stream.getVideoTracks().forEach((track) => {
        track.enabled = cameraEnabled;
      });
    }

    localStreamRef.current = stream;

    const audioTracks = stream.getAudioTracks();
    if (!isUnmountedRef.current) {
      setIsMicEnabled(audioTracks.some((track) => track.enabled));
    }

    const videoTrack = stream.getVideoTracks()[0] ?? null;
    if (!isUnmountedRef.current) {
      setIsCameraEnabled(Boolean(videoTrack?.enabled));
      setActiveVideoDeviceId(videoTrack?.getSettings().deviceId ?? null);
    }

    const facingMode = videoTrack?.getSettings().facingMode;
    if (facingMode === 'environment' || facingMode === 'user') {
      desiredFacingModeRef.current = facingMode;
    }

    stream.getTracks().forEach((track) => {
      track.onended = () => {
        console.warn(`[call] Локальный трек ${track.kind} остановлен браузером`, {
          readyState: track.readyState,
        });
      };
    });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true;
        await localVideoRef.current.play().catch(() => undefined);
      }

      previousStream?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((device) => device.kind === 'videoinput');
      setVideoDevices(videoInputs);
      setActiveVideoDeviceId((current) => current ?? videoInputs[0]?.deviceId ?? null);
    } catch (error) {
      console.error('[call] Не удалось получить список устройств', error);
    }
  }, []);

  const restartLocalStream = useCallback(async () => {
    const currentStream = localStreamRef.current;
    const hasAudioTrack = Boolean(currentStream?.getAudioTracks().length);
    const hasVideoTrack = Boolean(currentStream?.getVideoTracks().length);
    const needAudio = hasAudioTrack || isMicEnabled;
    const needVideo = hasVideoTrack || isCameraEnabled;

    if (!needAudio && !needVideo) {
      console.log('[call] Пропускаем восстановление потоков: нет активных дорожек');
      return;
    }

    const videoConstraints = needVideo
      ? buildVideoConstraints(activeVideoDeviceId, desiredFacingModeRef.current)
      : false;
    const audioConstraints = needAudio
      ? {
          echoCancellation: true,
          noiseSuppression: true,
        }
      : false;

    try {
      console.log('[call] Переинициализация локального потока', {
        needAudio,
        needVideo,
        videoConstraints,
      });
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: videoConstraints,
      });
      await applyLocalStream(newStream, { micEnabled: isMicEnabled, cameraEnabled: isCameraEnabled });
      updatePeerSenders(newStream);
      await refreshDevices();
    } catch (error) {
      console.error('[call] Не удалось восстановить локальные устройства', error);
      messageApi.error('Не удалось заново получить доступ к камере или микрофону.');
    }
  }, [activeVideoDeviceId, applyLocalStream, isCameraEnabled, isMicEnabled, messageApi, refreshDevices, updatePeerSenders]);

  const attachListeners = (client: SignalingClient) => {
    const roomJoined = client.on<RoomJoinedPayload>('room-joined', async (payload) => {
      selfIdRef.current = client.getClientId();
      console.log('[call] Успешно подключились к комнате', payload);
      setStatus('Вы в комнате. Ждём других участников.');
      for (const participant of payload.participants) {
        await createOffer(participant.clientId);
      }
    });

    const peerJoined = client.on<PeerUpdatePayload>('peer-joined', async (payload) => {
      if (payload.clientId === selfIdRef.current) {
        return;
      }
      console.log('[call] К комнате подключился участник', payload);
      setStatus(`К комнате подключился новый участник (${payload.clientId.slice(0, 6)}).`);
    });

    const peerLeft = client.on<PeerUpdatePayload>('peer-left', (payload) => {
      console.log('[call] Участник покинул комнату', payload);
      removeParticipant(payload.clientId);
    });

    const signalListener = client.on<SignalMessagePayload>('signal', async (payload) => {
      if (!payload || payload.senderId === selfIdRef.current) {
        return;
      }

      console.log('[call] Получен сигнал от участника', payload);
      const { senderId, signal } = payload;
      if (signal.kind === 'description') {
        if (signal.description.type === 'offer') {
          await handleIncomingOffer(senderId, signal.description);
        }
        if (signal.description.type === 'answer') {
          await peerConnectionsRef.current.get(senderId)?.setRemoteDescription(signal.description);
        }
      } else if (signal.kind === 'candidate') {
        await peerConnectionsRef.current
          .get(senderId)
          ?.addIceCandidate(signal.candidate)
          .catch((error) => console.error('[call] Ошибка при добавлении ICE-кандидата', error));
      }
    });

    const errorListener = client.on('error', (payload) => {
      console.error('[call] Ошибка сигналинга', payload);
      messageApi.error('Произошла ошибка сигналинга. Попробуйте переподключиться.');
    });

    const closeListener = client.on('close', () => {
      console.warn('[call] Сигнальное соединение закрыто. Попробуем переподключиться.');
      selfIdRef.current = null;
      setStatus('Соединение потеряно. Пытаемся переподключиться…');
      peerConnectionsRef.current.forEach((connection) => connection.close());
      peerConnectionsRef.current.clear();
      setRemoteParticipants([]);
    });

    const reconnectedListener = client.on('reconnected', async () => {
      console.log('[call] Сигналинг переподключился. Повторный вход в комнату.');
      setStatus('Соединение восстановлено. Переподключаемся к комнате…');
      try {
        await joinRoom();
      } catch (error) {
        console.error('[call] Ошибка при повторном подключении к комнате', error);
        messageApi.error('Не удалось переподключиться к звонку. Попробуйте обновить страницу.');
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

  const joinRoom = async () => {
    const client = await ensureSignaling();
    console.log('[call] Отправляем запрос на присоединение к комнате', { roomId });
    client.send('join-room', { roomId, mode: 'call', role: CALL_ROLE });
  };

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[call] Страница снова активна. Проверяем состояние локальных треков.');
        const stream = localStreamRef.current;
        const audioTracks = stream?.getAudioTracks() ?? [];
        const videoTracks = stream?.getVideoTracks() ?? [];
        const audioLive = audioTracks.some((track) => track.readyState === 'live');
        const videoLive = videoTracks.length === 0 || videoTracks.some((track) => track.readyState === 'live');
        if (!audioLive || !videoLive) {
          restartLocalStream().catch((error) =>
            console.error('[call] Ошибка при восстановлении потоков после возвращения на вкладку', error),
          );
        }
      } else {
        console.log('[call] Страница скрыта. Камера и микрофон могут быть приостановлены браузером.');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [restartLocalStream]);

  const setupLocalStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: 'user' },
      });
      await applyLocalStream(stream);
    } catch (error) {
      console.error('[call] Не удалось получить доступ к камере', error);
      const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      await applyLocalStream(audioOnly, { cameraEnabled: false });
      desiredFacingModeRef.current = null;
      messageApi.warning('Камера недоступна. Подключаемся только с микрофоном.');
    }

    await refreshDevices();
  };

  const getOrCreateConnection = (participantId: string) => {
    const existing = peerConnectionsRef.current.get(participantId);
    if (existing) {
      return existing;
    }

    const localStream = localStreamRef.current;
    const connection = new RTCPeerConnection({ iceServers });
    if (localStream) {
      localStream.getTracks().forEach((track) => connection.addTrack(track, localStream));
    }

    connection.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (!remoteStream) {
        return;
      }
      setRemoteParticipants((prev) => {
        const others = prev.filter((participant) => participant.id !== participantId);
        return [...others, { id: participantId, stream: remoteStream }];
      });
    };

    connection.onicecandidate = (event) => {
      if (!event.candidate || !signalingRef.current) {
        return;
      }
      const signal: SignalEnvelope = {
        kind: 'candidate',
        candidate: event.candidate.toJSON(),
      };
      signalingRef.current.send('signal', {
        roomId,
        targetClientId: participantId,
        signal,
      });
    };

    connection.onconnectionstatechange = () => {
      const state = connection.connectionState;
      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        removeParticipant(participantId);
      }
    };

    peerConnectionsRef.current.set(participantId, connection);
    return connection;
  };

  const createOffer = async (participantId: string) => {
    if (participantId === selfIdRef.current) {
      return;
    }
    const connection = getOrCreateConnection(participantId);
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    signalingRef.current?.send('signal', {
      roomId,
      targetClientId: participantId,
      signal: {
        kind: 'description',
        description: offer,
      },
    });
  };

  const handleIncomingOffer = async (
    participantId: string,
    description: RTCSessionDescriptionInit,
  ) => {
    const connection = getOrCreateConnection(participantId);
    await connection.setRemoteDescription(description);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    signalingRef.current?.send('signal', {
      roomId,
      targetClientId: participantId,
      signal: {
        kind: 'description',
        description: answer,
      },
    });
  };

  const removeParticipant = (participantId: string | null | undefined) => {
    if (!participantId) {
      return;
    }
    const connection = peerConnectionsRef.current.get(participantId);
    if (connection) {
      connection.onicecandidate = null;
      connection.ontrack = null;
      connection.close();
      peerConnectionsRef.current.delete(participantId);
    }
    setRemoteParticipants((prev) => prev.filter((participant) => participant.id !== participantId));
  };

  const toggleMicrophone = () => {
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }
    stream.getAudioTracks().forEach((track, index) => {
      track.enabled = !track.enabled;
      setIsMicEnabled(track.enabled);
      if (index === 0) {
        console.log('[call] Состояние микрофона изменено', { enabled: track.enabled });
      }
    });
  };

  const toggleCamera = () => {
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length === 0) {
      messageApi.warning('Камера неактивна или недоступна.');
      return;
    }
    videoTracks.forEach((track, index) => {
      track.enabled = !track.enabled;
      setIsCameraEnabled(track.enabled);
      if (index === 0) {
        console.log('[call] Состояние камеры изменено', { enabled: track.enabled });
      }
    });
  };

  const switchCamera = async () => {
    const attempts: {
      constraint: MediaTrackConstraints;
      deviceId?: string | null;
      facingMode?: 'user' | 'environment' | null;
    }[] = [];

    if (videoDevices.length > 0) {
      const currentIndex = videoDevices.findIndex((device) => device.deviceId === activeVideoDeviceId);
      const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % videoDevices.length;
      const nextDevice = videoDevices[nextIndex];
      const guessedFacingMode = guessFacingMode(nextDevice);
      if (nextDevice?.deviceId) {
        attempts.push({ constraint: { deviceId: { exact: nextDevice.deviceId } }, deviceId: nextDevice.deviceId, facingMode: guessedFacingMode });
      }
      if (guessedFacingMode) {
        attempts.push({
          constraint: { facingMode: { exact: guessedFacingMode } },
          deviceId: nextDevice?.deviceId ?? null,
          facingMode: guessedFacingMode,
        });
      }
    }

    if (attempts.length === 0) {
      const fallbackFacing = desiredFacingModeRef.current === 'environment' ? 'user' : 'environment';
      attempts.push({ constraint: { facingMode: { exact: fallbackFacing } }, facingMode: fallbackFacing });
    }

    let newTrack: MediaStreamTrack | null = null;
    let appliedDeviceId: string | null = null;
    let appliedFacingMode: 'user' | 'environment' | null = null;
    let lastError: unknown = null;

    for (const attempt of attempts) {
      try {
        console.log('[call] Пробуем переключить камеру', attempt);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: attempt.constraint,
          audio: false,
        });
        const track = stream.getVideoTracks()[0] ?? null;
        if (!track) {
          stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
          continue;
        }
        newTrack = track;
        const trackSettings = track.getSettings();
        appliedDeviceId = trackSettings.deviceId ?? attempt.deviceId ?? null;
        const trackFacing = trackSettings.facingMode;
        if (trackFacing === 'user' || trackFacing === 'environment') {
          appliedFacingMode = trackFacing;
        } else if (attempt.facingMode) {
          appliedFacingMode = attempt.facingMode;
        }
        break;
      } catch (error) {
        lastError = error;
        console.warn('[call] Попытка переключения камеры завершилась неудачно', { attempt, error });
      }
    }

    if (!newTrack) {
      console.error('[call] Не удалось переключить камеру ни по одному сценарию', lastError);
      messageApi.error('Не удалось переключить камеру.');
      return;
    }

    const localStream = localStreamRef.current;
    if (!localStream) {
      messageApi.error('Локальный поток недоступен. Попробуйте переподключиться.');
      return;
    }

    const [oldTrack] = localStream.getVideoTracks();
    if (oldTrack) {
      oldTrack.stop();
      localStream.removeTrack(oldTrack);
    }

    newTrack.enabled = isCameraEnabled;
    localStream.addTrack(newTrack);
    desiredFacingModeRef.current = appliedFacingMode ?? desiredFacingModeRef.current;
    setActiveVideoDeviceId(appliedDeviceId);

    peerConnectionsRef.current.forEach((connection) => {
      const sender = connection
        .getSenders()
        .find((connectionSender) => connectionSender.track?.kind === 'video');
      sender
        ?.replaceTrack(newTrack)
        .catch((error) => console.error('[call] Ошибка при замене видеодорожки', error));
    });

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
      await localVideoRef.current.play().catch(() => undefined);
    }

    await refreshDevices();
    console.log('[call] Камера переключена', {
      deviceId: appliedDeviceId,
      facingMode: desiredFacingModeRef.current,
    });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      messageApi.success('Ссылка скопирована в буфер обмена.');
    } catch (error) {
      console.error('Не удалось скопировать ссылку', error);
      messageApi.warning('Скопируйте ссылку вручную.');
    }
  };

  useEffect(() => {
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
    };
  }, [refreshDevices]);

  useEffect(() => {
    const bootstrap = async () => {
      setStatus('Подключаемся к комнате…');
      await setupLocalStream();
      await joinRoom();
    };

    isUnmountedRef.current = false;

    bootstrap().catch((error) => {
      console.error('[call] Ошибка инициализации', error);
      messageApi.error('Не удалось подключиться к звонку. Попробуйте обновить страницу.');
    });

    const peerConnections = peerConnectionsRef.current;
    return () => {
      isUnmountedRef.current = true;
      peerConnections.forEach((connection) => connection.close());
      peerConnections.clear();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      detachListeners();
      signalingRef.current?.send('leave-room', {});
      signalingRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const participantsCount = remoteParticipants.length + 1;

  return (
    <Card className="section-card" bordered={false}>
      {contextHolder}
      <Space direction="vertical" size="large" className="full-width">
        <div>
          <Typography.Title level={3}>Комнатный звонок</Typography.Title>
          <Typography.Paragraph className="card-description">
            Поделитесь ссылкой со знакомыми. Каждый участник может включать и выключать микрофон и
            камеру, а также переключать доступные камеры.
          </Typography.Paragraph>
        </div>
        <Space align="center" wrap>
          <Typography.Text className="link-copy">{shareLink}</Typography.Text>
          <Button icon={<CopyOutlined />} onClick={copyLink}>
            Скопировать ссылку
          </Button>
        </Space>

        <div className="video-grid">
          <div className="video-grid__item">
            <video ref={localVideoRef} autoPlay playsInline muted className="video-grid__video" />
            <span className="video-grid__label">Вы</span>
          </div>
          {remoteParticipants.map((participant) => (
            <div key={participant.id} className="video-grid__item">
              <video
                autoPlay
                playsInline
                ref={(element) => {
                  if (element) {
                    element.srcObject = participant.stream;
                    element.play().catch(() => undefined);
                  }
                }}
              />
              <span className="video-grid__label">{participant.id.slice(0, 6)}</span>
            </div>
          ))}
        </div>

        <Space size="middle" wrap>
          <Tooltip title={isMicEnabled ? 'Выключить микрофон' : 'Включить микрофон'}>
            <Button
              icon={isMicEnabled ? <AudioOutlined /> : <AudioMutedOutlined />}
              onClick={toggleMicrophone}
              type={isMicEnabled ? 'default' : 'primary'}
              danger={!isMicEnabled}
            />
          </Tooltip>
          <Tooltip title={isCameraEnabled ? 'Выключить камеру' : 'Включить камеру'}>
            <Button
              icon={isCameraEnabled ? <VideoCameraOutlined /> : <VideoCameraAddOutlined />}
              onClick={toggleCamera}
              type={isCameraEnabled ? 'default' : 'primary'}
              danger={!isCameraEnabled}
            />
          </Tooltip>
          <Tooltip title="Переключить камеру">
            <Button icon={<RetweetOutlined />} onClick={switchCamera} disabled={videoDevices.length === 0}>
              Сменить камеру
            </Button>
          </Tooltip>
          <Tag icon={<TeamOutlined />} color="blue">
            Участников: {participantsCount}
          </Tag>
        </Space>

        <Alert type="info" showIcon message={status} />
      </Space>
    </Card>
  );
};
