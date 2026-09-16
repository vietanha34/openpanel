/**
 * End to end, against ClickHouse: the Event Analytics chart must count the same
 * events as the Event Analytics table for the same filter group (B7).
 *
 * The fixture holds one user whose profile row does not exist. That is the case
 * where the two compilation routes disagree: through the chart's LEFT ANY JOIN
 * a missing profile reads every property as '', so it satisfies
 * `missingProperty`; the table's profile subselect excludes it. Skipped when
 * ClickHouse is not reachable at CLICKHOUSE_URL.
 */

process.env.TZ = 'UTC';

import type { IChartEvent, IFilterGroup } from '@openpanel/validation';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ch, chQuery, TABLE_NAMES } from '../clickhouse/client';
import { getAggregateChartSql } from './chart.service';
import { overviewService } from './overview.service';

const projectId = 'test-b7-chart-filter-group-parity';
const day = '2024-03-04';

// u1 is on `pro`, u2 has a profile with no `plan`, u9 has no profile at all.
const EVENTS = [
  { user: 'b7-u1', mode: 'hard' },
  { user: 'b7-u2', mode: '' },
  { user: 'b7-u9', mode: '' },
];
const PROFILES = [
  { user: 'b7-u1', properties: { plan: 'pro' } },
  { user: 'b7-u2', properties: {} },
];

let chReachable = false;

async function teardown() {
  for (const table of [TABLE_NAMES.events, TABLE_NAMES.profiles]) {
    await ch.command({
      query: `DELETE FROM ${table} WHERE project_id = {projectId:String}`,
      query_params: { projectId },
      clickhouse_settings: { mutations_sync: '2' },
    });
  }
}

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await ch.command({ query: 'SELECT 1' });
    chReachable = true;
  } catch {
    return;
  }
  await teardown();
  await ch.insert({
    table: TABLE_NAMES.events,
    format: 'JSONEachRow',
    values: EVENTS.map(({ user, mode }, index) => ({
      id: `00000000-0000-4000-9b07-${String(index + 1).padStart(12, '0')}`,
      project_id: projectId,
      profile_id: user,
      device_id: `dev-${user}`,
      name: 'level_start',
      session_id: `sess-${user}`,
      created_at: `${day} 12:00:00`,
      path: '/',
      origin: 'https://example.com',
      referrer: '',
      referrer_name: '',
      referrer_type: '',
      revenue: 0,
      duration: 0,
      properties: mode ? { level_mode: mode } : {},
      groups: [],
      country: 'US',
      city: '',
      region: '',
      sdk_name: 'web',
      sdk_version: '1.0.0',
      os: '',
      os_version: '',
      browser: 'Chrome',
      browser_version: '',
      device: 'desktop',
      brand: '',
      model: '',
    })),
  });
  await ch.insert({
    table: TABLE_NAMES.profiles,
    format: 'JSONEachRow',
    values: PROFILES.map(({ user, properties }) => ({
      id: user,
      is_external: true,
      first_name: '',
      last_name: '',
      email: '',
      avatar: '',
      properties,
      project_id: projectId,
      groups: [],
      created_at: `${day} 00:00:00.000`,
      last_seen_at: `${day} 12:00:00.000`,
    })),
  });
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (chReachable) {
    await teardown();
  }
}, 60_000);

const range = {
  projectId,
  filters: [],
  startDate: `${day} 00:00:00`,
  endDate: `${day} 23:59:59`,
  timezone: 'UTC',
};

async function chartEvents(event: IChartEvent): Promise<number> {
  const sql = await getAggregateChartSql({
    ...range,
    event,
    breakdowns: [],
    interval: 'day',
    chartType: 'linear',
    metric: 'sum',
    previous: false,
  } as never);
  const rows = await chQuery<{ count: number }>(sql, {
    session_timezone: 'UTC',
  });
  return rows.reduce((total, row) => total + Number(row.count), 0);
}

const serie = (extra: Partial<IChartEvent>): IChartEvent =>
  ({ id: 'A', name: 'level_start', segment: 'event', filters: [], ...extra }) as IChartEvent;

describe('chart and table count the same events for one filter group', () => {
  const cases: [string, IFilterGroup][] = [
    [
      'missingProperty on a profile property',
      {
        kind: 'group',
        op: 'and',
        children: [
          {
            kind: 'condition',
            filter: { name: 'profile.properties.plan', operator: 'missingProperty', value: [] },
          },
        ],
      },
    ],
    [
      'cross-scope OR',
      {
        kind: 'group',
        op: 'or',
        children: [
          // Table: u2 (profile with no plan) OR u1 (hard) = 2 events. Ignoring
          // the group gives 3; routing the profile branch through the join
          // also lets u9 in and gives 3. Only the shared route gives 2.
          {
            kind: 'condition',
            filter: { name: 'profile.properties.plan', operator: 'missingProperty', value: [] },
          },
          {
            kind: 'condition',
            filter: { name: 'properties.level_mode', operator: 'is', value: ['hard'] },
          },
        ],
      },
    ],
  ];

  for (const [label, filterGroup] of cases) {
    it(label, async (ctx) => {
      if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

      const table = await overviewService.getEventAnalyticsTotals({
        ...range,
        filterGroup,
      });

      const chart = await chartEvents(serie({ filterGroup }));

      expect(chart).toBe(table.events);
      // Guard against a vacuous pass: the group must actually filter.
      expect(table.events).toBeLessThan(EVENTS.length);
    });
  }

  it('pins the divergence the group route exists to avoid', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const filters = [
      { name: 'profile.properties.plan', operator: 'missingProperty' as const, value: [] },
    ];
    const table = await overviewService.getEventAnalyticsTotals({ ...range, filters });

    // The table keeps only u2: u9 has no profile row, so the subselect drops it.
    expect(table.events).toBe(1);
    // The flat chart route joins the profile CTE, where u9 reads '' and passes.
    // This is why the Event Analytics chart always sends a group.
    expect(await chartEvents(serie({ filters }))).toBe(2);
  });
});
