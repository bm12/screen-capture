import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { MessageInstance } from 'antd/es/message/interface';

import { iceServers } from '../../../lib/constants';
import type { SignalEnvelope } from '../../../lib/types';
import { useSignalingRoom } from '../../../lib/useSignalingRoom';

const CALL_ROLE = 'participant';

export type RemoteParticipant = {
  id: string;
  stream: MediaStream;
};

type UseCallPeersOptions = {
  roomId: string;
  messageApi: MessageInstance;
  localStreamRef: MutableRefObject<MediaStream | null>;
  registerStreamUpdateHandler: (handler: (stream: MediaStream) => void) => () => void;
  registerVideoTrackSwitchHandler: (handler: (track: MediaStreamTrack) => void) => () => void;
};

export const useCallPeers = ({
  roomId,
  messageApi,
  localStreamRef,
  registerStreamUpdateHandler,
  registerVideoTrackSwitchHandler,
}: UseCallPeersOptions) => {
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([]);
  const [status, setStatus] = useState<string>('Соединение устанавливается…');

  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const sendSignalRef = useRef<(targetClientId: string, signal: SignalEnvelope) => void>(() => {
    throw new Error('Сигнальное соединение ещё не готово.');
  });
  const isUnmountedRef = useRef(false);

  const removeParticipant = useCallback((participantId: string | null | undefined) => {
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
  }, []);

  const updatePeerSenders = useCallback((stream: MediaStream) => {
    peerConnectionsRef.current.forEach((connection, participantId) => {
      stream.getTracks().forEach((track) => {
        const sender = connection
          .getSenders()
          .find((connectionSender) => connectionSender.track?.kind === track.kind);
        if (sender) {
          sender
            .replaceTrack(track)
            .catch((error) =>
              console.error('[call] Не удалось заменить трек при рассылке', { participantId, error }),
            );
        }
      });
    });
  }, []);

  const replaceVideoTrack = useCallback((track: MediaStreamTrack) => {
    peerConnectionsRef.current.forEach((connection) => {
      const sender = connection
        .getSenders()
        .find((connectionSender) => connectionSender.track?.kind === 'video');
      sender?.replaceTrack(track).catch((error) => console.error('[call] Ошибка при замене видеодорожки', error));
    });
  }, []);

  useEffect(() => registerStreamUpdateHandler(updatePeerSenders), [registerStreamUpdateHandler, updatePeerSenders]);
  useEffect(
    () => registerVideoTrackSwitchHandler(replaceVideoTrack),
    [registerVideoTrackSwitchHandler, replaceVideoTrack],
  );

  const getOrCreateConnection = useCallback(
    (participantId: string) => {
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
        if (!event.candidate) {
          return;
        }
        const signal: SignalEnvelope = {
          kind: 'candidate',
          candidate: event.candidate.toJSON(),
        };
        try {
          sendSignalRef.current(participantId, signal);
        } catch (error) {
          console.error('[call] Не удалось отправить ICE-кандидата', error);
        }
      };

      connection.onconnectionstatechange = () => {
        const state = connection.connectionState;
        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          removeParticipant(participantId);
        }
      };

      peerConnectionsRef.current.set(participantId, connection);
      return connection;
    },
    [localStreamRef, removeParticipant],
  );

  const createOffer = useCallback(
    async (participantId: string) => {
      const connection = getOrCreateConnection(participantId);
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      const signal: SignalEnvelope = {
        kind: 'description',
        description: offer,
      };
      try {
        sendSignalRef.current(participantId, signal);
      } catch (error) {
        console.error('[call] Не удалось отправить оффер участнику', error);
      }
    },
    [getOrCreateConnection],
  );

  const handleIncomingOffer = useCallback(
    async (participantId: string, description: RTCSessionDescriptionInit) => {
      const connection = getOrCreateConnection(participantId);
      await connection.setRemoteDescription(description);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      const signal: SignalEnvelope = {
        kind: 'description',
        description: answer,
      };
      try {
        sendSignalRef.current(participantId, signal);
      } catch (error) {
        console.error('[call] Не удалось отправить answer участнику', error);
      }
    },
    [getOrCreateConnection],
  );

  const { joinRoom: joinSignalRoom, leaveRoom: leaveSignalRoom, sendSignal } = useSignalingRoom({
    roomId,
    mode: 'call',
    role: CALL_ROLE,
    onRoomJoined: async (payload, context) => {
      console.log('[call] Успешно подключились к комнате', payload);
      if (!isUnmountedRef.current) {
        setStatus('Вы в комнате. Ждём других участников.');
      }
      for (const participant of payload.participants) {
        if (participant.clientId === context.selfId) {
          continue;
        }
        await createOffer(participant.clientId);
      }
    },
    onPeerJoined: async (payload, context) => {
      if (payload.clientId === context.selfId) {
        return;
      }
      console.log('[call] К комнате подключился участник', payload);
      if (!isUnmountedRef.current) {
        setStatus(`К комнате подключился новый участник (${payload.clientId.slice(0, 6)}).`);
      }
    },
    onPeerLeft: async (payload) => {
      console.log('[call] Участник покинул комнату', payload);
      removeParticipant(payload.clientId);
    },
    onSignal: async (payload, context) => {
      if (!payload || payload.senderId === context.selfId) {
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
    },
    onError: async (payload) => {
      console.error('[call] Ошибка сигналинга', payload);
      messageApi.error('Произошла ошибка сигналинга. Попробуйте переподключиться.');
    },
    onClose: async () => {
      console.warn('[call] Сигнальное соединение закрыто. Попробуем переподключиться.');
      peerConnectionsRef.current.forEach((connection) => connection.close());
      peerConnectionsRef.current.clear();
      if (!isUnmountedRef.current) {
        setStatus('Соединение потеряно. Пытаемся переподключиться…');
        setRemoteParticipants([]);
      }
    },
    onReconnected: async () => {
      console.log('[call] Сигналинг переподключился. Повторный вход в комнату.');
      if (!isUnmountedRef.current) {
        setStatus('Соединение восстановлено. Переподключаемся к комнате…');
      }
    },
    onReconnectionFailed: async (error) => {
      console.error('[call] Ошибка при повторном подключении к комнате', error);
      messageApi.error('Не удалось переподключиться к звонку. Попробуйте обновить страницу.');
    },
  });

  sendSignalRef.current = sendSignal;

  const joinRoom = useCallback(async () => {
    setStatus('Подключаемся к комнате…');
    await joinSignalRoom();
  }, [joinSignalRoom]);

  const leaveRoom = useCallback(
    async (options?: { close?: boolean }) => {
      await leaveSignalRoom(options);
      peerConnectionsRef.current.forEach((connection) => connection.close());
      peerConnectionsRef.current.clear();
      if (!isUnmountedRef.current) {
        setRemoteParticipants([]);
        setStatus('Вы покинули комнату.');
      }
    },
    [leaveSignalRoom],
  );

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
    };
  }, []);

  return {
    remoteParticipants,
    status,
    setStatus,
    joinRoom,
    leaveRoom,
    sendSignal,
  };
};
