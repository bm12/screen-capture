import { act, render, waitFor } from '@testing-library/react';
import type { MessageInstance } from 'antd/es/message/interface';
import { type FC } from 'react';
import { describe, expect, it, beforeEach, afterAll, vi } from 'vitest';

import { useLocalMedia } from './useLocalMedia';

type UseLocalMediaResult = ReturnType<typeof useLocalMedia>;

type TrackOptions = {
  deviceId?: string | null;
  facingMode?: 'user' | 'environment';
  kind?: 'audio' | 'video';
};

const createMockTrack = ({ deviceId = null, facingMode, kind = 'video' }: TrackOptions = {}) => {
  let readyState: MediaStreamTrack['readyState'] = 'live';

  const track: Partial<MediaStreamTrack> & {
    onended: ((this: MediaStreamTrack, ev: Event) => any) | null;
    getSettings: () => MediaTrackSettings;
  } = {
    enabled: true,
    kind,
    onended: null,
    stop: vi.fn(() => {
      readyState = 'ended';
      const handler = track.onended as (() => void) | null;
      handler?.call(track as MediaStreamTrack);
    }),
    getSettings: () => ({ deviceId: deviceId ?? undefined, facingMode }),
  };

  Object.defineProperty(track, 'readyState', {
    get: () => readyState,
  });

  return track as MediaStreamTrack;
};

type StreamOptions = {
  audioTracks?: MediaStreamTrack[];
  videoTracks?: MediaStreamTrack[];
};

const createMockStream = ({
  audioTracks: initialAudioTracks = [],
  videoTracks: initialVideoTracks = [],
}: StreamOptions = {}) => {
  const audioTracks = [...initialAudioTracks];
  const videoTracks = [...initialVideoTracks];

  const removeTrackFrom = (list: MediaStreamTrack[], track: MediaStreamTrack) => {
    const index = list.indexOf(track);
    if (index !== -1) {
      list.splice(index, 1);
    }
  };

  const stream: Partial<MediaStream> = {
    getAudioTracks: () => [...audioTracks],
    getVideoTracks: () => [...videoTracks],
    getTracks: () => [...audioTracks, ...videoTracks],
    addTrack: (track: MediaStreamTrack) => {
      if (track.kind === 'audio') {
        audioTracks.push(track);
        return;
      }
      videoTracks.push(track);
    },
    removeTrack: (track: MediaStreamTrack) => {
      if (track.kind === 'audio') {
        removeTrackFrom(audioTracks, track);
        return;
      }
      removeTrackFrom(videoTracks, track);
    },
  };

  return stream as MediaStream;
};

const createMessageApiMock = () => {
  const api = {
    open: vi.fn(),
    destroy: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  };

  return api as MessageInstance & typeof api;
};

const createVideoInput = (deviceId: string, label: string): MediaDeviceInfo =>
  ({
    deviceId,
    groupId: `${deviceId}-group`,
    kind: 'videoinput',
    label,
    toJSON() {
      return this;
    },
  } as MediaDeviceInfo);

const renderUseLocalMedia = (messageApi: MessageInstance) => {
  const lastResult: { current: UseLocalMediaResult | null } = { current: null };

  const HookWrapper: FC = () => {
    lastResult.current = useLocalMedia({ roomId: 'room-id', messageApi });
    return null;
  };

  render(<HookWrapper />);

  return lastResult;
};

describe('useLocalMedia switchCamera recovery', () => {
  const originalMediaDevices = navigator.mediaDevices;
  let getUserMediaMock: ReturnType<typeof vi.fn>;
  let enumerateDevicesMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();

    getUserMediaMock = vi.fn();
    enumerateDevicesMock = vi.fn();

    const mediaDevices: MediaDevices = {
      ...originalMediaDevices,
      getUserMedia: getUserMediaMock,
      enumerateDevices: enumerateDevicesMock,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: mediaDevices,
    });
  });

  afterAll(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices,
    });
  });

  it('restores the previous camera when all attempts fail and reports an error if recovery fails', async () => {
    const messageApi = createMessageApiMock();

    const initialTrack = createMockTrack({ deviceId: 'device-1', facingMode: 'user' });
    const initialStream = createMockStream({ videoTracks: [initialTrack] });

    const recoveryTrack = createMockTrack({ deviceId: 'device-1', facingMode: 'user' });
    const recoveryStream = createMockStream({ videoTracks: [recoveryTrack] });

    getUserMediaMock
      .mockResolvedValueOnce(initialStream)
      .mockRejectedValueOnce(Object.assign(new Error('candidate failure'), { name: 'NotReadableError' }))
      .mockRejectedValueOnce(new Error('fallback failure'))
      .mockResolvedValueOnce(recoveryStream);

    const devices = [
      createVideoInput('device-1', 'Front camera'),
      createVideoInput('device-2', 'Rear camera'),
    ];
    enumerateDevicesMock.mockImplementation(() => Promise.resolve(devices));

    const hookRef = renderUseLocalMedia(messageApi);

    await waitFor(() => expect(hookRef.current).not.toBeNull());

    await act(async () => {
      await hookRef.current!.setupLocalStream();
    });

    await waitFor(() => {
      expect(hookRef.current?.localStreamRef.current).toBe(initialStream);
      expect(hookRef.current?.videoDevices).toHaveLength(2);
    });

    expect(hookRef.current?.activeVideoDeviceId).toBe('device-1');

    await act(async () => {
      await hookRef.current!.switchCamera();
    });

    const videoTracks = hookRef.current!.localStreamRef.current?.getVideoTracks() ?? [];
    expect(videoTracks).toHaveLength(1);
    expect(videoTracks[0]).toBe(recoveryTrack);
    expect(hookRef.current?.activeVideoDeviceId).toBe('device-1');
    expect(messageApi.error).not.toHaveBeenCalled();

    const enumerateCallsAfterSuccess = enumerateDevicesMock.mock.calls.length;

    messageApi.error.mockClear();

    getUserMediaMock
      .mockRejectedValueOnce(new Error('candidate failure 2'))
      .mockRejectedValueOnce(new Error('fallback failure 2'))
      .mockRejectedValueOnce(new Error('restore failure'));

    await act(async () => {
      await hookRef.current!.switchCamera();
    });

    expect(messageApi.error).toHaveBeenCalledWith('Не удалось переключить камеру.');
    expect(enumerateDevicesMock.mock.calls.length).toBe(enumerateCallsAfterSuccess + 1);
  });
});
