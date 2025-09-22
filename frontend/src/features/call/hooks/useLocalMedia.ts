import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MessageInstance } from 'antd/es/message/interface';

import { buildVideoConstraints, guessFacingMode } from '../utils/mediaConstraints';

type StreamUpdateHandler = (stream: MediaStream) => void;
type VideoTrackSwitchHandler = (track: MediaStreamTrack) => void;

type UseLocalMediaOptions = {
  roomId: string;
  messageApi: MessageInstance;
};

const STORAGE_KEYS = {
  mic: 'call:mic-enabled',
  camera: 'call:camera-enabled',
} as const;

const readStoredBoolean = (key: string, fallback: boolean) => {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const value = window.localStorage.getItem(key);
    if (value === null) {
      return fallback;
    }
    return value === 'true';
  } catch (error) {
    console.warn('[call] Не удалось прочитать сохраненное состояние медиа', { key, error });
    return fallback;
  }
};

const writeStoredBoolean = (key: string, value: boolean) => {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(key, String(value));
  } catch (error) {
    console.warn('[call] Не удалось сохранить состояние медиа', { key, error });
  }
};

export const useLocalMedia = ({ roomId, messageApi }: UseLocalMediaOptions) => {
  const [isMicEnabledState, setIsMicEnabledState] = useState(() => readStoredBoolean(STORAGE_KEYS.mic, true));
  const [isCameraEnabledState, setIsCameraEnabledState] = useState(() =>
    readStoredBoolean(STORAGE_KEYS.camera, true),
  );
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeVideoDeviceId, setActiveVideoDeviceId] = useState<string | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const desiredFacingModeRef = useRef<'user' | 'environment' | null>(null);
  const notReadableDeviceIdsRef = useRef<Set<string>>(new Set());
  const isUnmountedRef = useRef(false);
  const streamUpdateHandlerRef = useRef<StreamUpdateHandler | null>(null);
  const videoTrackSwitchHandlerRef = useRef<VideoTrackSwitchHandler | null>(null);

  const updateMicState = useCallback((nextState: boolean) => {
    setIsMicEnabledState(nextState);
    writeStoredBoolean(STORAGE_KEYS.mic, nextState);
  }, []);

  const updateCameraState = useCallback((nextState: boolean) => {
    setIsCameraEnabledState(nextState);
    writeStoredBoolean(STORAGE_KEYS.camera, nextState);
  }, []);

  const isMicEnabled = isMicEnabledState;
  const isCameraEnabled = isCameraEnabledState;

  const shareLink = useMemo(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    return `${window.location.origin}/call/${roomId}`;
  }, [roomId]);

  const registerStreamUpdateHandler = useCallback((handler: StreamUpdateHandler) => {
    streamUpdateHandlerRef.current = handler;
    return () => {
      if (streamUpdateHandlerRef.current === handler) {
        streamUpdateHandlerRef.current = null;
      }
    };
  }, []);

  const registerVideoTrackSwitchHandler = useCallback((handler: VideoTrackSwitchHandler) => {
    videoTrackSwitchHandlerRef.current = handler;
    return () => {
      if (videoTrackSwitchHandlerRef.current === handler) {
        videoTrackSwitchHandlerRef.current = null;
      }
    };
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
        updateMicState(audioTracks.some((track) => track.enabled));
      }

      const videoTrack = stream.getVideoTracks()[0] ?? null;
      if (!isUnmountedRef.current) {
        updateCameraState(Boolean(videoTrack?.enabled));
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

      streamUpdateHandlerRef.current?.(stream);
    },
    [updateCameraState, updateMicState],
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
      await refreshDevices();
    } catch (error) {
      console.error('[call] Не удалось восстановить локальные устройства', error);
      messageApi.error('Не удалось заново получить доступ к камере или микрофону.');
    }
  }, [activeVideoDeviceId, applyLocalStream, isCameraEnabled, isMicEnabled, messageApi, refreshDevices]);

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

  const setupLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: 'user' },
      });
      await applyLocalStream(stream, { micEnabled: isMicEnabled, cameraEnabled: isCameraEnabled });
    } catch (error) {
      console.error('[call] Не удалось получить доступ к камере', error);
      const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      await applyLocalStream(audioOnly, { micEnabled: isMicEnabled, cameraEnabled: false });
      desiredFacingModeRef.current = null;
      messageApi.warning('Камера недоступна. Подключаемся только с микрофоном.');
    }

    await refreshDevices();
  }, [applyLocalStream, isCameraEnabled, isMicEnabled, messageApi, refreshDevices]);

  const toggleMicrophone = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }
    stream.getAudioTracks().forEach((track, index) => {
      track.enabled = !track.enabled;
      updateMicState(track.enabled);
      if (index === 0) {
        console.log('[call] Состояние микрофона изменено', { enabled: track.enabled });
      }
    });
  }, [updateMicState]);

  const toggleCamera = useCallback(() => {
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
      updateCameraState(track.enabled);
      if (index === 0) {
        console.log('[call] Состояние камеры изменено', { enabled: track.enabled });
      }
    });
  }, [messageApi, updateCameraState]);

  const switchCamera = useCallback(async () => {
    const capturedStream = localStreamRef.current;
    if (!capturedStream) {
      messageApi.error('Локальный поток недоступен. Попробуйте переподключиться.');
      return;
    }

    const [currentTrack] = capturedStream.getVideoTracks();
    if (!currentTrack) {
      messageApi.warning('Камера неактивна или недоступна.');
      return;
    }

    const currentSettings = currentTrack.getSettings();
    const previousDeviceId = currentSettings.deviceId ?? activeVideoDeviceId ?? null;
    const settingsFacing = currentSettings.facingMode;
    const previousFacingMode =
      settingsFacing === 'user' || settingsFacing === 'environment'
        ? settingsFacing
        : desiredFacingModeRef.current;

    const notReadableDeviceIds = notReadableDeviceIdsRef.current;

    type SwitchAttempt = {
      constraint: MediaTrackConstraints;
      deviceId: string | null;
      facingMode: 'user' | 'environment' | null;
      kind: 'device' | 'fallback';
    };

    const attempts: SwitchAttempt[] = [];

    if (videoDevices.length > 0) {
      const currentIndex = videoDevices.findIndex((device) => device.deviceId === activeVideoDeviceId);
      const totalDevices = videoDevices.length;
      const baseIndex = currentIndex === -1 ? -1 : currentIndex;
      const visitedDeviceIds = new Set<string>();

      for (let offset = 1; offset <= totalDevices; offset += 1) {
        const index = (baseIndex + offset + totalDevices) % totalDevices;
        const candidate = videoDevices[index];
        const candidateId = candidate?.deviceId;

        if (!candidateId) {
          continue;
        }

        if (candidateId === previousDeviceId || candidateId === activeVideoDeviceId) {
          continue;
        }

        if (visitedDeviceIds.has(candidateId)) {
          continue;
        }
        visitedDeviceIds.add(candidateId);

        if (notReadableDeviceIds.has(candidateId)) {
          console.warn('[call] Пропускаем устройство, ранее давшее NotReadableError', {
            deviceId: candidateId,
          });
          continue;
        }

        const guessedFacingMode = guessFacingMode(candidate);
        attempts.push({
          kind: 'device',
          constraint: { deviceId: { exact: candidateId } },
          deviceId: candidateId,
          facingMode: guessedFacingMode ?? null,
        });
      }
    }

    const fallbackFacings: ('user' | 'environment')[] = [];
    if (previousFacingMode === 'environment') {
      fallbackFacings.push('user');
    } else if (previousFacingMode === 'user') {
      fallbackFacings.push('environment');
    } else {
      fallbackFacings.push('environment', 'user');
    }

    const uniqueFallbackFacings = Array.from(new Set(fallbackFacings));
    for (const facing of uniqueFallbackFacings) {
      attempts.push({
        kind: 'fallback',
        constraint: { facingMode: { exact: facing } },
        deviceId: null,
        facingMode: facing,
      });
    }

    capturedStream.removeTrack(currentTrack);
    currentTrack.stop();

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = capturedStream;
      await localVideoRef.current.play().catch(() => undefined);
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
        const [track] = stream.getVideoTracks();
        if (!track) {
          stream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
          continue;
        }
        const trackSettings = track.getSettings();
        newTrack = track;
        appliedDeviceId = trackSettings.deviceId ?? attempt.deviceId ?? null;
        const trackFacing = trackSettings.facingMode;
        if (trackFacing === 'user' || trackFacing === 'environment') {
          appliedFacingMode = trackFacing;
        } else if (attempt.facingMode) {
          appliedFacingMode = attempt.facingMode;
        }
        const deviceChanged = (appliedDeviceId ?? null) !== (previousDeviceId ?? null);
        if (attempt.kind === 'fallback' && !deviceChanged) {
          console.log('[call] Fallback вернул текущую камеру, продолжаем поиск другой камеры', {
            deviceId: appliedDeviceId,
            facingMode: appliedFacingMode,
          });
          track.stop();
          stream.getTracks().forEach((mediaTrack) => {
            if (mediaTrack !== track) {
              mediaTrack.stop();
            }
          });
          newTrack = null;
          appliedDeviceId = null;
          appliedFacingMode = null;
          continue;
        }
        break;
      } catch (error) {
        lastError = error;
        console.warn('[call] Попытка переключения камеры завершилась неудачно', { attempt, error });
        if (
          attempt.deviceId &&
          typeof error === 'object' &&
          error !== null &&
          'name' in error &&
          (error as { name?: string }).name === 'NotReadableError'
        ) {
          notReadableDeviceIds.add(attempt.deviceId);
          console.warn('[call] Запоминаем устройство с ошибкой NotReadableError', {
            deviceId: attempt.deviceId,
          });
        }
      }
    }

    if (!newTrack) {
      console.warn('[call] Не удалось переключить камеру ни по одному сценарию, пробуем восстановить предыдущую', lastError);
      try {
        const constraint = previousDeviceId
          ? { deviceId: { exact: previousDeviceId } }
          : previousFacingMode
          ? { facingMode: { exact: previousFacingMode } }
          : undefined;
        const restoreStream = await navigator.mediaDevices.getUserMedia({
          video: constraint ?? true,
          audio: false,
        });
        const [restoreTrack] = restoreStream.getVideoTracks();
        if (restoreTrack) {
          newTrack = restoreTrack;
          const restoreSettings = restoreTrack.getSettings();
          appliedDeviceId = restoreSettings.deviceId ?? previousDeviceId ?? null;
          appliedFacingMode =
            restoreSettings.facingMode === 'user' || restoreSettings.facingMode === 'environment'
              ? restoreSettings.facingMode
              : previousFacingMode;
        } else {
          restoreStream.getTracks().forEach((mediaTrack) => mediaTrack.stop());
        }
      } catch (restoreError) {
        console.error('[call] Не удалось восстановить предыдущую камеру', restoreError);
      }
    }

    if (!newTrack) {
      messageApi.error('Не удалось переключить камеру.');
      await refreshDevices();
      return;
    }

    const refreshedStream = localStreamRef.current;
    if (!refreshedStream) {
      console.warn('[call] Локальный поток стал недоступен во время переключения камеры. Отменяем замену трека.');
      newTrack.stop();
      await refreshDevices();
      return;
    }

    if (refreshedStream !== capturedStream) {
      console.warn('[call] Локальный поток был обновлен во время переключения камеры. Отменяем замену трека.');
      newTrack.stop();
      await refreshDevices();
      return;
    }

    const localStream = refreshedStream;

    newTrack.enabled = isCameraEnabled;
    newTrack.onended = () => {
      console.warn('[call] Локальный видеотрек остановлен браузером', { readyState: newTrack?.readyState });
    };
    localStream.addTrack(newTrack);

    const nextFacingMode = appliedFacingMode ?? previousFacingMode ?? null;
    desiredFacingModeRef.current = nextFacingMode ?? desiredFacingModeRef.current;

    const deviceChanged = (appliedDeviceId ?? null) !== (previousDeviceId ?? null);
    const facingChanged =
      (appliedFacingMode ?? null) !== (previousFacingMode ?? null) && (appliedFacingMode ?? null) !== null;
    const hasRealChange = deviceChanged || facingChanged;

    if (hasRealChange) {
      setActiveVideoDeviceId(appliedDeviceId ?? null);
    }

    videoTrackSwitchHandlerRef.current?.(newTrack);

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
      await localVideoRef.current.play().catch(() => undefined);
    }

    await refreshDevices();

    if (hasRealChange) {
      console.log('[call] Камера переключена', {
        deviceId: appliedDeviceId,
        facingMode: desiredFacingModeRef.current,
      });
    } else {
      console.log('[call] Используем прежнюю камеру', {
        deviceId: previousDeviceId,
        facingMode: desiredFacingModeRef.current,
      });
    }
  }, [activeVideoDeviceId, isCameraEnabled, messageApi, refreshDevices, videoDevices]);

  const copyShareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareLink);
      messageApi.success('Ссылка скопирована в буфер обмена.');
    } catch (error) {
      console.error('Не удалось скопировать ссылку', error);
      messageApi.warning('Скопируйте ссылку вручную.');
    }
  }, [messageApi, shareLink]);

  useEffect(() => {
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
    };
  }, [refreshDevices]);

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    };
  }, []);

  return {
    localStreamRef,
    localVideoRef,
    isMicEnabled,
    isCameraEnabled,
    videoDevices,
    activeVideoDeviceId,
    shareLink,
    toggleMicrophone,
    toggleCamera,
    switchCamera,
    copyShareLink,
    setupLocalStream,
    restartLocalStream,
    registerStreamUpdateHandler,
    registerVideoTrackSwitchHandler,
  };
};
