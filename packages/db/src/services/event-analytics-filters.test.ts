import type { IChartEventFilter } from '@openpanel/validation';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ch } from '../clickhouse/client';
import {
  buildEventAnalyticsListQuery,
  buildEventAnalyticsQuery,
  buildEventAnalyticsTotalsQuery,
  buildEventPropertyKeysQuery,
  buildEventPropertyValuesQuery,
} from './overview.service';

const range = {
  projectId: 'test-event-analytics-filters',
  startDate: '2026-09-01 00:00:00',
  endDate: '2026-09-02 00:00:00',
  timezone: 'UTC',
};

const propertyFilter: IChartEventFilter[] = [
  {
    id: 'properties.level_mode',
    name: 'properties.level_mode',
    operator: 'is' as const,
    value: ['hard'],
  },
];

const utmFilter: IChartEventFilter[] = [
  {
    id: 'utm_source',
    name: 'utm_source',
    operator: 'is' as const,
    value: ['newsletter'],
  },
];

const cohortFilter: IChartEventFilter[] = [
  {
    id: 'cohort',
    name: 'cohort',
    operator: 'inCohort' as const,
    value: [],
    cohortIds: ['cohort-1'],
  },
];

const listExtras = { sort: 'events' as const, dir: 'desc' as const, limit: 10 };
const keysExtras = {
  event: 'level_complete',
  prefix: '',
  parentPath: [],
  limit: 10,
};
const valuesExtras = {
  event: 'level_complete',
  key: 'level_mode',
  type: 'str' as const,
  parentPath: [],
  sort: 'events' as const,
  dir: 'desc' as const,
  cursor: 0,
  limit: 10,
};

// Every event analytics SQL built from the same filter set — the property
// filter must survive into all of them.
const builders = {
  analytics: (filters: IChartEventFilter[]) =>
    buildEventAnalyticsQuery({ ...range, filters }).toSQL(),
  list: (filters: IChartEventFilter[]) =>
    buildEventAnalyticsListQuery({ ...range, ...listExtras, filters }).toSQL(),
  totals: (filters: IChartEventFilter[]) =>
    buildEventAnalyticsTotalsQuery({ ...range, filters }).toSQL(),
  propertyKeys: (filters: IChartEventFilter[]) =>
    buildEventPropertyKeysQuery({ ...range, ...keysExtras, filters }).toSQL(),
  propertyValues: (filters: IChartEventFilter[]) =>
    buildEventPropertyValuesQuery({
      ...range,
      ...valuesExtras,
      filters,
    }).toSQL(),
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

describe.each(Object.entries(builders))('%s property filters', (_name, build) => {
  it('keeps a properties.* filter instead of dropping it silently', () => {
    expect(build(propertyFilter)).toContain(
      "properties['level_mode'] = 'hard'"
    );
  });

  it('reads utm_source out of the properties map, not a top-level column', () => {
    const sql = build(utmFilter);

    expect(sql).toContain("properties['__query.utm_source'] = 'newsletter'");
    expect(sql).not.toMatch(/(?<!\.)\butm_source\s*=/);
  });

  it('drops a profile property filter that has no join to resolve it', () => {
    const sql = build([
      {
        id: 'profile.properties.plan',
        name: 'profile.properties.plan',
        operator: 'is' as const,
        value: ['pro'],
      },
    ]);

    expect(sql).not.toContain('profile.properties');
  });

  it('resolves a cohort filter through a self-contained subselect', () => {
    const sql = build(cohortFilter);

    expect(sql).toContain('profile_id IN (SELECT profile_id FROM');
    expect(sql).toContain("'cohort-1'");
  });

  it('parses in ClickHouse when available', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    await ch.command({ query: `EXPLAIN ${build(propertyFilter)}` });
    await ch.command({ query: `EXPLAIN ${build(utmFilter)}` });
    await ch.command({ query: `EXPLAIN ${build(cohortFilter)}` });
  });
});
