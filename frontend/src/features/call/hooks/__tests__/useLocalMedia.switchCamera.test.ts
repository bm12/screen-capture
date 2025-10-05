import { cleanup, renderHook, act } from '@testing-library/react';
import type { MessageInstance } from 'antd/es/message/interface';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLocalMedia } from '../useLocalMedia';

type MockVideoTrack = MediaStreamTrack & {
  stop: ReturnType<typeof vi.fn>;
  getSettings: () => MediaTrackSettings & { deviceId?: string | null; facingMode?: string | null };
};

type MockMediaStream = MediaStream & {
  addTrack: (track: MediaStreamTrack) => void;
  removeTrack: (track: MediaStreamTrack) => void;
  getVideoTracks: () => MediaStreamTrack[];
  getAudioTracks: () => MediaStreamTrack[];
  getTracks: () => MediaStreamTrack[];
};

const createMockVideoTrack = ({
  deviceId = 'device-id',
  facingMode = 'user',
}: Partial<{ deviceId: string | null; facingMode: 'user' | 'environment' | null }> = {}): MockVideoTrack => {
  const stop = vi.fn();
  const track: Partial<MockVideoTrack> = {
    id: `${deviceId ?? 'device'}-${Math.random()}`,
    kind: 'video',
    label: deviceId ?? 'device',
    enabled: true,
    readyState: 'live',
    stop,
    getSettings: () => ({ deviceId: deviceId ?? undefined, facingMode: facingMode ?? undefined }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    applyConstraints: vi.fn(),
    clone: vi.fn(),
    getCapabilities: vi.fn(),
    getConstraints: vi.fn(),
    onended: null,
    onmute: null,
    onunmute: null,
    contentHint: '',
    muted: false,
  };

  return track as MockVideoTrack;
};

const createMockMediaStream = (tracks: MediaStreamTrack[] = []): MockMediaStream => {
  const internalTracks = [...tracks];

  const stream: Partial<MockMediaStream> = {
    id: `stream-${Math.random()}`,
    active: true,
    getTracks: () => [...internalTracks],
    getAudioTracks: () => internalTracks.filter((track) => track.kind === 'audio'),
    getVideoTracks: () => internalTracks.filter((track) => track.kind === 'video'),
    addTrack: (track: MediaStreamTrack) => {
      internalTracks.push(track);
    },
    removeTrack: (track: MediaStreamTrack) => {
      const index = internalTracks.indexOf(track);
      if (index !== -1) {
        internalTracks.splice(index, 1);
      }
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onaddtrack: null,
    onremovetrack: null,
    clone: vi.fn(),
  };

  return stream as MockMediaStream;
};

describe('useLocalMedia.switchCamera', () => {
  const originalMediaDevices = navigator.mediaDevices;
  let getUserMediaMock: ReturnType<typeof vi.fn>;
  let enumerateDevicesMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getUserMediaMock = vi.fn();
    enumerateDevicesMock = vi.fn().mockResolvedValue([]);

    const mediaDevicesMock: MediaDevices = {
      getUserMedia: getUserMediaMock as unknown as MediaDevices['getUserMedia'],
      enumerateDevices: enumerateDevicesMock as unknown as MediaDevices['enumerateDevices'],
      getDisplayMedia: vi.fn() as unknown as MediaDevices['getDisplayMedia'],
      getSupportedConstraints: () => ({}) as MediaTrackSupportedConstraints,
      ondevicechange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: mediaDevicesMock,
    });
  });

  afterEach(() => {
    cleanup();
    if (originalMediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: originalMediaDevices,
      });
    } else {
      Reflect.deleteProperty(navigator as { mediaDevices?: MediaDevices }, 'mediaDevices');
    }
    vi.restoreAllMocks();
  });

  it('stops the previous video track before resolving and adds the new track after a successful switch', async () => {
    let resolveGetUserMedia: (stream: MediaStream) => void = () => undefined;
    const pendingStream = new Promise<MediaStream>((resolve) => {
      resolveGetUserMedia = resolve;
    });

    getUserMediaMock.mockReturnValueOnce(pendingStream);

    const messageApi = {
      open: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
      loading: vi.fn(),
      destroy: vi.fn(),
    } as unknown as MessageInstance;

    const { result } = renderHook(() => useLocalMedia({ roomId: 'test-room', messageApi }));

    const initialTrack = createMockVideoTrack({ deviceId: 'initial-device', facingMode: 'user' });
    const localStream = createMockMediaStream([initialTrack]);

    act(() => {
      result.current.localStreamRef.current = localStream;
    });

    const switchPromise = result.current.switchCamera();

    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    expect(getUserMediaMock).toHaveBeenCalledWith({
      video: { facingMode: { exact: 'environment' } },
      audio: false,
    });

    expect(initialTrack.stop).toHaveBeenCalledTimes(1);
    expect(localStream.getVideoTracks()).toHaveLength(0);
    expect(result.current.localStreamRef.current).toBe(localStream);

    const newTrack = createMockVideoTrack({ deviceId: 'new-device', facingMode: 'environment' });
    const newStream = createMockMediaStream([newTrack]);

    resolveGetUserMedia(newStream);

    await act(async () => {
      await switchPromise;
    });

    const refreshedVideoTracks = result.current.localStreamRef.current?.getVideoTracks() ?? [];
    expect(refreshedVideoTracks).toHaveLength(1);
    expect(refreshedVideoTracks[0]).toBe(newTrack);
    expect(newTrack.onended).toBeTypeOf('function');
    expect(enumerateDevicesMock).toHaveBeenCalled();
  });
});
