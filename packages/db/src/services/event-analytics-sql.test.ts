import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ch } from '../clickhouse/client';
import { Query } from '../clickhouse/query-builder';
import {
  buildEventAnalyticsListQuery,
  buildEventAnalyticsQuery,
  buildEventAnalyticsTotalsQuery,
  overviewService,
} from './overview.service';

const input = {
  projectId: 'test-event-analytics',
  filters: [],
  startDate: '2026-09-01 00:00:00',
  endDate: '2026-09-02 00:00:00',
  timezone: 'UTC',
};

let chReachable = false;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

beforeAll(async () => {
  try {
    await ch.command({ query: 'SELECT 1' });
    chReachable = true;
  } catch {
    chReachable = false;
  }
});

afterEach(() => vi.restoreAllMocks());

describe('buildEventAnalyticsQuery', () => {
  it('computes each event share against all filtered users', () => {
    const sql = buildEventAnalyticsQuery(input).toSQL();

    expect(sql).toContain('uniqExact(profile_id) AS users');
    expect(sql).toContain('uniqExact(profile_id) AS total_users');
    expect(sql).toContain('count() AS total_events');
    expect(sql).toContain('users / total_users AS user_percentage');
  });

  it('returns event counts, users, and events per user for the selected range', () => {
    const sql = buildEventAnalyticsQuery(input).toSQL();

    expect(sql).toContain('count() AS events');
    expect(sql).toContain('events / total_events AS event_percentage');
    expect(sql).toContain('events / users AS events_per_user');
    expect(sql).toContain('GROUP BY name');
    expect(sql).toContain('ORDER BY events DESC');
  });

  it('parses in ClickHouse when available', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    await ch.command({ query: `EXPLAIN ${buildEventAnalyticsQuery(input).toSQL()}` });
  });
});

const listInput = {
  ...input,
  sort: 'events' as const,
  dir: 'desc' as const,
  limit: 10,
};

describe('buildEventAnalyticsListQuery', () => {
  it('aggregates events and deduplicated users per event name', () => {
    const sql = buildEventAnalyticsListQuery(listInput).toSQL();

    expect(sql).toContain('count() AS events');
    expect(sql).toContain('uniqExact(profile_id) AS users');
    expect(sql).toContain('GROUP BY name');
  });

  it('orders by the requested metric and falls back to name', () => {
    const sql = buildEventAnalyticsListQuery({
      ...listInput,
      sort: 'users',
      dir: 'asc',
    }).toSQL();

    expect(sql).toContain('ORDER BY users ASC, name ASC');
  });

  it('orders events per user on the ratio, not on a stored column', () => {
    const sql = buildEventAnalyticsListQuery({
      ...listInput,
      sort: 'epu',
    }).toSQL();

    expect(sql).toContain('ORDER BY events / users DESC, name ASC');
  });

  it('reads one row past the page so the caller can detect a next page', () => {
    const sql = buildEventAnalyticsListQuery({
      ...listInput,
      limit: 10,
      cursor: 20,
    }).toSQL();

    expect(sql).toContain('LIMIT 11');
    expect(sql).toContain('OFFSET 20');
  });

  it('matches the search term case-insensitively against the event name', () => {
    const sql = buildEventAnalyticsListQuery({
      ...listInput,
      search: "sign'up",
    }).toSQL();

    expect(sql).toContain(String.raw`name ILIKE '%sign\'up%'`);
  });

  it('treats ILIKE wildcards inside the search term as literal characters', () => {
    const sql = buildEventAnalyticsListQuery({
      ...listInput,
      search: 'sign_up%',
    }).toSQL();

    expect(sql).toContain(String.raw`name ILIKE '%sign\\_up\\%%'`);
  });

  it('leaves the name unfiltered when no search term is given', () => {
    const sql = buildEventAnalyticsListQuery(listInput).toSQL();

    expect(sql).not.toContain('ILIKE');
  });

  it('parses in ClickHouse when available', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    await ch.command({
      query: `EXPLAIN ${buildEventAnalyticsListQuery({ ...listInput, search: 'sign' }).toSQL()}`,
    });
  });
});

describe('buildEventAnalyticsTotalsQuery', () => {
  it('counts the filtered rows once instead of summing the branches', () => {
    const sql = buildEventAnalyticsTotalsQuery(input).toSQL();

    expect(sql).toContain('count() AS events');
    expect(sql).toContain('uniqExact(profile_id) AS users');
    expect(sql).not.toContain('GROUP BY');
  });

  it('reads the same filtered range as the list query', () => {
    const filtered = {
      ...input,
      filters: [
        { id: 'country', name: 'country', operator: 'is' as const, value: ['SE'] },
      ],
    };
    const whereOf = (sql: string) => {
      const where = sql.slice(sql.indexOf('WHERE'));
      const end = where.indexOf('GROUP BY');
      return end === -1 ? where : where.slice(0, end);
    };

    const totals = whereOf(buildEventAnalyticsTotalsQuery(filtered).toSQL());
    const list = whereOf(
      buildEventAnalyticsListQuery({ ...listInput, ...filtered }).toSQL()
    );

    expect(totals).toContain(`project_id = '${input.projectId}'`);
    expect(totals).toContain("'SE'");
    expect(totals.trim()).toBe(list.trim());
  });

  it('parses in ClickHouse when available', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    await ch.command({
      query: `EXPLAIN ${buildEventAnalyticsTotalsQuery(input).toSQL()}`,
    });
  });
});

describe('overviewService.getEventAnalyticsList', () => {
  const stubRows = (rows: unknown[]) =>
    vi.spyOn(Query.prototype, 'execute').mockResolvedValue(rows as never);

  it('trims the overflow row and points the cursor at the next page', async () => {
    stubRows(
      Array.from({ length: 4 }, (_, index) => ({
        name: `event_${index}`,
        events: '10',
        users: '5',
      }))
    );

    const result = await overviewService.getEventAnalyticsList({
      ...listInput,
      limit: 3,
      cursor: 3,
    });

    expect(result.rows).toHaveLength(3);
    expect(result.nextCursor).toBe(6);
  });

  it('ends the list when the page is not full', async () => {
    stubRows([{ name: 'sign_up', events: '10', users: '5' }]);

    const result = await overviewService.getEventAnalyticsList({
      ...listInput,
      limit: 3,
    });

    expect(result.nextCursor).toBeNull();
    expect(result.rows).toEqual([{ name: 'sign_up', events: 10, users: 5 }]);
  });
});

describe('overviewService.getEventAnalyticsTotals', () => {
  it('reports zero instead of NaN when the range holds no events', async () => {
    vi.spyOn(Query.prototype, 'execute').mockResolvedValue([] as never);

    await expect(overviewService.getEventAnalyticsTotals(input)).resolves.toEqual(
      { events: 0, users: 0 }
    );
  });

  it('returns the deduplicated totals as numbers', async () => {
    vi.spyOn(Query.prototype, 'execute').mockResolvedValue([
      { events: '120', users: '42' },
    ] as never);

    await expect(overviewService.getEventAnalyticsTotals(input)).resolves.toEqual(
      { events: 120, users: 42 }
    );
  });
});
