import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app } from '#server';

const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('POST /api/calls', () => {
  it('builds call URL using x-forwarded-proto and generates a UUID roomId', async () => {
    const response = await request(app)
      .post('/api/calls')
      .set('host', 'example.com')
      .set('x-forwarded-proto', 'https,http')
      .expect(200);

    const { roomId, url } = response.body as { roomId: string; url: string };

    expect(roomId).toMatch(uuidV4Regex);
    expect(url).toBe(`https://example.com/call/${roomId}`);
  });
});
