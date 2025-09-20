import request from 'supertest';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = ['TURN_SECRET', 'TURN_HOST', 'TURN_REALM', 'ICE_TTL_SEC'] as const;

type EnvKey = (typeof ENV_KEYS)[number];

type EnvSnapshot = Partial<Record<EnvKey, string | undefined>>;

const originalEnv: EnvSnapshot = ENV_KEYS.reduce<EnvSnapshot>((acc, key) => {
  acc[key] = process.env[key];
  return acc;
}, {});

const applyEnv = (values: EnvSnapshot) => {
  for (const key of ENV_KEYS) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const importApp = async () => {
  const module = await import('#server');
  return module.app;
};

describe('GET /ice', () => {
  beforeEach(() => {
    applyEnv(originalEnv);
    vi.resetModules();
    vi.useRealTimers();
  });

  afterEach(() => {
    applyEnv(originalEnv);
    vi.useRealTimers();
  });

  it('returns 500 when TURN_SECRET is not configured', async () => {
    applyEnv({ TURN_SECRET: undefined, TURN_HOST: 'turn.example.com', TURN_REALM: 'example.com' });
    const app = await importApp();

    const response = await request(app).get('/ice').expect(500);

    expect(response.body).toEqual({ error: 'TURN_SECRET not set' });
  });

  it('generates ephemeral credentials and ice servers using HMAC', async () => {
    applyEnv({
      TURN_SECRET: 'test-secret',
      TURN_HOST: 'turn.test.example',
      TURN_REALM: 'test.example',
      ICE_TTL_SEC: '86400',
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    const app = await importApp();

    const response = await request(app).get('/ice?uid=test-user').expect(200);

    const body = response.body as {
      username: string;
      credential: string;
      realm: string;
      ttl: number;
      iceServers: Array<{ urls: string[]; username?: string; credential?: string }>;
    };

    expect(body.realm).toBe('test.example');
    expect(body.ttl).toBe(86400);
    expect(body.username).toBe('1704153600:test-user');
    expect(body.credential).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(body.iceServers).toHaveLength(2);
    expect(body.iceServers[0].urls).toEqual([
      'stun:turn.test.example:3478',
      'stun:turn.test.example:80',
    ]);
    expect(body.iceServers[1]).toEqual({
      urls: [
        'turn:turn.test.example:3478?transport=udp',
        'turn:turn.test.example:3478?transport=tcp',
        'turns:turn.test.example:443?transport=tcp',
      ],
      username: '1704153600:test-user',
      credential: body.credential,
    });
  });

  it('caches responses per uid for five minutes', async () => {
    applyEnv({
      TURN_SECRET: 'cache-secret',
      TURN_HOST: 'turn.cache.example',
      TURN_REALM: 'cache.example',
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-05-01T12:00:00.000Z'));

    const app = await importApp();

    const first = await request(app).get('/ice?uid=user-a').expect(200);
    const second = await request(app).get('/ice?uid=user-a').expect(200);
    const third = await request(app).get('/ice?uid=user-b').expect(200);

    expect(first.body.credential).toBe(second.body.credential);
    expect(second.body.username).toBe('1714651200:user-a');
    expect(third.body.username).toBe('1714651200:user-b');
    expect(third.body.credential).not.toBe(first.body.credential);
  });
});
