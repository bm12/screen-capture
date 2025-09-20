import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignalingClient } from './signalingClient';

type LocationLike = Pick<Location, 'protocol' | 'host'>;

const mockLocation = (value: LocationLike) => {
  const locationGetter = vi.spyOn(window, 'location', 'get');
  locationGetter.mockReturnValue(value as Location);
  return locationGetter;
};

describe('SignalingClient.buildUrl', () => {
  let locationSpy: ReturnType<typeof mockLocation> | null = null;

  afterEach(() => {
    vi.unstubAllEnvs();
    if (locationSpy) {
      locationSpy.mockRestore();
      locationSpy = null;
    }
  });

  it('returns the current origin when VITE_SIGNALING_URL is empty', () => {
    locationSpy = mockLocation({ protocol: 'https:', host: 'example.com' });
    vi.stubEnv('VITE_SIGNALING_URL', '');

    expect(SignalingClient.buildUrl()).toBe('wss://example.com');
  });

  it('prefixes the resolved protocol when VITE_SIGNALING_URL has no protocol', () => {
    locationSpy = mockLocation({ protocol: 'http:', host: 'localhost:3000' });
    vi.stubEnv('VITE_SIGNALING_URL', 'signaling.internal');

    expect(SignalingClient.buildUrl()).toBe('ws://signaling.internal');
  });

  it.each([
    ['ws://custom.example.org', 'ws://custom.example.org'],
    ['wss://secure.example.org', 'wss://secure.example.org'],
  ])('uses the provided websocket URL %s as is', (input, expected) => {
    locationSpy = mockLocation({ protocol: 'https:', host: 'irrelevant' });
    vi.stubEnv('VITE_SIGNALING_URL', input);

    expect(SignalingClient.buildUrl()).toBe(expected);
  });
});
