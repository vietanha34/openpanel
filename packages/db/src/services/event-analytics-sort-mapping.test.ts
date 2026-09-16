import { describe, expect, it } from 'vitest';

import { buildEventAnalyticsListQuery } from './overview.service';

const base = {
  projectId: 'test-event-analytics-sort',
  startDate: '2026-09-01 00:00:00',
  endDate: '2026-09-02 00:00:00',
  timezone: 'UTC',
  filters: [],
  dir: 'desc' as const,
  limit: 10,
};

const sqlFor = (sort: string) =>
  buildEventAnalyticsListQuery({ ...base, sort } as never).toSQL();

/**
 * `pctu` and `epau` both divide by the deduplicated total user count, which is
 * constant within one query. Ordering by them is therefore identical to
 * ordering by their numerator, and the SQL says so — no ratio in the ORDER BY.
 */
describe('event analytics sort mapping', () => {
  it('orders by the events column for events', () => {
    expect(sqlFor('events')).toContain('ORDER BY events DESC');
  });

  it('orders by the users column for users', () => {
    expect(sqlFor('users')).toContain('ORDER BY users DESC');
  });

  it('orders by the ratio for epu, whose denominator varies per row', () => {
    expect(sqlFor('epu')).toContain('ORDER BY events / users DESC');
  });

  it('orders by users for pctu', () => {
    expect(sqlFor('pctu')).toContain('ORDER BY users DESC');
  });

  it('orders by events for epau', () => {
    expect(sqlFor('epau')).toContain('ORDER BY events DESC');
  });

  it('falls back to events for a metric the request did not ask for', () => {
    expect(sqlFor('sum_param:day')).toContain('ORDER BY events DESC');
  });

  it('orders a requested parameter metric by its aggregate column', () => {
    const sql = buildEventAnalyticsListQuery({
      ...base,
      sort: 'sum_param:day',
      metrics: [{ id: 'events' }, { id: 'sum_param', param: 'day' }],
    }).toSQL();

    expect(sql).toContain('ORDER BY metric_1 DESC');
  });
});
