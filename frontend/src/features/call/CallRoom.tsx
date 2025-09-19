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

  const shareLink = useMemo(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    return `${window.location.origin}/call/${roomId}`;
  }, [roomId]);

  const attachListeners = (client: SignalingClient) => {
    const roomJoined = client.on<RoomJoinedPayload>('room-joined', async (payload) => {
      selfIdRef.current = client.getClientId();
      setStatus('Вы в комнате. Ждём других участников.');
      for (const participant of payload.participants) {
        await createOffer(participant.clientId);
      }
    });

    const peerJoined = client.on<PeerUpdatePayload>('peer-joined', async (payload) => {
      if (payload.clientId === selfIdRef.current) {
        return;
      }
      setStatus(`К комнате подключился новый участник (${payload.clientId.slice(0, 6)}).`);
    });

    const peerLeft = client.on<PeerUpdatePayload>('peer-left', (payload) => {
      removeParticipant(payload.clientId);
    });

    const signalListener = client.on<SignalMessagePayload>('signal', async (payload) => {
      if (!payload || payload.senderId === selfIdRef.current) {
        return;
      }
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

  const setupLocalStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: 'user' },
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true;
        await localVideoRef.current.play().catch(() => undefined);
      }
      setIsMicEnabled(stream.getAudioTracks().some((track) => track.enabled));
      const videoTrack = stream.getVideoTracks()[0];
      setIsCameraEnabled(Boolean(videoTrack?.enabled));
      setActiveVideoDeviceId(videoTrack?.getSettings().deviceId ?? null);
    } catch (error) {
      console.error('[call] Не удалось получить доступ к камере', error);
      const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = audioOnly;
      setIsCameraEnabled(false);
      setActiveVideoDeviceId(null);
      messageApi.warning('Камера недоступна. Подключаемся только с микрофоном.');
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = audioOnly;
        localVideoRef.current.muted = true;
        await localVideoRef.current.play().catch(() => undefined);
      }
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
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !track.enabled;
      setIsMicEnabled(track.enabled);
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
    videoTracks.forEach((track) => {
      track.enabled = !track.enabled;
      setIsCameraEnabled(track.enabled);
    });
  };

  const switchCamera = async () => {
    if (videoDevices.length < 2) {
      messageApi.info('Доступна только одна камера.');
      return;
    }
    const currentIndex = videoDevices.findIndex((device) => device.deviceId === activeVideoDeviceId);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % videoDevices.length;
    const nextDevice = videoDevices[nextIndex];

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: nextDevice.deviceId } },
      });
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) {
        return;
      }

      const localStream = localStreamRef.current;
      if (!localStream) {
        return;
      }

      const [oldTrack] = localStream.getVideoTracks();
      if (oldTrack) {
        oldTrack.stop();
        localStream.removeTrack(oldTrack);
      }
      newTrack.enabled = isCameraEnabled;
      localStream.addTrack(newTrack);
      setActiveVideoDeviceId(nextDevice.deviceId);

      peerConnectionsRef.current.forEach((connection) => {
        const sender = connection
          .getSenders()
          .find((connectionSender) => connectionSender.track?.kind === 'video');
        sender?.replaceTrack(newTrack);
      });

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStream;
        await localVideoRef.current.play().catch(() => undefined);
      }
    } catch (error) {
      console.error('[call] Не удалось переключить камеру', error);
      messageApi.error('Не удалось переключить камеру.');
    }
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
      await setupLocalStream();
      const client = await ensureSignaling();
      client.send('join-room', { roomId, mode: 'call', role: CALL_ROLE });
      setStatus('Подключаемся к комнате…');
    };

    bootstrap().catch((error) => {
      console.error('[call] Ошибка инициализации', error);
      messageApi.error('Не удалось подключиться к звонку. Попробуйте обновить страницу.');
    });

    const peerConnections = peerConnectionsRef.current;
    return () => {
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
            <Button icon={<RetweetOutlined />} onClick={switchCamera} disabled={videoDevices.length < 2}>
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
