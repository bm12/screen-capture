import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { MessageInstance } from 'antd/es/message/interface';

import { createPeerConnection as createRtcPeerConnection } from '../../../lib/peerConnection';
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
  const pendingConnectionsRef = useRef<Map<string, Promise<RTCPeerConnection>>>(new Map());
  const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
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
    pendingConnectionsRef.current.delete(participantId);
    pendingIceCandidatesRef.current.delete(participantId);
    setRemoteParticipants((prev) => prev.filter((participant) => participant.id !== participantId));
  }, []);

  const flushPendingIceCandidates = useCallback(
    async (participantId: string, connection: RTCPeerConnection | null | undefined) => {
      if (!connection) {
        return;
      }

      const pendingCandidates = pendingIceCandidatesRef.current.get(participantId);
      if (!pendingCandidates?.length) {
        return;
      }

      for (const candidate of pendingCandidates) {
        try {
          await connection.addIceCandidate(candidate);
        } catch (error) {
          console.error('[call] Ошибка при добавлении отложенного ICE-кандидата', error);
        }
      }

      pendingIceCandidatesRef.current.delete(participantId);
    },
    [],
  );

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
    async (participantId: string) => {
      const existing = peerConnectionsRef.current.get(participantId);
      if (existing) {
        return existing;
      }

      const pending = pendingConnectionsRef.current.get(participantId);
      if (pending) {
        return pending;
      }

      const localStream = localStreamRef.current;
      const connectionPromise = (async () => {
        try {
          const connection = await createRtcPeerConnection({ uid: participantId });

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
        } catch (error) {
          console.error('[call] Не удалось создать WebRTC-соединение', {
            participantId,
            error,
          });
          if (!isUnmountedRef.current) {
            messageApi.error('Не удалось установить соединение с участником. Попробуйте ещё раз.');
          }
          throw error;
        } finally {
          pendingConnectionsRef.current.delete(participantId);
        }
      })();

      pendingConnectionsRef.current.set(participantId, connectionPromise);
      return connectionPromise;
    },
    [localStreamRef, messageApi, removeParticipant],
  );

  const createOffer = useCallback(
    async (participantId: string) => {
      const connection = await getOrCreateConnection(participantId).catch((error) => {
        console.error('[call] Не удалось подготовить соединение для оффера', error);
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
        sendSignalRef.current(participantId, signal);
      } catch (error) {
        console.error('[call] Не удалось отправить оффер участнику', error);
      }
    },
    [getOrCreateConnection],
  );

  const handleIncomingOffer = useCallback(
    async (participantId: string, description: RTCSessionDescriptionInit) => {
      const connection = await getOrCreateConnection(participantId).catch((error) => {
        console.error('[call] Не удалось подготовить соединение для ответа', error);
        return null;
      });
      if (!connection) {
        return;
      }
      await connection.setRemoteDescription(description);
      await flushPendingIceCandidates(participantId, connection);
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
    [flushPendingIceCandidates, getOrCreateConnection],
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
          const connection =
            peerConnectionsRef.current.get(senderId) ??
            (await pendingConnectionsRef.current.get(senderId)?.catch(() => null));
          if (!connection) {
            return;
          }
          await connection.setRemoteDescription(signal.description);
          await flushPendingIceCandidates(senderId, connection);
        }
      } else if (signal.kind === 'candidate') {
        const connection =
          peerConnectionsRef.current.get(senderId) ??
          (await pendingConnectionsRef.current.get(senderId)?.catch(() => null));
        const candidate = signal.candidate;
        if (!connection?.remoteDescription) {
          const queue = pendingIceCandidatesRef.current.get(senderId) ?? [];
          queue.push(candidate);
          pendingIceCandidatesRef.current.set(senderId, queue);
          return;
        }
        await connection
          .addIceCandidate(candidate)
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
      pendingConnectionsRef.current.clear();
      pendingIceCandidatesRef.current.clear();
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
      pendingConnectionsRef.current.clear();
      pendingIceCandidatesRef.current.clear();
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
