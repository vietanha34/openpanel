/**
 * Integration tests for POST /track/batch.
 *
 * Auth is real (validateSdkRequest) with a mocked client row, so the trust
 * boundary checks that read the body — the project's profile-id filter and the
 * revenue guard — are exercised through the route. Ingestion side effects
 * (queue, geo, session store) are mocked; nothing is written.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const add = vi.fn();

vi.mock('@openpanel/queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openpanel/queue')>()),
  getEventsGroupQueueShard: () => ({ add }),
  shouldUseKafka: () => false,
}));

vi.mock('@openpanel/geo', () => ({
  getGeoLocation: async () => ({ country: 'SE' }),
  getAsnInfo: async () => ({}),
}));

vi.mock('@/utils/ids', () => ({
  getDeviceId: async () => ({ deviceId: 'dev-1', sessionId: 'sess-1' }),
  getBatchDeviceIds: async ({ eventTimesMs }: { eventTimesMs: number[] }) =>
    eventTimesMs.map(() => ({ deviceId: 'dev-1', sessionId: 'sess-1' })),
}));

vi.mock('@openpanel/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openpanel/db')>()),
  getClientByIdCached: vi.fn(),
  getSalts: async () => ({ current: 'salt-a', previous: 'salt-b' }),
}));

vi.mock('@openpanel/common/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openpanel/common/server')>()),
  verifyPassword: vi.fn().mockResolvedValue(true),
}));

vi.mock('@openpanel/redis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openpanel/redis')>();
  const fake = new Proxy(
    {},
    {
      get: (_t, p) =>
        p === 'status' ? 'ready' : vi.fn().mockResolvedValue(null),
    }
  );
  return {
    ...actual,
    getLock: vi.fn().mockResolvedValue(true),
    getCache: async <T>(_k: string, _t: number, fn: () => Promise<T>) => fn(),
    getRedisCache: vi.fn().mockReturnValue(fake),
  };
});

import { ClientType, getClientByIdCached } from '@openpanel/db';
import { MAX_TRACK_BATCH_SIZE } from '@openpanel/validation';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';

const CLIENT_ID = '00000000-0000-0000-0000-000000000099';
const CLIENT_SECRET = 'test-secret';

const client = (projectOverrides: Record<string, unknown> = {}) =>
  ({
    id: CLIENT_ID,
    type: ClientType.write,
    projectId: 'proj-1',
    organizationId: 'org-1',
    secret: 'hashed-secret',
    name: 'Test Client',
    cors: null,
    description: '',
    ignoreCorsAndSecret: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    project: {
      id: 'proj-1',
      filters: [],
      cors: null,
      allowUnsafeRevenueTracking: false,
      ...projectOverrides,
    },
  }) as any;

let app: FastifyInstance;

beforeEach(async () => {
  add.mockReset();
  add.mockResolvedValue(undefined);
  vi.mocked(getClientByIdCached).mockResolvedValue(client());
  if (!app) {
    app = await buildApp({ testing: true });
    await app.ready();
  }
}, 30_000);

const post = (payload: unknown, secret = true) =>
  app.inject({
    method: 'POST',
    url: '/track/batch',
    headers: {
      'openpanel-client-id': CLIENT_ID,
      ...(secret ? { 'openpanel-client-secret': CLIENT_SECRET } : {}),
      'user-agent': 'Mozilla/5.0 Chrome/148.0.0.0',
      'content-type': 'application/json',
    },
    payload: payload as any,
  });

const trackEvent = (properties?: Record<string, unknown>) => ({
  type: 'track',
  payload: { name: 'page_view', properties },
});

describe('POST /track/batch', () => {
  it('accepts a batch of track events', async () => {
    const res = await post([trackEvent(), trackEvent()]);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accepted: 2, failed: [] });
    expect(add).toHaveBeenCalledTimes(2);
  });

  it('rejects a body that is not an array', async () => {
    const res = await post(trackEvent());

    expect(res.statusCode).toBe(400);
    expect(add).not.toHaveBeenCalled();
  });

  it('rejects an empty batch', async () => {
    const res = await post([]);

    expect(res.statusCode).toBe(400);
  });

  it(`rejects a batch larger than ${MAX_TRACK_BATCH_SIZE}`, async () => {
    const res = await post(
      Array.from({ length: MAX_TRACK_BATCH_SIZE + 1 }, () => trackEvent())
    );

    expect(res.statusCode).toBe(400);
    expect(add).not.toHaveBeenCalled();
  });

  it('refuses revenue in a batch when the client secret is not verified', async () => {
    const res = await post([trackEvent({ __revenue: 100 })], false);

    expect(res.statusCode).toBe(401);
    expect(add).not.toHaveBeenCalled();
  });

  it("refuses a batch carrying a profile id the project filters out", async () => {
    vi.mocked(getClientByIdCached).mockResolvedValue(
      client({ filters: [{ type: 'profile_id', profileId: 'blocked-1' }] })
    );

    const res = await post([
      { type: 'track', payload: { name: 'page_view', profileId: 'blocked-1' } },
    ]);

    expect(res.statusCode).toBe(401);
    expect(add).not.toHaveBeenCalled();
  });
});
