/**
 * Integration test for comparison mode (T9).
 *
 * Runs the event analytics services with `input.periods` against a real
 * ClickHouse and compares each period with the hand-computed blueprint in
 * `event-analytics-fixtures.ts`. Skipped when ClickHouse is unreachable.
 *
 * Spec: docs/superpowers/specs/2026-09-18-event-analytics-phase3-design.md
 * §3 D1 (rows are chosen by period A), §3 D2 (users are counted per period and
 * never added), §4 (the top-level fields repeat period A).
 */

import type { IEventAnalyticsMetric } from '@openpanel/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ch } from '../clickhouse/client';
import {
  EVENT_ANALYTICS_BLUEPRINT,
  EVENT_ANALYTICS_FIXTURE,
  setupEventAnalyticsBoundaryFixture,
  setupEventAnalyticsFixtures,
  teardownEventAnalyticsFixtures,
} from './event-analytics-fixtures';
import { overviewService } from './overview.service';

const projectId = 'test-event-analytics-t9';

const periods = [...EVENT_ANALYTICS_FIXTURE.periods];

/** Period A alone, which is the range every T8/P8 assertion already uses. */
const range = {
  projectId,
  filters: [],
  ...EVENT_ANALYTICS_FIXTURE.range,
};

/** The same three days asked for as ONE range, for the union counter-check. */
const unionRange = {
  projectId,
  filters: [],
  ...EVENT_ANALYTICS_FIXTURE.unionRange,
};

const comparisonRange = { ...range, periods };

const PARAM_METRICS: IEventAnalyticsMetric[] = [
  { id: 'events' },
  { id: 'sum_param', param: 'level_id' },
  { id: 'avg_param', param: 'level_id' },
  { id: 'sum_param', param: 'payload.lives_left' },
  { id: 'avg_param', param: 'payload.lives_left' },
];

const blueprint = EVENT_ANALYTICS_BLUEPRINT.periods;

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
  // Two tables plus the synchronous delete before them run past vitest's 10s
  // default whenever the local ClickHouse is under load from the rest of the
  // suite.
}, 60_000);

afterAll(async () => {
  if (chReachable) {
    await teardownEventAnalyticsFixtures(projectId);
  }
}, 60_000);

describe('users across periods', () => {
  it('counts a user in every period they fired in, and never adds the counts up', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventAnalyticsList({
      ...comparisonRange,
      sort: 'events',
      dir: 'desc',
      limit: 10,
    });
    const levelStart = rows.find((row) => row.name === 'level_start');

    expect(levelStart?.periods?.map((period) => period.users)).toEqual([4, 3, 1]);

    // u1 and u2 fire in A and B, u4 in A and C. Each period counts them, so
    // the sum double counts: the same query over the three days as ONE range
    // reports strictly fewer users.
    const summedPeriodUsers = (levelStart?.periods ?? []).reduce(
      (sum, period) => sum + period.users,
      0
    );
    const { rows: unionRows } = await overviewService.getEventAnalyticsList({
      ...unionRange,
      sort: 'events',
      dir: 'desc',
      limit: 10,
    });
    const unionLevelStart = unionRows.find((row) => row.name === 'level_start');

    expect(summedPeriodUsers).toBe(8); // 4 + 3 + 1
    expect(unionLevelStart?.users).toBe(blueprint.union.levelStartUsers);
    expect(unionLevelStart?.users).toBeLessThan(summedPeriodUsers);
    // The union's event count, unlike its user count, IS the sum: events are
    // disjoint in time, users are not.
    expect(unionLevelStart?.events).toBe(8 + 4 + 1);
  });

  it('keeps the totals row deduplicated inside each period', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const totals = await overviewService.getEventAnalyticsTotals(comparisonRange);
    const unionTotals = await overviewService.getEventAnalyticsTotals(unionRange);

    expect(totals.periods?.map((period) => period.events)).toEqual(
      blueprint.totals.map((period) => period.events)
    );
    expect(totals.periods?.map((period) => period.users)).toEqual(
      blueprint.totals.map((period) => period.users)
    );

    const summedPeriodUsers = (totals.periods ?? []).reduce(
      (sum, period) => sum + period.users,
      0
    );
    expect(summedPeriodUsers).toBe(10); // 5 + 4 + 1
    expect(unionTotals.users).toBe(blueprint.union.totalsUsers);
    expect(unionTotals.users).toBeLessThan(summedPeriodUsers);
  });
});

describe('per-period numbers', () => {
  it('matches the hand-computed events, users and epu of each period', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventAnalyticsList({
      ...comparisonRange,
      sort: 'events',
      dir: 'desc',
      limit: 10,
    });
    const levelStart = rows.find((row) => row.name === 'level_start');

    expect(levelStart?.periods?.map((period) => period.events)).toEqual([8, 4, 1]);
    expect(levelStart?.periods?.map((period) => period.users)).toEqual([4, 3, 1]);
    // `epu` is derived in the renderer, from each period's own two numbers.
    expect(
      levelStart?.periods?.map((period) => period.events / period.users)
    ).toEqual([2, 4 / 3, 1]);
  });

  it('keeps the missing-parameter rule inside every period', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventAnalyticsList({
      ...comparisonRange,
      sort: 'events',
      dir: 'desc',
      limit: 10,
      metrics: PARAM_METRICS,
    });
    const levelStart = rows.find((row) => row.name === 'level_start');

    expect(
      levelStart?.periods?.map((period) => period.metrics?.['sum_param:level_id'])
    ).toEqual(blueprint.levelStart.map((period) => period.sum_level_id));
    expect(
      levelStart?.periods?.map((period) => period.metrics?.['avg_param:level_id'])
    ).toEqual(blueprint.levelStart.map((period) => period.avg_level_id));

    expect(
      levelStart?.periods?.map(
        (period) => period.metrics?.['sum_param:payload.lives_left']
      )
    ).toEqual(blueprint.levelStart.map((period) => period.sum_lives_left));
    // Phase 2 D4 on the period axis: B has 4 events and only 2 carry the
    // parameter, so the average is 4/4 = 1, not 4/2 = 2.
    expect(
      levelStart?.periods?.map(
        (period) => period.metrics?.['avg_param:payload.lives_left']
      )
    ).toEqual(blueprint.levelStart.map((period) => period.avg_lives_left));
    expect(
      levelStart?.periods?.[1]?.metrics?.['avg_param:payload.lives_left']
    ).toBe(1);
  });

  it('repeats period A in the top-level fields', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventAnalyticsList({
      ...comparisonRange,
      sort: 'events',
      dir: 'desc',
      limit: 10,
      metrics: PARAM_METRICS,
    });
    const totals = await overviewService.getEventAnalyticsTotals({
      ...comparisonRange,
      metrics: PARAM_METRICS,
    });
    const levelStart = rows.find((row) => row.name === 'level_start');

    // A reader that knows nothing about periods must see the baseline, never a
    // number summed across them (§4).
    expect(levelStart?.events).toBe(levelStart?.periods?.[0]?.events);
    expect(levelStart?.users).toBe(levelStart?.periods?.[0]?.users);
    expect(levelStart?.metrics).toEqual(levelStart?.periods?.[0]?.metrics);
    expect(totals.events).toBe(totals.periods?.[0]?.events);
    expect(totals.users).toBe(totals.periods?.[0]?.users);
    expect(totals.metrics).toEqual(totals.periods?.[0]?.metrics);
  });
});

describe('the row set follows period A', () => {
  it('keeps an event that period A saw and the later periods did not', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventAnalyticsList({
      ...comparisonRange,
      sort: 'events',
      dir: 'desc',
      limit: 10,
      metrics: PARAM_METRICS,
    });
    const levelFinish = rows.find((row) => row.name === 'level_finish');

    // level_finish fires only in A, so the row stays and B and C read zero.
    expect(levelFinish?.periods?.[0]).toMatchObject({ events: 3, users: 2 });
    expect(levelFinish?.periods?.[1]).toMatchObject({ events: 0, users: 0 });
    expect(levelFinish?.periods?.[2]).toMatchObject({ events: 0, users: 0 });
    expect(levelFinish?.periods?.[1]?.metrics).toEqual({
      'sum_param:level_id': 0,
      'avg_param:level_id': 0,
      'sum_param:payload.lives_left': 0,
      'avg_param:payload.lives_left': 0,
    });
  });

  it('does not add a row for an event only a later period saw', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventAnalyticsList({
      ...comparisonRange,
      sort: 'events',
      dir: 'desc',
      limit: 10,
    });

    // §3 D1: the server picks the rows by period A and computes every period on
    // exactly that set. `tutorial_step` fires only in B, so it is not a row —
    // otherwise the table gains a line whose baseline column is blank.
    expect(rows.map((row) => row.name)).toEqual(
      EVENT_ANALYTICS_BLUEPRINT.list.map((row) => row.name)
    );
    expect(rows.map((row) => row.name)).not.toContain('tutorial_step');
  });

  it('orders and pages by period A', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const first = await overviewService.getEventAnalyticsList({
      ...comparisonRange,
      sort: 'events',
      dir: 'desc',
      limit: 2,
    });

    // The order is period A's, unchanged from the single-period suite, and the
    // limit counts A's rows.
    expect(first.rows.map((row) => row.name)).toEqual(
      EVENT_ANALYTICS_BLUEPRINT.list.slice(0, 2).map((row) => row.name)
    );
    expect(first.rows.map((row) => row.periods?.[0]?.events)).toEqual([8, 3]);
    expect(first.nextCursor).toBe(2);
  });
});

describe('period A is the same range with or without comparison', () => {
  /** Its own project: the 20:00 row would move the shared fixture's numbers. */
  const boundaryProjectId = 'test-event-analytics-t9-boundary';

  beforeAll(async () => {
    if (!chReachable) {
      return;
    }
    await setupEventAnalyticsBoundaryFixture(boundaryProjectId);
  }, 60_000);

  afterAll(async () => {
    if (chReachable) {
      await teardownEventAnalyticsFixtures(boundaryProjectId);
    }
  }, 60_000);

  it('reports the same events and users for period A either way', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const boundaryRange = {
      projectId: boundaryProjectId,
      filters: [],
      ...EVENT_ANALYTICS_FIXTURE.range,
    };
    const listArgs = { sort: 'events' as const, dir: 'desc' as const, limit: 10 };

    const single = await overviewService.getEventAnalyticsList({
      ...boundaryRange,
      ...listArgs,
    });
    const comparison = await overviewService.getEventAnalyticsList({
      // Period A carries exactly the startDate/endDate of the single-period
      // request above, so turning comparison on must not move its numbers.
      ...boundaryRange,
      periods: [...EVENT_ANALYTICS_FIXTURE.periods],
      ...listArgs,
    });

    const singleRow = single.rows.find((row) => row.name === 'tz_boundary');
    const baseline = comparison.rows.find((row) => row.name === 'tz_boundary')
      ?.periods?.[0];

    // §4: `periods[0]` IS period A. The two requests ask for the same days, so
    // any difference means the period conditions and the scanned range are not
    // reading the same clock.
    //
    // The fixture's 20:00 row is what exposes it: the outer range goes through
    // the datetime helper and lands on a timezone-shifted window, while the
    // per-period `*If` conditions are raw. On a machine already running UTC the
    // two agree and this assertion passes without having anything to catch —
    // it pins the invariant, not one machine's offset.
    expect(baseline?.events).toBe(singleRow?.events);
    expect(baseline?.users).toBe(singleRow?.users);

    // The 2024-03-01 row sits outside every period and must never be counted.
    const periodEvents = (
      comparison.rows.find((row) => row.name === 'tz_boundary')?.periods ?? []
    ).reduce((sum, period) => sum + period.events, 0);
    expect(periodEvents).toBe(2);
  });
});
