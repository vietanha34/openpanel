/**
 * Integration test for the event analytics tree (T8).
 *
 * Runs the four service methods against a real ClickHouse and compares them
 * with the hand-computed blueprint in `event-analytics-fixtures.ts`. Skipped
 * when ClickHouse is not reachable at CLICKHOUSE_URL.
 */

import type { IEventAnalyticsMetric } from '@openpanel/validation';
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
  // Seeding two tables plus the synchronous delete that precedes them runs past
  // vitest's 10s default whenever the local ClickHouse is under load from the
  // rest of the suite.
}, 60_000);

afterAll(async () => {
  if (chReachable) {
    await teardownEventAnalyticsFixtures(projectId);
  }
}, 60_000);

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

// --- Phase 2 metrics (P8) --------------------------------------------------
// Spec: docs/superpowers/specs/2026-09-16-event-analytics-phase2-design.md
// §5 lists one expression per metric; §3 D4 fixes the semantics that make the
// numbers below what they are: in a METRIC a missing or non-numeric parameter
// counts as 0, while in a FILTER it still matches nothing.

const LIVES_LEFT = 'payload.lives_left';

/** Every parameter metric of §5, over one parameter. */
function paramMetrics(param: string): IEventAnalyticsMetric[] {
  return [
    { id: 'events' },
    { id: 'uniq_param', param },
    { id: 'sum_param', param },
    { id: 'avg_param', param },
    { id: 'median_param', param },
    { id: 'uniq_param_user', param },
    { id: 'sum_param_user', param },
  ];
}

function expectedParamMetrics(
  param: string,
  blueprint: {
    uniq_param: number;
    sum_param: number;
    avg_param: number;
    median_param: number;
    uniq_param_user: number;
    sum_param_user: number;
  }
) {
  return {
    [`uniq_param:${param}`]: blueprint.uniq_param,
    [`sum_param:${param}`]: blueprint.sum_param,
    [`avg_param:${param}`]: blueprint.avg_param,
    [`median_param:${param}`]: blueprint.median_param,
    [`uniq_param_user:${param}`]: blueprint.uniq_param_user,
    [`sum_param_user:${param}`]: blueprint.sum_param_user,
  };
}

describe('metrics over a numeric parameter', () => {
  it('reads a missing parameter as 0 in every aggregate', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const blueprint = EVENT_ANALYTICS_BLUEPRINT.livesLeftOnLevelStart;
    const { rows } = await overviewService.getEventAnalyticsList({
      ...range,
      sort: 'events',
      dir: 'desc',
      limit: 10,
      metrics: paramMetrics(LIVES_LEFT),
    });
    const levelStart = rows.find((row) => row.name === 'level_start');

    expect(levelStart?.events).toBe(blueprint.events);
    expect(levelStart?.users).toBe(blueprint.users);
    expect(levelStart?.metrics).toEqual(
      expectedParamMetrics(LIVES_LEFT, blueprint)
    );

    // Spelled out, because these three are the whole point of D4.
    // 4 of the 8 level_start events have no `payload.lives_left`.
    const carryingTheParameter = 4;
    // Averaging over only the events that carry it would give 4.5.
    expect(blueprint.sum_param / carryingTheParameter).toBe(4.5);
    expect(levelStart?.metrics?.[`avg_param:${LIVES_LEFT}`]).toBe(2.25);
    expect(levelStart?.metrics?.[`avg_param:${LIVES_LEFT}`]).toBeLessThan(4.5);
    // The distinct set is {0, 3, 5}: the missing events contribute the 0.
    expect(levelStart?.metrics?.[`uniq_param:${LIVES_LEFT}`]).toBe(3);
    // The median is taken over a set that includes those zeros.
    expect(levelStart?.metrics?.[`median_param:${LIVES_LEFT}`]).toBe(3);
  });

  it('drops the extra distinct value once no event is missing the parameter', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const blueprint = EVENT_ANALYTICS_BLUEPRINT.livesLeftUnderHard;
    // Every `level_mode = hard` event carries `payload.lives_left`.
    const { rows } = await overviewService.getEventPropertyValues({
      ...range,
      event: 'level_start',
      key: 'level_mode',
      type: 'str',
      parentPath: [],
      sort: 'events',
      dir: 'desc',
      limit: 10,
      metrics: paramMetrics(LIVES_LEFT),
    });
    const hard = rows.find((row) => row.value === 'hard');
    const classic = rows.find((row) => row.value === 'classic');

    expect(hard?.events).toBe(blueprint.events);
    expect(hard?.metrics).toEqual(expectedParamMetrics(LIVES_LEFT, blueprint));
    // 2 here against 3 on the event row above: the difference is exactly the
    // zero that the missing `classic` events add to the event-level set.
    expect(hard?.metrics?.[`uniq_param:${LIVES_LEFT}`]).toBe(2);
    expect(
      EVENT_ANALYTICS_BLUEPRINT.livesLeftOnLevelStart.uniq_param
    ).toBe(3);

    // No `classic` event carries the parameter, so every aggregate is 0 and
    // the distinct set is the single value {0}.
    expect(classic?.metrics?.[`sum_param:${LIVES_LEFT}`]).toBe(0);
    expect(classic?.metrics?.[`avg_param:${LIVES_LEFT}`]).toBe(0);
    expect(classic?.metrics?.[`median_param:${LIVES_LEFT}`]).toBe(0);
    expect(classic?.metrics?.[`uniq_param:${LIVES_LEFT}`]).toBe(1);
  });

  it('serves metrics on property key rows too', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventPropertyKeys({
      ...range,
      event: 'level_start',
      prefix: '',
      parentPath: [],
      limit: 20,
      metrics: [
        { id: 'events' },
        { id: 'sum_param', param: 'level_id' },
        { id: 'avg_param', param: 'level_id' },
      ],
    });

    // Every level_start event carries `level_id`, and every one of them also
    // carries each of the three top-level segments, so each key row sums the
    // whole event's level_id set.
    for (const row of rows) {
      expect(row.metrics?.['sum_param:level_id']).toBe(
        EVENT_ANALYTICS_BLUEPRINT.levelIdSumByEvent.level_start
      );
      expect(row.metrics?.['avg_param:level_id']).toBe(48 / 8);
    }
  });
});

describe('metrics over a non-numeric parameter', () => {
  it('counts an unparseable value as 0, exactly like a missing one', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventAnalyticsList({
      ...range,
      sort: 'events',
      dir: 'desc',
      limit: 10,
      metrics: paramMetrics('app_version'),
    });
    // One of the two events carries `app_version: '1.2.3'`, the other carries
    // no `app_version` at all. Both read as 0, so they are indistinguishable.
    const ads = rows.find((row) => row.name === 'ads_inter_shown');

    expect(ads?.events).toBe(2);
    expect(ads?.users).toBe(2);
    expect(ads?.metrics).toEqual({
      'uniq_param:app_version': 1, // the set is {0}
      'sum_param:app_version': 0,
      'avg_param:app_version': 0,
      'median_param:app_version': 0,
      'uniq_param_user:app_version': 0.5, // 1/2
      'sum_param_user:app_version': 0, // 0/2
    });
  });

  it('treats a string property the same way when every value is unparseable', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventAnalyticsList({
      ...range,
      sort: 'events',
      dir: 'desc',
      limit: 10,
      metrics: [
        { id: 'events' },
        { id: 'sum_param', param: 'level_mode' },
        { id: 'uniq_param', param: 'level_mode' },
      ],
    });
    const levelStart = rows.find((row) => row.name === 'level_start');

    // `classic` and `hard` are two distinct strings but one distinct number.
    expect(levelStart?.metrics).toEqual({
      'sum_param:level_mode': 0,
      'uniq_param:level_mode': 1,
    });
  });
});

describe('totals with metrics', () => {
  it('keeps users deduplicated while the additive metrics add up', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const totals = await overviewService.getEventAnalyticsTotals({
      ...range,
      metrics: paramMetrics('level_id'),
    });
    const summedBranchUsers = EVENT_ANALYTICS_BLUEPRINT.list.reduce(
      (sum, row) => sum + row.users,
      0
    );
    const summedBranchParam = Object.values(
      EVENT_ANALYTICS_BLUEPRINT.levelIdSumByEvent
    ).reduce<number>((sum, value) => sum + value, 0);

    expect(totals.events).toBe(EVENT_ANALYTICS_BLUEPRINT.totals.events);
    // The T8 assertion, restated with metrics in play: users overlap, so the
    // deduplicated total stays below the sum of the branches.
    expect(totals.users).toBe(EVENT_ANALYTICS_BLUEPRINT.totals.users);
    expect(totals.users).toBeLessThan(summedBranchUsers);
    expect(totals.metrics).toEqual(
      expectedParamMetrics('level_id', EVENT_ANALYTICS_BLUEPRINT.levelIdTotals)
    );
    // `sum_param` is additive (§4.1), so unlike `users` it does equal the sum
    // of the branches.
    expect(totals.metrics?.['sum_param:level_id']).toBe(summedBranchParam);
    // ...while the average is not: it is 48/14, not the mean of the branches.
    expect(totals.metrics?.['avg_param:level_id']).toBe(48 / 14);
  });

  it('separates epu from epau on a node fired by a subset of the users', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    // Both ratios are derived in the renderer (§5), so the test derives them
    // from the same two responses the table uses.
    const totals = await overviewService.getEventAnalyticsTotals(range);
    const { rows } = await overviewService.getEventAnalyticsList({
      ...range,
      sort: 'events',
      dir: 'desc',
      limit: 10,
    });
    const levelStart = rows.find((row) => row.name === 'level_start');

    const epu = (levelStart?.events ?? 0) / (levelStart?.users ?? 1);
    const epau = (levelStart?.events ?? 0) / totals.users;
    const pctu = (levelStart?.users ?? 0) / totals.users;

    // 4 of the 5 tracked users fired level_start, so the two denominators
    // differ and so do the ratios.
    expect(epu).toBe(2); // 8/4, the node's own users
    expect(epau).toBe(1.6); // 8/5, every tracked user
    expect(epu).not.toBe(epau);
    expect(pctu).toBe(0.8); // 4/5
  });
});

describe('sorting by a metric column', () => {
  it('orders the list by a dynamic metric key end to end', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const metrics: IEventAnalyticsMetric[] = [
      { id: 'events' },
      { id: 'sum_param', param: 'level_id' },
    ];
    const { rows } = await overviewService.getEventAnalyticsList({
      ...range,
      sort: 'sum_param:level_id',
      dir: 'desc',
      limit: 10,
      metrics,
    });

    // Only level_start carries `level_id`; the other three tie on 0 and fall
    // back to name ASC. That is a different order from `events desc`, which is
    // what proves the ORDER BY followed the metric and not the default.
    expect(rows.map((row) => row.name)).toEqual([
      'level_start',
      'ads_inter_shown',
      'booster_use',
      'level_finish',
    ]);
    expect(rows.map((row) => row.metrics?.['sum_param:level_id'])).toEqual([
      48, 0, 0, 0,
    ]);
    expect(rows.map((row) => row.name)).not.toEqual(
      EVENT_ANALYTICS_BLUEPRINT.list.map((row) => row.name)
    );
  });

  it('sorts ascending by the same metric key', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventAnalyticsList({
      ...range,
      sort: 'sum_param:level_id',
      dir: 'asc',
      limit: 10,
      metrics: [{ id: 'events' }, { id: 'sum_param', param: 'level_id' }],
    });

    expect(rows.map((row) => row.name)).toEqual([
      'ads_inter_shown',
      'booster_use',
      'level_finish',
      'level_start',
    ]);
  });
});

describe('profile filters combined with metrics', () => {
  it('narrows to the filtered users and recomputes every metric', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const proOnly = {
      ...range,
      filters: [
        {
          id: 'plan',
          name: 'profile.properties.plan',
          operator: 'is' as const,
          value: ['pro'],
        },
      ],
    };
    const { rows } = await overviewService.getEventAnalyticsList({
      ...proOnly,
      sort: 'events',
      dir: 'desc',
      limit: 10,
      metrics: [
        { id: 'events' },
        { id: 'sum_param', param: 'level_id' },
        { id: 'avg_param', param: 'level_id' },
      ],
    });
    const levelStart = rows.find((row) => row.name === 'level_start');

    // u1 and u2 are the `pro` profiles. u1 fired level_start three times
    // (level_id 10, 2, 3) and u2 twice (2, 10).
    expect(levelStart?.events).toBe(5);
    expect(levelStart?.users).toBe(2);
    expect(levelStart?.metrics?.['sum_param:level_id']).toBe(27);
    expect(levelStart?.metrics?.['avg_param:level_id']).toBe(27 / 5);
    // u3, u4 and u5 are filtered out, so booster_use disappears entirely.
    expect(rows.map((row) => row.name)).not.toContain('booster_use');

    const totals = await overviewService.getEventAnalyticsTotals({
      ...proOnly,
      metrics: [{ id: 'events' }, { id: 'sum_param', param: 'level_id' }],
    });
    // u1: 3 level_start + 1 level_finish; u2: 2 level_start + 1 ads_inter_shown
    expect(totals.events).toBe(7);
    expect(totals.users).toBe(2);
    expect(totals.metrics?.['sum_param:level_id']).toBe(27);
  });
});
