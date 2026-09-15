/**
 * Numeric property filters must never match a missing or non-numeric value
 * (spec §5.2). `toFloat64OrZero` coerced both cases to 0, so an event without
 * `properties.age` satisfied `age < 1` and `properties.age = 'abc'` satisfied
 * `age > -1`. These are pure SQL-string assertions — no ClickHouse needed.
 */
import type { IChartEvent } from '@openpanel/validation';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getChartSql as _getChartSql } from './chart.service';

const getChartSql: (input: any) => Promise<string> = _getChartSql as any;

const PROJECT_ID = 'test-numeric-filter';
const START = '2026-04-14 00:00:00';
const END = '2026-05-15 00:00:00';

const event = (overrides: Partial<IChartEvent> = {}): IChartEvent => ({
  id: 'A',
  name: 'screen_view',
  segment: 'event',
  filters: [],
  ...overrides,
});

const sqlFor = (filters: IChartEvent['filters']) =>
  getChartSql({
    event: event({ filters }),
    breakdowns: [],
    interval: 'day',
    startDate: START,
    endDate: END,
    projectId: PROJECT_ID,
    timezone: 'UTC',
  });

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('numeric property filters', () => {
  it('a missing key cannot satisfy `< 1`', async () => {
    const sql = await sqlFor([
      { id: 'f', name: 'properties.age', operator: 'lt', value: ['1'] },
    ]);
    // toFloat64OrNull('') is NULL, and `NULL < 1` never passes WHERE.
    expect(sql).toContain("toFloat64OrNull(e.properties['age']) < toFloat64('1')");
    expect(sql).not.toContain('toFloat64OrZero');
    // Explicit absence guard on the events properties map.
    expect(sql).toContain("mapContains(e.properties, 'age')");
  });

  it('a non-numeric value cannot satisfy `> -1`', async () => {
    const sql = await sqlFor([
      { id: 'f', name: 'properties.age', operator: 'gt', value: ['-1'] },
    ]);
    // toFloat64OrNull('abc') is NULL, and `NULL > -1` never passes WHERE.
    expect(sql).toContain(
      "toFloat64OrNull(e.properties['age']) > toFloat64('-1')",
    );
    expect(sql).not.toContain('toFloat64OrZero');
  });

  it('gte and lte are null-safe too', async () => {
    const gte = await sqlFor([
      { id: 'f', name: 'properties.age', operator: 'gte', value: ['5'] },
    ]);
    expect(gte).toContain(
      "toFloat64OrNull(e.properties['age']) >= toFloat64('5')",
    );
    const lte = await sqlFor([
      { id: 'f', name: 'properties.age', operator: 'lte', value: ['5'] },
    ]);
    expect(lte).toContain(
      "toFloat64OrNull(e.properties['age']) <= toFloat64('5')",
    );
  });

  it('the wildcard branch is null-safe', async () => {
    const sql = await sqlFor([
      { id: 'f', name: 'properties.a.*.age', operator: 'lt', value: ['1'] },
    ]);
    expect(sql).toContain("arrayExists(x -> toFloat64OrNull(x) < toFloat64('1')");
    expect(sql).not.toContain('toFloat64OrZero');
    // arrayExists over an empty array is already false; no mapContains guard.
    expect(sql).not.toContain('mapContains');
  });

  it('profile.properties gets no mapContains guard', async () => {
    // rewriteProfilePropertyRefs narrows these refs to scalar CTE columns and
    // drops the full map, so a mapContains(profile.properties, ...) reference
    // would survive the rewrite and point at a column the CTE no longer has.
    const sql = await sqlFor([
      { id: 'f', name: 'profile.properties.age', operator: 'lt', value: ['1'] },
    ]);
    expect(sql).toContain('toFloat64OrNull');
    expect(sql).not.toContain('mapContains');
  });
});
