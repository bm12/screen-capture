import React, { useEffect } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignalEnvelope } from './types';

vi.mock('./signalingClient', () => {
  class MockSignalingClient {
    static instances: MockSignalingClient[] = [];

    static clearInstances() {
      MockSignalingClient.instances.length = 0;
    }

    static getLastInstance() {
      return MockSignalingClient.instances.at(-1) ?? null;
    }

    public send = vi.fn();

    public connect = vi.fn(async () => {
      this.connected = true;
    });

    public close = vi.fn();

    private listeners = new Map<string, Set<(payload: unknown) => void>>();

    private connected = false;

    private clientId: string | null = null;

    constructor() {
      MockSignalingClient.instances.push(this);
    }

    isConnected() {
      return this.connected;
    }

    setConnected(value: boolean) {
      this.connected = value;
    }

    setClientId(clientId: string | null) {
      this.clientId = clientId;
    }

    getClientId() {
      return this.clientId;
    }

    on(type: string, listener: (payload: unknown) => void) {
      const listeners = this.listeners.get(type) ?? new Set<(payload: unknown) => void>();
      listeners.add(listener);
      this.listeners.set(type, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.listeners.delete(type);
        }
      };
    }

    emit(type: string, payload?: unknown) {
      const listeners = this.listeners.get(type);
      if (!listeners) {
        return;
      }

      for (const listener of Array.from(listeners)) {
        listener(payload);
      }
    }
  }

  return { SignalingClient: MockSignalingClient };
});

import { useSignalingRoom } from './useSignalingRoom';
import { SignalingClient } from './signalingClient';

type HookOptions = Parameters<typeof useSignalingRoom>[0];
type HookResult = ReturnType<typeof useSignalingRoom>;

type MockClientInstance = InstanceType<typeof SignalingClient> & {
  send: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  setConnected(value: boolean): void;
  emit(type: string, payload?: unknown): void;
};

type MockClientConstructor = {
  new (...args: unknown[]): MockClientInstance;
  instances: MockClientInstance[];
  clearInstances(): void;
  getLastInstance(): MockClientInstance | null;
};

const MockedSignalingClient = SignalingClient as unknown as MockClientConstructor;

const baseOptions: HookOptions = {
  roomId: 'test-room',
  mode: 'call',
  role: 'host',
};

type TestComponentProps = HookOptions & {
  onReady: (result: HookResult) => void;
};

const TestComponent: React.FC<TestComponentProps> = ({ onReady, ...options }) => {
  const controls = useSignalingRoom(options);

  useEffect(() => {
    onReady(controls);
  }, [controls, onReady]);

  return null;
};

type RenderOptions = Partial<HookOptions> & { onReady?: (result: HookResult) => void };

type RenderResult = {
  controls: HookResult;
  getClient: () => MockClientInstance;
  onReady: ReturnType<typeof vi.fn<(result: HookResult) => void>>;
};

const renderUseSignalingRoom = async (overrides: RenderOptions = {}): Promise<RenderResult> => {
  const { onReady: onReadyOverride, ...hookOverrides } = overrides;
  const readyMock = onReadyOverride
    ? vi.fn(onReadyOverride)
    : vi.fn<(result: HookResult) => void>();
  const props: TestComponentProps = {
    ...baseOptions,
    ...hookOverrides,
    onReady: readyMock,
  } as TestComponentProps;

  render(<TestComponent {...props} />);

  const controls = await waitFor(() => {
    expect(readyMock).toHaveBeenCalled();
    return readyMock.mock.calls.at(-1)?.[0] as HookResult;
  });

  const getClient = () => {
    const client = MockedSignalingClient.getLastInstance();
    if (!client) {
      throw new Error('Mocked signaling client was not created');
    }

    return client;
  };

  return { controls, getClient, onReady: readyMock };
};

beforeEach(() => {
  MockedSignalingClient.clearInstances();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  MockedSignalingClient.clearInstances();
});

describe('useSignalingRoom', () => {
  it('sends join-room with the latest parameters when joinRoom is invoked', async () => {
    const { controls, getClient } = await renderUseSignalingRoom();

    await act(async () => {
      await controls.joinRoom({ roomId: 'override-room', role: 'speaker' });
    });

    const client = getClient();

    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledWith('join-room', {
      roomId: 'override-room',
      mode: 'call',
      role: 'speaker',
    });
  });

  it('uses the latest roomId for sendSignal and throws when not connected', async () => {
    const { controls, getClient } = await renderUseSignalingRoom();

    const signal: SignalEnvelope = {
      kind: 'candidate',
      candidate: { candidate: 'candidate', sdpMid: '0' },
    };

    expect(() => controls.sendSignal('peer', signal)).toThrow(
      'Нельзя отправить сигнал без активного подключения к комнате.',
    );

    await act(async () => {
      await controls.joinRoom({ roomId: 'updated-room' });
    });

    const client = getClient();

    client.send.mockClear();

    client.setConnected(false);
    expect(() => controls.sendSignal('peer', signal)).toThrow('Сигнальное соединение ещё не готово.');

    client.setConnected(true);
    controls.sendSignal('peer', signal);

    expect(client.send).toHaveBeenCalledWith('signal', {
      roomId: 'updated-room',
      targetClientId: 'peer',
      signal,
    });
  });

  it('re-joins the room after reconnection and reports failures', async () => {
    const onReconnected = vi.fn();
    const onReconnectionFailed = vi.fn();

    const { controls, getClient } = await renderUseSignalingRoom({
      onReconnected,
      onReconnectionFailed,
    });

    await act(async () => {
      await controls.joinRoom();
    });

    const client = getClient();

    client.send.mockClear();

    const initialConnectCalls = client.connect.mock.calls.length;
    client.setConnected(false);
    client.connect.mockImplementationOnce(async () => {
      client.setConnected(true);
    });

    await act(async () => {
      client.emit('reconnected');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(client.send).toHaveBeenCalledWith('join-room', {
        roomId: 'test-room',
        mode: 'call',
        role: 'host',
      });
    });

    expect(client.connect.mock.calls.length).toBe(initialConnectCalls + 1);
    expect(onReconnected).toHaveBeenCalled();
    expect(onReconnectionFailed).not.toHaveBeenCalled();

    client.send.mockClear();
    onReconnected.mockClear();

    const failure = new Error('reconnect failed');
    client.setConnected(false);
    client.connect.mockImplementationOnce(async () => {
      throw failure;
    });

    await act(async () => {
      client.emit('reconnected');
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(onReconnectionFailed).toHaveBeenCalledWith(failure, expect.any(Object));
    });

    expect(onReconnected).toHaveBeenCalled();
    expect(client.send).not.toHaveBeenCalled();
  });
});
