/**
 * Metric columns of the Event Analytics tree (Phase 2 P1).
 *
 * See docs/superpowers/specs/2026-09-16-event-analytics-phase2-design.md §3 D4
 * and §5. A metric treats a missing or non-numeric parameter as 0; a filter
 * treats it as matching nothing. These tests pin both sides so nobody
 * "unifies" them.
 */
import type { IEventAnalyticsMetric } from '@openpanel/validation';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { ch, chQuery } from '../clickhouse/client';
import { Query } from '../clickhouse/query-builder';
import {
  buildEventAnalyticsListQuery,
  buildEventAnalyticsTotalsQuery,
  buildEventPropertyKeysQuery,
  buildEventPropertyValuesQuery,
  eventAnalyticsMetricExpression,
  overviewService,
  toEventPropertyKeyRows,
} from './overview.service';

const range = {
  projectId: 'p',
  filters: [],
  startDate: '2026-09-01 00:00:00',
  endDate: '2026-09-02 00:00:00',
  timezone: 'UTC',
};

const listInput = { ...range, sort: 'epu', dir: 'desc' as const, limit: 10 };
const keysInput = { ...range, event: 'e', prefix: '', parentPath: [], limit: 20 };
const valuesInput = {
  ...range,
  event: 'e',
  key: 'k',
  type: 'num' as const,
  parentPath: [],
  sort: 'users',
  dir: 'asc' as const,
  limit: 5,
};

/** The date literals depend on the machine's timezone; nothing else may. */
const DATE_LITERAL_RE = /toDateTime\('[^']*'\)/g;
const normalize = (sql: string) => sql.replace(DATE_LITERAL_RE, 'toDateTime(?)');

const BETWEEN = 'created_at BETWEEN toDateTime(?) AND toDateTime(?)';

const level = (id: IEventAnalyticsMetric['id']): IEventAnalyticsMetric => ({
  id,
  param: 'level',
});

let chReachable = false;

beforeAll(async () => {
  try {
    await ch.command({ query: 'SELECT 1' });
    chReachable = true;
  } catch {
    chReachable = false;
  }
});

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('SQL without metrics is byte-identical to Phase 1', () => {
  it('list', () => {
    expect(normalize(buildEventAnalyticsListQuery(listInput).toSQL())).toBe(
      `SELECT name, count() AS events, uniqExact(profile_id) AS users FROM events WHERE project_id = 'p' AND ${BETWEEN} GROUP BY name ORDER BY events / users DESC, name ASC LIMIT 11 OFFSET 0`
    );
  });

  it('totals', () => {
    expect(normalize(buildEventAnalyticsTotalsQuery(range).toSQL())).toBe(
      `SELECT count() AS events, uniqExact(profile_id) AS users FROM events WHERE project_id = 'p' AND ${BETWEEN}`
    );
  });

  it('property keys', () => {
    expect(normalize(buildEventPropertyKeysQuery(keysInput).toSQL())).toBe(
      `WITH base_events AS (SELECT profile_id, properties FROM events WHERE project_id = 'p' AND ${BETWEEN} AND name = 'e'), matched_keys AS (SELECT profile_id, properties, arrayFilter(k -> startsWith(k, ''), mapKeys(properties)) AS matched FROM base_events), segments AS (SELECT profile_id, properties, matched, arrayJoin(arrayDistinct(arrayMap(k -> splitByChar('.', substring(k, length('') + 1))[1], matched))) AS segment FROM matched_keys WHERE notEmpty(matched)) SELECT segment AS key, count() AS events, uniqExact(profile_id) AS users, max(arrayExists(k -> startsWith(k, concat('', segment, '.')), matched)) AS has_nested, countIf(properties[concat('', segment)] != '' AND toFloat64OrNull(properties[concat('', segment)]) IS NULL) AS non_numeric FROM segments GROUP BY segment ORDER BY events DESC, key ASC LIMIT 21 OFFSET 0`
    );
  });

  it('property values', () => {
    expect(normalize(buildEventPropertyValuesQuery(valuesInput).toSQL())).toBe(
      `WITH base_values AS (SELECT properties, profile_id FROM events WHERE project_id = 'p' AND ${BETWEEN} AND name = 'e' AND mapContains(properties, 'k')), value_totals AS (SELECT uniqExact(properties['k']) AS total_distinct FROM base_values) SELECT properties['k'] AS value, count() AS events, uniqExact(profile_id) AS users, total_distinct FROM base_values CROSS JOIN value_totals  GROUP BY value, total_distinct ORDER BY users ASC, toFloat64OrNull(value) ASC LIMIT 6 OFFSET 0`
    );
  });

  it('metrics that need no aggregate of their own leave the SQL untouched', () => {
    const metrics: IEventAnalyticsMetric[] = [
      { id: 'events' },
      { id: 'users' },
      { id: 'epu' },
      { id: 'pctu' },
      { id: 'epau' },
    ];

    expect(buildEventAnalyticsListQuery({ ...listInput, metrics }).toSQL()).toBe(
      buildEventAnalyticsListQuery(listInput).toSQL()
    );
    expect(buildEventAnalyticsTotalsQuery({ ...range, metrics }).toSQL()).toBe(
      buildEventAnalyticsTotalsQuery(range).toSQL()
    );
    expect(buildEventPropertyKeysQuery({ ...keysInput, metrics }).toSQL()).toBe(
      buildEventPropertyKeysQuery(keysInput).toSQL()
    );
    expect(
      buildEventPropertyValuesQuery({ ...valuesInput, metrics }).toSQL()
    ).toBe(buildEventPropertyValuesQuery(valuesInput).toSQL());
  });
});

describe('eventAnalyticsMetricExpression', () => {
  const value = "coalesce(toFloat64OrNull(properties['level']), 0)";

  it.each([
    ['uniq_param', `uniqExact(${value})`],
    ['sum_param', `sum(${value})`],
    // sum / count(), never avg(): every event in the node is the denominator.
    ['avg_param', `sum(${value}) / count()`],
    ['median_param', `quantileExact(0.5)(${value})`],
    ['uniq_param_user', `uniqExact(${value}) / uniqExact(profile_id)`],
    ['sum_param_user', `sum(${value}) / uniqExact(profile_id)`],
  ] as const)('%s', (id, expected) => {
    expect(eventAnalyticsMetricExpression(level(id))).toBe(expected);
  });

  it.each(['events', 'users', 'epu', 'pctu', 'epau'] as const)(
    '%s emits nothing: it is selected already or derived in the renderer',
    (id) => {
      expect(eventAnalyticsMetricExpression({ id })).toBeNull();
    }
  );

  it('escapes the parameter key instead of interpolating it', () => {
    expect(
      eventAnalyticsMetricExpression({ id: 'sum_param', param: "x'] ) OR 1=1 --" })
    ).toBe(
      String.raw`sum(coalesce(toFloat64OrNull(properties['x\'] ) OR 1=1 --']), 0))`
    );
  });

  it('never uses bare toFloat64OrZero (D4 names the zero with coalesce)', () => {
    for (const id of [
      'uniq_param',
      'sum_param',
      'avg_param',
      'median_param',
      'uniq_param_user',
      'sum_param_user',
    ] as const) {
      expect(eventAnalyticsMetricExpression(level(id))).not.toContain(
        'toFloat64OrZero'
      );
    }
  });
});

describe('metric columns in the builders', () => {
  const metrics: IEventAnalyticsMetric[] = [
    { id: 'events' },
    level('sum_param'),
    { id: 'epau' },
    level('median_param'),
  ];

  it('appends one aliased aggregate per requested metric to all four builders', () => {
    const sum = "sum(coalesce(toFloat64OrNull(properties['level']), 0)) AS metric_1";
    const median =
      "quantileExact(0.5)(coalesce(toFloat64OrNull(properties['level']), 0)) AS metric_3";

    for (const sql of [
      buildEventAnalyticsListQuery({ ...listInput, metrics }).toSQL(),
      buildEventAnalyticsTotalsQuery({ ...range, metrics }).toSQL(),
      buildEventPropertyKeysQuery({ ...keysInput, metrics }).toSQL(),
      buildEventPropertyValuesQuery({ ...valuesInput, metrics }).toSQL(),
    ]) {
      expect(sql).toContain(`${sum}, ${median}`);
      expect(sql).not.toContain('metric_0');
      expect(sql).not.toContain('metric_2');
    }
  });

  it('adds no coalesce to the filters: a missing value still matches nothing', () => {
    const sql = buildEventAnalyticsListQuery({
      ...listInput,
      metrics,
      filters: [
        {
          id: 'level',
          name: 'properties.level',
          operator: 'lt' as const,
          value: [1],
        },
      ],
    }).toSQL();
    const where = sql.slice(sql.indexOf('WHERE'), sql.indexOf('GROUP BY'));

    expect(where).toContain('properties');
    expect(where).not.toContain('coalesce');
  });

  it.each([
    ['events', 'events'],
    ['users', 'users'],
    ['epu', 'events / users'],
    // Both denominators are constant within one query, so the orderings match.
    ['pctu', 'users'],
    ['epau', 'events'],
    ['sum_param:level', 'metric_1'],
    ['median_param:level', 'metric_3'],
  ])('sorts %s by %s', (sort, column) => {
    const all = [...metrics, { id: 'pctu' as const }];
    expect(
      buildEventAnalyticsListQuery({ ...listInput, metrics: all, sort }).toSQL()
    ).toContain(`ORDER BY ${column} DESC, name ASC`);
    expect(
      buildEventPropertyValuesQuery({ ...valuesInput, metrics: all, sort }).toSQL()
    ).toContain(`ORDER BY ${column} ASC, toFloat64OrNull(value) ASC`);
  });

  it('parses in ClickHouse when available', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    const all: IEventAnalyticsMetric[] = [
      { id: 'events' },
      level('uniq_param'),
      level('sum_param'),
      level('avg_param'),
      level('median_param'),
      level('uniq_param_user'),
      level('sum_param_user'),
    ];
    for (const sql of [
      buildEventAnalyticsListQuery({ ...listInput, metrics: all, sort: 'avg_param:level' }).toSQL(),
      buildEventAnalyticsTotalsQuery({ ...range, metrics: all }).toSQL(),
      buildEventPropertyKeysQuery({ ...keysInput, metrics: all }).toSQL(),
      buildEventPropertyValuesQuery({ ...valuesInput, metrics: all, sort: 'sum_param_user:level' }).toSQL(),
    ]) {
      await ch.command({ query: `EXPLAIN ${sql}` });
    }
  });
});

describe('D4: a missing parameter is 0 in a metric', () => {
  // Node of three events: level 10 (u1), no level at all (u1), level "abc" (u2).
  const events = `values('properties Map(String, String), profile_id String', (map('level', '10'), 'u1'), (map(), 'u1'), (map('level', 'abc'), 'u2'))`;

  const evaluate = async (id: IEventAnalyticsMetric['id']) => {
    const [row] = await chQuery<{ value: number }>(
      `SELECT ${eventAnalyticsMetricExpression(level(id))} AS value FROM ${events}`
    );
    return Number(row?.value);
  };

  it('pulls avg_param down: the denominator is every event in the node', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    expect(await evaluate('sum_param')).toBe(10);
    expect(await evaluate('avg_param')).toBeCloseTo(10 / 3);
  });

  it('counts 0 in median_param value set', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    expect(await evaluate('median_param')).toBe(0);
  });

  it('adds 0 to the distinct set of uniq_param and uniq_param_user', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    // {10, 0}: the missing and the non-numeric value collapse into one 0.
    expect(await evaluate('uniq_param')).toBe(2);
    expect(await evaluate('uniq_param_user')).toBe(1);
    expect(await evaluate('sum_param_user')).toBe(5);
  });

  it('guards the per-user totals of an empty range in ClickHouse', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    // Real ClickHouse rows, without the execute() wrapper's Postgres lookups.
    vi.spyOn(Query.prototype, 'execute').mockImplementation(function (
      this: Query
    ) {
      return chQuery(this.toSQL()) as never;
    });
    const totals = await overviewService.getEventAnalyticsTotals({
      ...range,
      projectId: 'event-analytics-metrics-sql-empty',
      metrics: [
        { id: 'events' },
        level('avg_param'),
        level('median_param'),
        level('uniq_param_user'),
        level('sum_param_user'),
      ],
    });

    expect(totals).toEqual({
      events: 0,
      users: 0,
      metrics: {
        'avg_param:level': 0,
        'median_param:level': 0,
        'uniq_param_user:level': 0,
        'sum_param_user:level': 0,
      },
    });
  });
});

describe('metrics in the service output', () => {
  const metrics: IEventAnalyticsMetric[] = [{ id: 'events' }, level('sum_param')];
  const stubRows = (rows: unknown[]) =>
    vi.spyOn(Query.prototype, 'execute').mockResolvedValue(rows as never);

  it('keys list rows by metric key', async () => {
    stubRows([{ name: 'e', events: '4', users: '2', metric_1: '12.5' }]);

    const { rows } = await overviewService.getEventAnalyticsList({
      ...listInput,
      metrics,
    });

    expect(rows).toEqual([
      { name: 'e', events: 4, users: 2, metrics: { 'sum_param:level': 12.5 } },
    ]);
  });

  it('omits metrics entirely when none were requested', async () => {
    stubRows([{ name: 'e', events: '4', users: '2' }]);

    const { rows } = await overviewService.getEventAnalyticsList(listInput);

    expect(rows).toEqual([{ name: 'e', events: 4, users: 2 }]);
  });

  it('reports 0, not NaN, for a per-user total over an empty range', async () => {
    stubRows([{ events: '0', users: '0', metric_1: 'nan' }]);

    await expect(
      overviewService.getEventAnalyticsTotals({
        ...range,
        metrics: [{ id: 'events' }, level('sum_param_user')],
      })
    ).resolves.toEqual({
      events: 0,
      users: 0,
      metrics: { 'sum_param_user:level': 0 },
    });
  });

  it('keys property value rows by metric key', async () => {
    stubRows([
      { value: '3', events: '4', users: '2', total_distinct: '1', metric_1: '7' },
    ]);

    const { rows } = await overviewService.getEventPropertyValues({
      ...valuesInput,
      metrics,
    });

    expect(rows).toEqual([
      { value: '3', events: 4, users: 2, metrics: { 'sum_param:level': 7 } },
    ]);
  });

  it('keys property key rows by metric key', () => {
    const { rows } = toEventPropertyKeyRows(
      [
        {
          key: 'level',
          events: '4',
          users: '2',
          has_nested: '0',
          non_numeric: '0',
          metric_1: '9',
        },
      ],
      { limit: 20, metrics }
    );

    expect(rows[0]?.metrics).toEqual({ 'sum_param:level': 9 });
  });
});
