/**
 * Tests for handlerBatch — POST /track/batch.
 *
 * The point of the endpoint is that every event keeps its OWN timestamp
 * (`properties.__timestamp`) instead of all of them inheriting the moment the
 * request arrived, so that is what these assert on. A malformed item must not
 * take the rest of the batch down with it.
 */

import type { ITrackPayload } from '@openpanel/validation';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const add = vi.fn();

vi.mock('@openpanel/queue', () => ({
  getEventsGroupQueueShard: () => ({ add }),
  shouldUseKafka: () => false,
  produceIncomingEvent: vi.fn(),
}));

vi.mock('@openpanel/geo', () => ({
  getGeoLocation: async () => ({ country: 'SE', city: 'Stockholm' }),
  getAsnInfo: async () => ({}),
}));

vi.mock('@openpanel/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@openpanel/db')>()),
  getSalts: async () => ({ current: 'salt-a', previous: 'salt-b' }),
}));

vi.mock('@/utils/ids', () => ({
  getDeviceId: async () => ({ deviceId: 'dev-1', sessionId: 'sess-1' }),
  getBatchDeviceIds: async ({ eventTimesMs }: { eventTimesMs: number[] }) =>
    eventTimesMs.map((_, i) => ({
      deviceId: 'dev-1',
      sessionId: `sess-${i + 1}`,
    })),
}));

const { handlerBatch } = await import('./track.controller');

const NOW = Date.now();
const MINUTE = 60_000;

const event = (name: string, at: number): { type: 'track'; payload: ITrackPayload } => ({
  type: 'track',
  payload: {
    name,
    properties: { __timestamp: new Date(at).toISOString() },
  },
});

const makeRequest = (body: unknown) =>
  ({
    body,
    client: { projectId: 'proj-1' },
    clientIp: '1.2.3.4',
    clientSecretAuth: false,
    timestamp: NOW,
    headers: { 'user-agent': 'Mozilla/5.0 Chrome/148.0.0.0' },
  }) as unknown as FastifyRequest<{ Body: unknown }>;

type FakeReply = FastifyReply & {
  status: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
};

const makeReply = (): FakeReply => {
  const reply: Record<string, unknown> = {};
  reply.status = vi.fn(() => reply);
  reply.send = vi.fn(() => reply);
  return reply as unknown as FakeReply;
};

const queuedOrderMs = () => add.mock.calls.map(([job]) => job.orderMs);
const queuedNames = () =>
  add.mock.calls.map(([job]) => job.data.event.name);

describe('handlerBatch', () => {
  beforeEach(() => {
    add.mockReset();
    add.mockResolvedValue(undefined);
  });

  it('queues each event under its own __timestamp, not the request time', async () => {
    const first = NOW - 10 * MINUTE;
    const second = NOW - 4 * MINUTE;

    await handlerBatch(
      makeRequest([event('a', first), event('b', second)]),
      makeReply()
    );

    expect(queuedOrderMs()).toEqual([first, second]);
    expect(
      add.mock.calls.map(([job]) => job.data.event.timestamp)
    ).toEqual([first, second]);
  });

  it('queues the batch in timestamp order even when the client sends it shuffled', async () => {
    const early = NOW - 12 * MINUTE;
    const late = NOW - 2 * MINUTE;

    await handlerBatch(
      makeRequest([event('late', late), event('early', early)]),
      makeReply()
    );

    expect(queuedNames()).toEqual(['early', 'late']);
  });

  it('falls back to the request time for an event without __timestamp', async () => {
    await handlerBatch(
      makeRequest([{ type: 'track', payload: { name: 'no-ts' } }]),
      makeReply()
    );

    expect(queuedOrderMs()).toEqual([NOW]);
  });

  it('accepts the valid items and reports the invalid ones by index', async () => {
    const reply = makeReply();

    await handlerBatch(
      makeRequest([
        event('a', NOW - 3 * MINUTE),
        { type: 'track', payload: { name: '' } },
        event('c', NOW - MINUTE),
      ]),
      reply
    );

    expect(queuedNames()).toEqual(['a', 'c']);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({
        accepted: 2,
        failed: [expect.objectContaining({ index: 1 })],
      })
    );
  });

  it('rejects a non-track item instead of silently dropping it', async () => {
    const reply = makeReply();

    await handlerBatch(
      makeRequest([{ type: 'identify', payload: { profileId: 'p1' } }]),
      reply
    );

    expect(add).not.toHaveBeenCalled();
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ accepted: 0 })
    );
  });

  it('answers with the device and session of the newest event', async () => {
    const reply = makeReply();

    await handlerBatch(
      makeRequest([event('a', NOW - 5 * MINUTE), event('b', NOW - MINUTE)]),
      reply
    );

    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ deviceId: 'dev-1', sessionId: 'sess-2' })
    );
  });
});
