/**
 * Chart segments for the Event Analytics parameter metrics (B3).
 *
 * Each one must compute exactly the table's aggregate
 * (`eventAnalyticsMetricExpression`, spec 2026-09-16 §5) — in particular a
 * missing or non-numeric parameter counts as 0 (§3 D4), which the older
 * `property_*` segments do not do: they drop those events in WHERE.
 */

import type { IEventAnalyticsMetric } from '@openpanel/validation';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ch, chQuery } from '../clickhouse/client';
import {
  getAggregateChartSql as _getAggregateChartSql,
  getChartSql as _getChartSql,
} from './chart.service';
import {
  EVENT_ANALYTICS_BLUEPRINT,
  EVENT_ANALYTICS_FIXTURE,
  setupEventAnalyticsFixtures,
  teardownEventAnalyticsFixtures,
} from './event-analytics-fixtures';
import { eventAnalyticsMetricExpression } from './overview.service';

// The SQL builders ignore the display-only fields of their input type.
const getChartSql: (input: any) => Promise<string> = _getChartSql as any;
const getAggregateChartSql: (input: any) => Promise<string> =
  _getAggregateChartSql as any;

const projectId = 'test-event-analytics-chart-segments';
const PARAM = 'payload.lives_left';

/** Table metric id -> chart segment, as `chart-input.ts` maps them. */
const SEGMENTS = {
  sum_param: 'property_sum_missing_zero',
  avg_param: 'property_average_missing_zero',
  median_param: 'property_median_missing_zero',
  uniq_param: 'property_unique_missing_zero',
  sum_param_user: 'property_sum_per_user_missing_zero',
  uniq_param_user: 'property_unique_per_user_missing_zero',
} as const;

type ParamMetricId = keyof typeof SEGMENTS;
const METRIC_IDS = Object.keys(SEGMENTS) as ParamMetricId[];

const input = (segment: string) => ({
  event: {
    id: 'A',
    name: 'level_start',
    segment,
    property: `properties.${PARAM}`,
    filters: [],
  },
  breakdowns: [],
  projectId,
  ...EVENT_ANALYTICS_FIXTURE.range,
});

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
  await setupEventAnalyticsFixtures(projectId);
  // Lightweight deletes queue behind other suites' mutations.
}, 60_000);

afterAll(async () => {
  if (chReachable) {
    await teardownEventAnalyticsFixtures(projectId);
  }
  vi.restoreAllMocks();
}, 60_000);

describe.each(METRIC_IDS)('%s chart segment', (id) => {
  const segment = SEGMENTS[id];
  const metric: IEventAnalyticsMetric = { id, param: PARAM };

  it('selects the table aggregate over every event, with no property WHERE', async () => {
    const tableExpression = eventAnalyticsMetricExpression(metric);
    // The chart aliases the events table as `e`; otherwise identical.
    const chartExpression = tableExpression?.replaceAll(
      'properties[',
      'e.properties['
    );

    for (const sql of [
      await getChartSql({ ...input(segment), interval: 'day', timezone: 'UTC' }),
      await getAggregateChartSql({ ...input(segment), timezone: 'UTC' }),
    ]) {
      expect(sql).toContain(`${chartExpression} as count`);
      expect(sql).not.toContain('notEmpty(');
      expect(sql).not.toContain('IS NOT NULL');
    }
  });

  it('parses in ClickHouse', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    await ch.command({
      query: `EXPLAIN ${await getChartSql({ ...input(segment), interval: 'day', timezone: 'UTC' })}`,
    });
    await ch.command({
      query: `EXPLAIN ${await getAggregateChartSql({ ...input(segment), timezone: 'UTC' })}`,
    });
  });

  // Every fixture event sits on one day, so the day series has one non-zero
  // bucket, and that bucket is the table's number for the node.
  it('plots the same value as the table on the fixture', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const rows = await chQuery<{ count: number }>(
      await getChartSql({ ...input(segment), interval: 'day', timezone: 'UTC' })
    );
    const plotted = rows.reduce((total, row) => total + Number(row.count), 0);

    expect(plotted).toBeCloseTo(
      EVENT_ANALYTICS_BLUEPRINT.livesLeftOnLevelStart[id],
      10
    );
  });
});

// The case that decides the whole task: the old segment averages only the four
// events carrying the parameter.
it('plots avg_param as 2.25 where property_average plots 4.5', async (ctx) => {
  if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

  const plot = async (segment: string) => {
    const rows = await chQuery<{ count: number }>(
      await getChartSql({ ...input(segment), interval: 'day', timezone: 'UTC' })
    );
    return rows.reduce((total, row) => total + Number(row.count), 0);
  };

  expect(await plot('property_average_missing_zero')).toBe(2.25);
  expect(await plot('property_average')).toBe(4.5);
});
