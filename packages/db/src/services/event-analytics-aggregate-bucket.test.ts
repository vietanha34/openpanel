/**
 * Pins the invariant the chart's per-serie totals rely on (B8).
 *
 * `format.ts` builds `metrics.sum` by adding up a serie's buckets. That is only
 * a correct total for additive metrics. The Event Analytics bar chart still
 * shows the right number for non-additive ones (`epu`, averages, per-user
 * ratios) because it reads the aggregate endpoint, and `getAggregateChartSql`
 * returns ONE bucket per serie covering the whole range. If the aggregate query
 * ever groups by interval, those totals silently become sums of ratios — these
 * tests go red first.
 *
 * Dataset: 7 days, a different user each day, 2 `level_start` events per day.
 * One of each day's two events carries `lives_left = 4`, the other has none.
 * Whole period: 14 events / 7 users = epu 2; (7 × 4) / 14 events = avg 2.
 * Per day both are also 2, so summing the 7 day buckets gives 14.
 */

import { afterAll, beforeAll, expect, it, vi } from 'vitest';

import { TABLE_NAMES, ch, chQuery } from '../clickhouse/client';
import {
  getAggregateChartSql as _getAggregateChartSql,
  getChartSql as _getChartSql,
} from './chart.service';
import { teardownEventAnalyticsFixtures } from './event-analytics-fixtures';

// The SQL builders ignore the display-only fields of their input type.
const getChartSql: (input: any) => Promise<string> = _getChartSql as any;
const getAggregateChartSql: (input: any) => Promise<string> =
  _getAggregateChartSql as any;

const projectId = 'test-event-analytics-aggregate-bucket';
const DAYS = 7;
const range = {
  startDate: '2024-03-01 00:00:00',
  endDate: '2024-03-07 23:59:59',
  timezone: 'UTC',
};

const input = (segment: string) => ({
  event: {
    id: 'A',
    name: 'level_start',
    segment,
    property: 'properties.lives_left',
    filters: [],
  },
  breakdowns: [],
  projectId,
  ...range,
});

function buildEvents() {
  return Array.from({ length: DAYS * 2 }, (_, index) => {
    const day = Math.floor(index / 2) + 1;
    const user = `agg-u${day}`;
    return {
      id: `00000000-0000-4000-9b08-${String(index + 1).padStart(12, '0')}`,
      project_id: projectId,
      profile_id: user,
      device_id: `dev-${user}`,
      name: 'level_start',
      session_id: `sess-${user}`,
      created_at: `2024-03-0${day} 12:00:00`,
      path: '/',
      origin: 'https://example.com',
      referrer: '',
      referrer_name: '',
      referrer_type: '',
      revenue: 0,
      duration: 0,
      properties: index % 2 === 0 ? { lives_left: '4' } : {},
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
    };
  });
}

let chReachable = false;

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await ch.command({ query: 'SELECT 1' });
    chReachable = true;
  } catch {
    chReachable = false;
    return;
  }
  await teardownEventAnalyticsFixtures(projectId);
  await ch.insert({
    table: TABLE_NAMES.events,
    values: buildEvents(),
    format: 'JSONEachRow',
  });
}, 60_000);

afterAll(async () => {
  if (chReachable) {
    await teardownEventAnalyticsFixtures(projectId);
  }
  vi.restoreAllMocks();
}, 60_000);

it.for([
  // epu in the table, `user_average` in the chart.
  ['user_average', 2],
  // avg_param in the table: missing counts as 0, so 28 / 14 events.
  ['property_average_missing_zero', 2],
] as const)(
  'aggregates %s into one whole-period bucket equal to the table value',
  async ([segment, tableValue], ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const aggregate = await chQuery<{ count: number }>(
      await getAggregateChartSql(input(segment))
    );
    expect(aggregate).toHaveLength(1);
    expect(Number(aggregate[0]?.count)).toBe(tableValue);

    // The failure mode the invariant prevents: a total built from day buckets.
    const daily = await chQuery<{ count: number }>(
      await getChartSql({ ...input(segment), interval: 'day' })
    );
    const summed = daily.reduce((total, row) => total + Number(row.count), 0);
    expect(summed).toBe(tableValue * DAYS);
  }
);
