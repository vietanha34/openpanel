/**
 * Property keys and values in comparison mode, executed against ClickHouse.
 *
 * These exist because the SQL-shape tests could not have caught the bug they
 * pin: the generated string looked right, and only the server rejected it
 * (`Code: 47 Unknown expression or function identifier created_at`). Opening a
 * property node while comparison was on failed for every user.
 */

process.env.TZ = 'UTC';

import type { IEventAnalyticsMetric } from '@openpanel/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ch } from '../clickhouse/client';
import {
  EVENT_ANALYTICS_FIXTURE,
  setupEventAnalyticsFixtures,
  teardownEventAnalyticsFixtures,
} from './event-analytics-fixtures';
import { overviewService } from './overview.service';

const projectId = 'test-event-analytics-property-periods';

const range = {
  projectId,
  filters: [],
  ...EVENT_ANALYTICS_FIXTURE.range,
};

const periods = [...EVENT_ANALYTICS_FIXTURE.periods];
const comparisonRange = { ...range, periods };

const METRICS: IEventAnalyticsMetric[] = [
  { id: 'events' },
  { id: 'sum_param', param: 'level_id' },
];

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
}, 60_000);

afterAll(async () => {
  if (chReachable) {
    await teardownEventAnalyticsFixtures(projectId);
  }
}, 60_000);

describe('property keys with periods', () => {
  it('runs at all, and splits every key per period', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventPropertyKeys({
      ...comparisonRange,
      event: 'level_start',
      prefix: '',
      parentPath: [],
      limit: 20,
      metrics: METRICS,
    });
    const levelId = rows.find((row) => row.key === 'level_id');

    // A: all 8 level_start rows carry level_id. B: 4 rows. C: 1 row.
    expect(levelId?.periods?.[0]).toMatchObject({ events: 8, users: 4 });
    expect(levelId?.periods?.[1]).toMatchObject({ events: 4, users: 3 });
    expect(levelId?.periods?.[2]).toMatchObject({ events: 1, users: 1 });
  });

  it('repeats period A in the top-level fields', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const compared = await overviewService.getEventPropertyKeys({
      ...comparisonRange,
      event: 'level_start',
      prefix: '',
      parentPath: [],
      limit: 20,
      metrics: METRICS,
    });
    const single = await overviewService.getEventPropertyKeys({
      ...range,
      event: 'level_start',
      prefix: '',
      parentPath: [],
      limit: 20,
      metrics: METRICS,
    });

    const byKey = (rows: typeof single.rows) =>
      Object.fromEntries(rows.map((row) => [row.key, row.events]));

    expect(byKey(compared.rows)).toEqual(byKey(single.rows));
  });

  it('orders by period A, not by a column that no longer exists', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventPropertyKeys({
      ...comparisonRange,
      event: 'level_start',
      prefix: '',
      parentPath: [],
      limit: 20,
    });
    const events = rows.map((row) => row.periods?.[0]?.events ?? 0);

    expect(events).toEqual([...events].sort((a, b) => b - a));
  });

  it('keeps a key the baseline period never saw out of the rows', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    // `payload.lives_left` exists in A, so it stays; a key only B carries must
    // not appear — the row set follows period A (spec §3 D1).
    const { rows } = await overviewService.getEventPropertyKeys({
      ...comparisonRange,
      event: 'tutorial_step',
      prefix: '',
      parentPath: [],
      limit: 20,
    });

    // tutorial_step fires only in B, so period A has no keys at all.
    expect(rows).toEqual([]);
  });
});

describe('property values with periods', () => {
  it('runs at all, and splits every value per period', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventPropertyValues({
      ...comparisonRange,
      event: 'level_start',
      key: 'level_id',
      type: 'num',
      parentPath: [],
      sort: 'events',
      dir: 'desc',
      limit: 10,
      metrics: METRICS,
    });
    const ten = rows.find((row) => row.value === '10');

    // level_id = 10 fires three times in A (u1, u2, u3) and once in C.
    expect(ten?.periods?.[0]).toMatchObject({ events: 3 });
    expect(ten?.periods?.[1]).toMatchObject({ events: 1 });
  });

  it('repeats period A in the top-level fields', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const compared = await overviewService.getEventPropertyValues({
      ...comparisonRange,
      event: 'level_start',
      key: 'level_id',
      type: 'num',
      parentPath: [],
      sort: 'events',
      dir: 'desc',
      limit: 10,
    });
    const single = await overviewService.getEventPropertyValues({
      ...range,
      event: 'level_start',
      key: 'level_id',
      type: 'num',
      parentPath: [],
      sort: 'events',
      dir: 'desc',
      limit: 10,
    });

    const byValue = (rows: typeof single.rows) =>
      Object.fromEntries(rows.map((row) => [row.value, row.events]));

    expect(byValue(compared.rows)).toEqual(byValue(single.rows));
  });

  it('keeps a value only a later period saw out of the rows', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventPropertyValues({
      ...comparisonRange,
      event: 'level_start',
      key: 'level_id',
      type: 'num',
      parentPath: [],
      sort: 'events',
      dir: 'desc',
      limit: 10,
    });

    // level_id 4 and 7 are period B only; A never saw them.
    expect(rows.map((row) => row.value)).not.toContain('4');
    expect(rows.map((row) => row.value)).not.toContain('7');
  });
});
