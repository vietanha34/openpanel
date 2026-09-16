/**
 * Integration test for the event analytics tree (T8).
 *
 * Runs the four service methods against a real ClickHouse and compares them
 * with the hand-computed blueprint in `event-analytics-fixtures.ts`. Skipped
 * when ClickHouse is not reachable at CLICKHOUSE_URL.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ch } from '../clickhouse/client';
import {
  EVENT_ANALYTICS_BLUEPRINT,
  EVENT_ANALYTICS_FIXTURE,
  setupEventAnalyticsFixtures,
  teardownEventAnalyticsFixtures,
} from './event-analytics-fixtures';
import { overviewService } from './overview.service';

const projectId = 'test-event-analytics-t8';

const range = {
  projectId,
  filters: [],
  ...EVENT_ANALYTICS_FIXTURE.range,
};

let chReachable = false;

beforeAll(async () => {
  try {
    await ch.command({ query: 'SELECT 1' });
    chReachable = true;
  } catch {
    chReachable = false;
    return;
  }
  await setupEventAnalyticsFixtures(projectId);
});

afterAll(async () => {
  if (chReachable) {
    await teardownEventAnalyticsFixtures(projectId);
  }
});

describe('event analytics list', () => {
  it('reports the hand-computed events and users per event', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows, nextCursor } = await overviewService.getEventAnalyticsList({
      ...range,
      sort: 'events',
      dir: 'desc',
      limit: 10,
    });

    expect(rows).toEqual(EVENT_ANALYTICS_BLUEPRINT.list);
    expect(nextCursor).toBeNull();
  });

  it('pages with a cursor that resumes exactly where the page stopped', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const first = await overviewService.getEventAnalyticsList({
      ...range,
      sort: 'events',
      dir: 'desc',
      limit: 2,
    });

    expect(first.rows).toEqual(EVENT_ANALYTICS_BLUEPRINT.list.slice(0, 2));
    expect(first.nextCursor).toBe(2);

    const second = await overviewService.getEventAnalyticsList({
      ...range,
      sort: 'events',
      dir: 'desc',
      limit: 2,
      cursor: first.nextCursor ?? 0,
    });

    expect(second.rows).toEqual(EVENT_ANALYTICS_BLUEPRINT.list.slice(2));
    expect(second.nextCursor).toBeNull();
  });

  it('sorts ascending by users when asked', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventAnalyticsList({
      ...range,
      sort: 'users',
      dir: 'asc',
      limit: 10,
    });

    // users asc, name asc as the tie-breaker: 1, 2, 2, 4
    expect(rows.map((row) => row.name)).toEqual([
      'booster_use',
      'ads_inter_shown',
      'level_finish',
      'level_start',
    ]);
  });
});

describe('event analytics totals', () => {
  it('deduplicates users instead of summing the branches', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const totals = await overviewService.getEventAnalyticsTotals(range);
    const summedBranchUsers = EVENT_ANALYTICS_BLUEPRINT.list.reduce(
      (sum, row) => sum + row.users,
      0
    );

    expect(totals).toEqual(EVENT_ANALYTICS_BLUEPRINT.totals);
    // The whole point of the separate totals query: users overlap between
    // events, so the deduplicated union is strictly smaller than the sum.
    expect(summedBranchUsers).toBe(EVENT_ANALYTICS_BLUEPRINT.summedBranchUsers);
    expect(totals.users).toBeLessThan(summedBranchUsers);
    // Events, unlike users, are disjoint per event and must still add up.
    expect(
      EVENT_ANALYTICS_BLUEPRINT.list.reduce((sum, row) => sum + row.events, 0)
    ).toBe(totals.events);
  });
});

describe('event property keys', () => {
  it('counts an event once per object, not once per key below it', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows, nextCursor } = await overviewService.getEventPropertyKeys({
      ...range,
      event: 'level_start',
      prefix: '',
      parentPath: [],
      limit: 20,
    });

    // All 8 level_start rows carry all three top-level keys. Counting keys
    // instead of events would report 17 for `payload`.
    expect(rows).toEqual([
      { key: 'level_id', events: 8, users: 4, kind: 'key', type: 'num' },
      { key: 'level_mode', events: 8, users: 4, kind: 'key', type: 'str' },
      { key: 'payload', events: 8, users: 4, kind: 'obj', type: 'unknown' },
    ]);
    expect(nextCursor).toBeNull();
  });

  it('infers num vs str from the values of each leaf key', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventPropertyKeys({
      ...range,
      event: 'level_finish',
      prefix: '',
      parentPath: [],
      limit: 20,
    });

    // Both keys sit on all 3 events; `grade` carries `gold`, `stars` does not.
    expect(rows).toEqual([
      { key: 'grade', events: 3, users: 2, kind: 'key', type: 'str' },
      { key: 'stars', events: 3, users: 2, kind: 'key', type: 'num' },
    ]);
  });

  it('lists the keys one level below a prefix', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventPropertyKeys({
      ...range,
      event: 'level_start',
      prefix: 'payload.',
      parentPath: [],
      limit: 20,
    });

    expect(rows).toEqual([
      { key: 'source', events: 8, users: 4, kind: 'key', type: 'str' },
      { key: 'lives_left', events: 4, users: 4, kind: 'key', type: 'num' },
      { key: 'session_index', events: 4, users: 2, kind: 'key', type: 'num' },
      // `payload.meta.ab.group` has segments left below `meta`.
      { key: 'meta', events: 1, users: 1, kind: 'obj', type: 'unknown' },
    ]);
  });

  it('pages keys with a cursor', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const first = await overviewService.getEventPropertyKeys({
      ...range,
      event: 'level_start',
      prefix: 'payload.',
      parentPath: [],
      limit: 2,
    });

    expect(first.rows.map((row) => row.key)).toEqual(['source', 'lives_left']);
    expect(first.nextCursor).toBe(2);

    const second = await overviewService.getEventPropertyKeys({
      ...range,
      event: 'level_start',
      prefix: 'payload.',
      parentPath: [],
      limit: 2,
      cursor: first.nextCursor ?? 0,
    });

    expect(second.rows.map((row) => row.key)).toEqual([
      'session_index',
      'meta',
    ]);
    expect(second.nextCursor).toBeNull();
  });
});

describe('event property values', () => {
  it('orders numeric values numerically, not lexicographically', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows, remaining, nextCursor } =
      await overviewService.getEventPropertyValues({
        ...range,
        event: 'level_start',
        key: 'level_id',
        type: 'num',
        parentPath: [],
        sort: 'events',
        dir: 'desc',
        limit: 10,
      });

    // events desc, then the numeric value ascending as the tie-breaker.
    // A string tie-break would put '10' before '2'.
    expect(rows).toEqual([
      { value: '2', events: 3, users: 3 },
      { value: '10', events: 3, users: 3 },
      { value: '3', events: 1, users: 1 },
      { value: '9', events: 1, users: 1 },
    ]);
    expect(remaining).toBe(0);
    expect(nextCursor).toBeNull();
  });

  it('reports remaining and a cursor while a page is left', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const first = await overviewService.getEventPropertyValues({
      ...range,
      event: 'level_start',
      key: 'level_id',
      type: 'num',
      parentPath: [],
      sort: 'events',
      dir: 'desc',
      limit: 2,
    });

    expect(first.rows.map((row) => row.value)).toEqual(['2', '10']);
    // 4 distinct level_id values, 2 consumed.
    expect(first.remaining).toBe(2);
    expect(first.nextCursor).toBe(2);

    const second = await overviewService.getEventPropertyValues({
      ...range,
      event: 'level_start',
      key: 'level_id',
      type: 'num',
      parentPath: [],
      sort: 'events',
      dir: 'desc',
      limit: 2,
      cursor: first.nextCursor ?? 0,
    });

    expect(second.rows.map((row) => row.value)).toEqual(['3', '9']);
    expect(second.remaining).toBe(0);
    expect(second.nextCursor).toBeNull();
  });
});

describe('four levels below the event', () => {
  it('drills event -> key -> value -> nested key -> value', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    // Level 1: the key under the event.
    const keys = await overviewService.getEventPropertyKeys({
      ...range,
      event: 'level_start',
      prefix: '',
      parentPath: [],
      limit: 20,
    });
    expect(keys.rows.find((row) => row.key === 'level_mode')?.type).toBe('str');

    // Level 2: its values.
    const modes = await overviewService.getEventPropertyValues({
      ...range,
      event: 'level_start',
      key: 'level_mode',
      type: 'str',
      parentPath: [],
      sort: 'events',
      dir: 'desc',
      limit: 10,
    });
    expect(modes.rows).toEqual([
      { value: 'classic', events: 4, users: 3 },
      { value: 'hard', events: 4, users: 4 },
    ]);

    // Level 3: nested keys under `level_mode = hard`. parentPath carries a
    // single entry, the contract's maximum.
    const parentPath = [{ key: 'level_mode', value: 'hard' }];
    const nestedKeys = await overviewService.getEventPropertyKeys({
      ...range,
      event: 'level_start',
      prefix: 'payload.',
      parentPath,
      limit: 20,
    });
    expect(nestedKeys.rows).toEqual([
      { key: 'lives_left', events: 4, users: 4, kind: 'key', type: 'num' },
      { key: 'source', events: 4, users: 4, kind: 'key', type: 'str' },
      { key: 'session_index', events: 2, users: 2, kind: 'key', type: 'num' },
      { key: 'meta', events: 1, users: 1, kind: 'obj', type: 'unknown' },
    ]);

    // Level 4: values of that nested key, still under `level_mode = hard`.
    const nestedValues = await overviewService.getEventPropertyValues({
      ...range,
      event: 'level_start',
      key: 'payload.lives_left',
      type: 'num',
      parentPath,
      sort: 'events',
      dir: 'desc',
      limit: 10,
    });
    expect(nestedValues.rows).toEqual([
      { value: '5', events: 3, users: 3 },
      { value: '3', events: 1, users: 1 },
    ]);
  });

  it('refuses to go deeper than the contract allows', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    await expect(
      overviewService.getEventPropertyKeys({
        ...range,
        event: 'level_start',
        prefix: 'payload.',
        parentPath: [
          { key: 'level_mode', value: 'hard' },
          { key: 'payload.lives_left', value: '5' },
        ],
        limit: 20,
      })
    ).rejects.toThrow(/limited to/);
  });
});
