import { describe, expect, it } from 'vitest';

import { clix } from '../clickhouse/query-builder';
import {
  buildEventAnalyticsListQuery,
  buildEventAnalyticsTotalsQuery,
} from './overview.service';

/**
 * How the builder writes a datetime bound. Asserting against this rather than
 * against a hard-coded literal is the point: the bounds are converted, so a
 * hard-coded string only matches on a machine running UTC — which is how the
 * period conditions drifted onto a different clock unnoticed.
 */
const bound = (value: string) => `toDateTime('${clix.datetime(value)}')`;

const base = {
  projectId: 'test-periods',
  startDate: '2026-09-12 00:00:00',
  endDate: '2026-09-18 23:59:59',
  timezone: 'UTC',
  filters: [],
};

const listExtras = { sort: 'events', dir: 'desc' as const, limit: 10 };

const twoWeeks = [
  { startDate: '2026-09-12 00:00:00', endDate: '2026-09-18 23:59:59' },
  { startDate: '2026-09-05 00:00:00', endDate: '2026-09-11 23:59:59' },
];

const sqlFor = (extra: Record<string, unknown>) =>
  buildEventAnalyticsListQuery({ ...base, ...listExtras, ...extra } as never).toSQL();

describe('multi-period event analytics SQL', () => {
  it('is byte-identical to today when no periods are sent', () => {
    expect(sqlFor({})).toBe(sqlFor({ periods: undefined }));
    expect(sqlFor({})).toContain('count() AS events');
    expect(sqlFor({})).not.toContain('countIf');
  });

  it('is byte-identical when a single period is sent', () => {
    // One period is the ordinary report; nothing about the SQL should change.
    expect(sqlFor({ periods: [twoWeeks[0]] })).toBe(sqlFor({}));
  });

  it('scans the union of the periods once', () => {
    const sql = sqlFor({ periods: twoWeeks });

    expect(sql).toContain(
      `created_at BETWEEN ${bound('2026-09-05 00:00:00')}`
    );
    expect(sql).toContain(bound('2026-09-18 23:59:59'));
    // One scan, not one per period.
    expect(sql.match(/FROM events/g)).toHaveLength(1);
  });

  it('counts events and users per period, never over the union', () => {
    const sql = sqlFor({ periods: twoWeeks });

    expect(sql).toContain(
      `countIf(created_at BETWEEN ${bound('2026-09-12 00:00:00')} AND ${bound('2026-09-18 23:59:59')}) AS events_p0`,
    );
    expect(sql).toContain(
      `uniqExactIf(profile_id, created_at BETWEEN ${bound('2026-09-05 00:00:00')} AND ${bound('2026-09-11 23:59:59')}) AS users_p1`,
    );
    // A plain uniqExact over the union would count a user active in both
    // periods once instead of once per period.
    expect(sql).not.toContain('uniqExact(profile_id) AS users');
  });

  it('keeps row selection and ordering on period A', () => {
    const sql = sqlFor({ periods: twoWeeks });

    expect(sql).toContain('ORDER BY events_p0 DESC, name ASC');
    expect(sql).toContain('LIMIT 11');
  });

  it('sorts by the metric of A even when a B column was clicked', () => {
    expect(sqlFor({ periods: twoWeeks, sort: 'users:B' })).toContain(
      'ORDER BY users_p0 DESC',
    );
  });

  it('emits every parameter metric per period with the If variant', () => {
    const sql = sqlFor({
      periods: twoWeeks,
      metrics: [
        { id: 'events' },
        { id: 'sum_param', param: 'coins' },
        { id: 'avg_param', param: 'coins' },
        { id: 'median_param', param: 'coins' },
        { id: 'uniq_param_user', param: 'day' },
      ],
    });

    expect(sql).toContain('sumIf(coalesce(toFloat64OrNull(properties[\'coins\']), 0), created_at BETWEEN');
    expect(sql).toContain('quantileExactIf(0.5)(coalesce(toFloat64OrNull(properties[\'coins\']), 0), created_at BETWEEN');
    // The average divides by that period's own event count.
    expect(sql).toMatch(/sumIf\(.+\) \/ countIf\(created_at BETWEEN/);
    // Per-user ratios divide by that period's own users.
    expect(sql).toMatch(/uniqExactIf\(.+\) \/ uniqExactIf\(profile_id, created_at BETWEEN/);
    // Aliases carry both the metric index and the period index.
    expect(sql).toContain('AS metric_1_p1');
  });

  it('applies the same treatment to the totals query', () => {
    const sql = buildEventAnalyticsTotalsQuery({
      ...base,
      periods: twoWeeks,
    } as never).toSQL();

    expect(sql).toContain('AS events_p0');
    expect(sql).toContain('AS users_p1');
  });
});

describe('period conditions share one clock with the enclosing range (T4-FIX)', () => {
  // Written against the SQL, not against data: on a machine running UTC the
  // conversion is the identity and an integration test passes either way. This
  // one fails wherever the two forms diverge, CI included.
  const shifted = {
    ...base,
    timezone: 'Asia/Bangkok',
    startDate: '2026-03-03 00:00:00',
    endDate: '2026-03-03 23:59:59',
  };
  const shiftedPeriods = [
    { startDate: '2026-03-03 00:00:00', endDate: '2026-03-03 23:59:59' },
    { startDate: '2026-03-02 00:00:00', endDate: '2026-03-02 23:59:59' },
  ];

  const sql = buildEventAnalyticsListQuery({
    ...shifted,
    ...listExtras,
    periods: shiftedPeriods,
  } as never).toSQL();

  it('writes the period bounds in the same form as the range bounds', () => {
    // The range bound period A repeats must appear twice: once enclosing the
    // scan, once inside countIf.
    const boundary = sql.match(/created_at BETWEEN toDateTime\('[^']+'\)/g);

    expect(boundary).not.toBeNull();
    expect(new Set(boundary).size).toBeLessThan((boundary as string[]).length);
  });

  it('never mixes a converted bound with a raw local one', () => {
    // Every datetime literal in the query is the same shape; a raw local string
    // next to a converted one is exactly the bug.
    const literals = sql.match(/toDateTime\('([^']+)'\)/g) ?? [];

    expect(literals.length).toBeGreaterThan(2);
    expect(sql).not.toContain("toDateTime('2026-03-03 00:00:00')");
  });

  it('restricts the rows to the ones period A saw', () => {
    expect(sql).toContain('HAVING');
    expect(sql).toContain('events_p0 > 0');
  });

  it('adds no HAVING without periods, keeping the SQL byte-identical', () => {
    expect(sqlFor({})).not.toContain('HAVING');
  });
});
