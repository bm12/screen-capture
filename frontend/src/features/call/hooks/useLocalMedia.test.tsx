import React, { useEffect } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageInstance } from 'antd/es/message/interface';

import { useLocalMedia } from './useLocalMedia';

type MessageApiMock = MessageInstance & {
  open: ReturnType<typeof vi.fn>;
  success: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  loading: ReturnType<typeof vi.fn>;
};

const createMessageApiMock = (): MessageApiMock =>
  ({
    open: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  } as unknown as MessageApiMock);

type HookOptions = Parameters<typeof useLocalMedia>[0];
type HookResult = ReturnType<typeof useLocalMedia>;

type TestComponentProps = HookOptions & {
  onReady: (result: HookResult) => void;
};

const TestComponent: React.FC<TestComponentProps> = ({ onReady, ...options }) => {
  const controls = useLocalMedia(options);

  useEffect(() => {
    onReady(controls);
  }, [controls, onReady]);

  return null;
};

type RenderOptions = Partial<HookOptions> & {
  onReady?: (result: HookResult) => void;
};

type RenderResult = {
  getControls: () => HookResult;
  onReady: ReturnType<typeof vi.fn<(result: HookResult) => void>>;
};

const renderUseLocalMedia = async (overrides: RenderOptions = {}): Promise<RenderResult> => {
  const { onReady: onReadyOverride, ...options } = overrides;
  const readyMock = onReadyOverride ? vi.fn(onReadyOverride) : vi.fn<(result: HookResult) => void>();

  const props: TestComponentProps = {
    roomId: 'test-room',
    messageApi: createMessageApiMock(),
    ...options,
    onReady: readyMock,
  } as TestComponentProps;

  render(<TestComponent {...props} />);

  await waitFor(() => {
    expect(readyMock).toHaveBeenCalled();
  });

  const getControls = () => {
    const latest = readyMock.mock.calls.at(-1)?.[0] as HookResult | undefined;
    if (!latest) {
      throw new Error('Hook result is not available');
    }
    return latest;
  };

  return { getControls, onReady: readyMock };
};

type MockVideoTrackOptions = {
  id: string;
  deviceId: string | null;
  facingMode?: string | null;
};

const createMockVideoTrack = ({ id, deviceId, facingMode = null }: MockVideoTrackOptions): MediaStreamTrack => {
  let onendedHandler: (() => void) | null = null;

  const track: Partial<MediaStreamTrack> & { id: string } = {
    id,
    kind: 'video',
    enabled: true,
    readyState: 'live',
    stop: vi.fn(() => {
      track.readyState = 'ended';
      onendedHandler?.();
    }),
    getSettings: vi.fn(() => ({
      deviceId: deviceId ?? undefined,
      facingMode: facingMode ?? undefined,
    })),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    applyConstraints: vi.fn(),
  };

  Object.defineProperty(track, 'onended', {
    configurable: true,
    get: () => onendedHandler,
    set: (value) => {
      onendedHandler = typeof value === 'function' ? value : null;
    },
  });

  return track as MediaStreamTrack;
};

type MockStreamOptions = {
  id: string;
  videoTracks?: MediaStreamTrack[];
  audioTracks?: MediaStreamTrack[];
};

const createMockStream = ({ id, videoTracks = [], audioTracks = [] }: MockStreamOptions): MediaStream => {
  const video: MediaStreamTrack[] = [...videoTracks];
  const audio: MediaStreamTrack[] = [...audioTracks];

  const removeTrackFrom = (collection: MediaStreamTrack[], track: MediaStreamTrack) => {
    const index = collection.indexOf(track);
    if (index >= 0) {
      collection.splice(index, 1);
    }
  };

  const stream: Partial<MediaStream> = {
    id,
    active: true,
    getTracks: () => [...audio, ...video],
    getAudioTracks: () => [...audio],
    getVideoTracks: () => [...video],
    addTrack: (track: MediaStreamTrack) => {
      if (track.kind === 'audio') {
        audio.push(track);
      } else {
        video.push(track);
      }
    },
    removeTrack: (track: MediaStreamTrack) => {
      if (track.kind === 'audio') {
        removeTrackFrom(audio, track);
      } else {
        removeTrackFrom(video, track);
      }
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    clone: vi.fn(),
    getTrackById: vi.fn(),
  };

  return stream as MediaStream;
};

type DeviceOptions = {
  deviceId: string;
  label: string;
};

const createVideoDevice = ({ deviceId, label }: DeviceOptions): MediaDeviceInfo =>
  ({
    deviceId,
    kind: 'videoinput',
    label,
    groupId: `${deviceId}-group`,
    toJSON() {
      return {
        deviceId: this.deviceId,
        kind: this.kind,
        label: this.label,
        groupId: this.groupId,
      };
    },
  } as MediaDeviceInfo);

const originalMediaDevices = navigator.mediaDevices;

const getUserMediaMock = vi.fn<MediaDevices['getUserMedia']>();
const enumerateDevicesMock = vi.fn<MediaDevices['enumerateDevices']>();
const addDeviceListenerMock = vi.fn();
const removeDeviceListenerMock = vi.fn();

beforeEach(() => {
  getUserMediaMock.mockReset();
  enumerateDevicesMock.mockReset();
  addDeviceListenerMock.mockReset();
  removeDeviceListenerMock.mockReset();

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: getUserMediaMock,
      enumerateDevices: enumerateDevicesMock,
      addEventListener: addDeviceListenerMock,
      removeEventListener: removeDeviceListenerMock,
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();

  if (originalMediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices,
    });
  } else {
    delete (navigator as unknown as { mediaDevices?: MediaDevices }).mediaDevices;
  }
});

describe('useLocalMedia switchCamera queue', () => {
    it('continues queue when fallback reuses previous camera before switching to a new device', async () => {
      const messageApi = createMessageApiMock();
    const consoleLogMock = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const initialTrack = createMockVideoTrack({ id: 'track-initial', deviceId: 'device-1', facingMode: null });
    const initialStream = createMockStream({ id: 'stream-initial', videoTracks: [initialTrack] });

    const fallbackTrackSameDevice = createMockVideoTrack({
      id: 'track-fallback-same',
      deviceId: 'device-1',
      facingMode: 'environment',
    });
    const fallbackSameStream = createMockStream({
      id: 'stream-fallback-same',
      videoTracks: [fallbackTrackSameDevice],
    });

    const finalTrack = createMockVideoTrack({ id: 'track-final', deviceId: 'device-3', facingMode: 'user' });
    const finalStream = createMockStream({ id: 'stream-final', videoTracks: [finalTrack] });

    enumerateDevicesMock.mockResolvedValue([
      createVideoDevice({ deviceId: 'device-1', label: 'Front camera' }),
      createVideoDevice({ deviceId: 'device-2', label: 'Rear camera' }),
    ]);

    getUserMediaMock
      .mockResolvedValueOnce(initialStream)
      .mockRejectedValueOnce(Object.assign(new Error('Camera busy'), { name: 'NotReadableError' }))
      .mockResolvedValueOnce(fallbackSameStream)
      .mockResolvedValueOnce(finalStream);

    const renderResult = await renderUseLocalMedia({ messageApi });

    await act(async () => {
      await renderResult.getControls().setupLocalStream();
    });

    await waitFor(() => {
      const controls = renderResult.getControls();
      expect(controls.activeVideoDeviceId).toBe('device-1');
      expect(controls.localStreamRef.current).toBe(initialStream);
    });

    getUserMediaMock.mockClear();
    consoleLogMock.mockClear();
    consoleWarnMock.mockClear();

    await act(async () => {
      await renderResult.getControls().switchCamera();
    });

    expect(getUserMediaMock).toHaveBeenCalledTimes(3);
    expect(getUserMediaMock.mock.calls[0]?.[0]).toMatchObject({
      video: { deviceId: { exact: 'device-2' } },
      audio: false,
    });
    expect(getUserMediaMock.mock.calls[1]?.[0]).toMatchObject({
      video: { facingMode: { exact: 'environment' } },
      audio: false,
    });
    expect(getUserMediaMock.mock.calls[2]?.[0]).toMatchObject({
      video: { facingMode: { exact: 'user' } },
      audio: false,
    });

    const failureWarnCall = consoleWarnMock.mock.calls.find(
      ([message]) => message === '[call] Попытка переключения камеры завершилась неудачно',
    );
    expect(failureWarnCall?.[1]).toEqual(
      expect.objectContaining({
        attempt: expect.objectContaining({ deviceId: 'device-2' }),
        error: expect.objectContaining({ name: 'NotReadableError' }),
      }),
    );

    expect(consoleWarnMock).toHaveBeenCalledWith(
      '[call] Запоминаем устройство с ошибкой NotReadableError',
      expect.objectContaining({ deviceId: 'device-2' }),
    );

    const fallbackLogCall = consoleLogMock.mock.calls.find(
      ([message]) => message === '[call] Fallback вернул текущую камеру, продолжаем поиск другой камеры',
    );
    expect(fallbackLogCall?.[1]).toEqual(
      expect.objectContaining({
        deviceId: 'device-1',
        facingMode: 'environment',
      }),
    );

    expect(fallbackTrackSameDevice.stop).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      const controls = renderResult.getControls();
      const currentStream = controls.localStreamRef.current;
      expect(currentStream?.getVideoTracks()).toHaveLength(1);
      expect(currentStream?.getVideoTracks()[0]).toBe(finalTrack);
      expect(controls.activeVideoDeviceId).toBe('device-3');
    });

    const successLogCall = consoleLogMock.mock.calls.find(
      ([message]) => message === '[call] Камера переключена',
    );
    expect(successLogCall?.[1]).toEqual(
      expect.objectContaining({
        deviceId: 'device-3',
      }),
    );

    expect(initialTrack.stop).toHaveBeenCalledTimes(1);
    expect(messageApi.error).not.toHaveBeenCalled();
  });
});
