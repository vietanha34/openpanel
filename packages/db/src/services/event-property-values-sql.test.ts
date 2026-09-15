import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ch } from '../clickhouse/client';
import {
  buildEventPropertyValuesQuery,
  type IGetEventPropertyValuesInput,
} from './overview.service';

const base: IGetEventPropertyValuesInput = {
  projectId: 'test-event-analytics',
  filters: [],
  startDate: '2026-09-01 00:00:00',
  endDate: '2026-09-02 00:00:00',
  timezone: 'UTC',
  event: 'level_start',
  key: 'level_mode',
  type: 'str',
  parentPath: [],
  sort: 'events',
  dir: 'desc',
  limit: 5,
  cursor: 0,
};

let chReachable = false;

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await ch.command({ query: 'SELECT 1' });
    chReachable = true;
  } catch {
    chReachable = false;
  }
});

afterAll(() => vi.restoreAllMocks());

describe('buildEventPropertyValuesQuery', () => {
  it('groups the requested property by value with both metrics', () => {
    const sql = buildEventPropertyValuesQuery(base).toSQL();

    expect(sql).toContain("properties['level_mode'] AS value");
    expect(sql).toContain('count() AS events');
    expect(sql).toContain('uniqExact(profile_id) AS users');
    expect(sql).toContain('GROUP BY value');
  });

  it('only counts events that carry the key, for the requested event', () => {
    const sql = buildEventPropertyValuesQuery(base).toSQL();

    expect(sql).toContain("mapContains(properties, 'level_mode')");
    expect(sql).toContain("name = 'level_start'");
  });

  it('narrows to events matching every parentPath pair', () => {
    const sql = buildEventPropertyValuesQuery({
      ...base,
      parentPath: [{ key: 'level_mode', value: 'hard' }],
      key: 'payload.score',
    }).toSQL();

    expect(sql).toContain("properties['level_mode'] = 'hard'");
  });

  it('orders numeric keys numerically and string keys lexically', () => {
    const numeric = buildEventPropertyValuesQuery({
      ...base,
      type: 'num',
    }).toSQL();
    const string = buildEventPropertyValuesQuery(base).toSQL();

    expect(numeric).toContain('ORDER BY events DESC, toFloat64OrNull(value) ASC');
    expect(string).toContain('ORDER BY events DESC, value ASC');
    expect(string).not.toContain('toFloat64OrNull');
  });

  it('sorts by the requested metric and direction', () => {
    expect(
      buildEventPropertyValuesQuery({ ...base, sort: 'users', dir: 'asc' }).toSQL()
    ).toContain('ORDER BY users ASC');
    expect(
      buildEventPropertyValuesQuery({ ...base, sort: 'epu' }).toSQL()
    ).toContain('ORDER BY events / users DESC');
  });

  it('fetches one row past the page and exposes the distinct total', () => {
    const sql = buildEventPropertyValuesQuery({
      ...base,
      limit: 5,
      cursor: 10,
    }).toSQL();

    expect(sql).toContain('LIMIT 6');
    expect(sql).toContain('OFFSET 10');
    expect(sql).toContain(
      "uniqExact(properties['level_mode']) AS total_distinct"
    );
  });

  it('parses in ClickHouse when available', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    await ch.command({
      query: `EXPLAIN ${buildEventPropertyValuesQuery(base).toSQL()}`,
    });
  });
});
