import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ch } from '../clickhouse/client';
import { buildEventAnalyticsQuery } from './overview.service';

const input = {
  projectId: 'test-event-analytics',
  filters: [],
  startDate: '2026-09-01 00:00:00',
  endDate: '2026-09-02 00:00:00',
  timezone: 'UTC',
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
