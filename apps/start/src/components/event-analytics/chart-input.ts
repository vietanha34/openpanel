import {
  type IChartBreakdown,
  type IChartEventFilter,
  type IChartEventItem,
  type IChartEventSegment,
  type IChartRange,
  type IChartType,
  type IEventAnalyticsMetric,
  type IInterval,
  type IReportInput,
  metricKey,
} from '@openpanel/validation';

/**
 * Pure part of the chart panel. Kept free of React and of `@/` alias imports so
 * it runs under the standalone vitest config in this folder.
 */

/** An event series — the only series kind this panel builds. */
type EventSerie = Extract<IChartEventItem, { type: 'event' }>;

/** One row selected in the tree table. Shared shape with the table (T4). */
export type EventAnalyticsSelection = {
  /** Flatten path, `/event` or `/event/key`. Only depth <= 1 is selectable. */
  path: string;
  color: string;
};

export type EventAnalyticsChartGranularity = 'hour' | 'day' | 'week';

type ChartSegment = { segment: IChartEventSegment; property?: string };

/**
 * The report chart segment that computes a metric exactly as the table does,
 * or null when none exists.
 *
 * Deliberately absent: `avg_param` — `property_average` averages only the
 * events that carry the parameter, where spec §3 D4 counts a missing value as
 * 0. `sum_param` can use `property_sum` because a skipped event adds the same
 * nothing a 0 would. Every other metric has no report segment at all; plotting
 * them means adding segments to the chart service first.
 */
export function chartSegmentFor(
  metric: IEventAnalyticsMetric,
): ChartSegment | null {
  switch (metric.id) {
    case 'events':
      return { segment: 'event' };
    case 'users':
      return { segment: 'user' };
    case 'epu':
      return { segment: 'user_average' };
    case 'sum_param':
      return metric.param
        ? { segment: 'property_sum', property: `properties.${metric.param}` }
        : null;
    default:
      return null;
  }
}

/**
 * The metric the chart plots: the stored key while it is still in the chosen
 * set and chartable, otherwise the first chartable metric of the set — e.g.
 * after the Metrics dialog removed the one being plotted. `events` is locked
 * in the set, so the final fallback is only reached by a malformed set.
 */
export function resolveChartMetric(
  metrics: IEventAnalyticsMetric[],
  storedKey: string,
): IEventAnalyticsMetric {
  const chartable = metrics.filter((metric) => chartSegmentFor(metric));
  return (
    chartable.find((metric) => metricKey(metric) === storedKey) ??
    chartable[0] ?? { id: 'events' }
  );
}

type BuildChartInputArgs = {
  projectId: string;
  range: IChartRange;
  startDate?: string | null;
  endDate?: string | null;
  filters: IChartEventFilter[];
  selected: EventAnalyticsSelection[];
  metric: IEventAnalyticsMetric;
  granularity: EventAnalyticsChartGranularity;
  chartType: Extract<IChartType, 'linear' | 'bar'>;
};

/**
 * Turns the table selection into a report input.
 *
 * `startDate`/`endDate` travel with `range` so a custom date range is not
 * silently dropped (R4) — `ReportChartShortcut` only forwards `range`.
 *
 * ponytail: `breakdowns` are report-wide, so selecting two events with
 * different property keys breaks both events down by both keys. Per-series
 * breakdowns would have to be added to the report contract first.
 */
export function buildEventAnalyticsChartInput({
  projectId,
  range,
  startDate,
  endDate,
  filters,
  selected,
  metric,
  granularity,
  chartType,
}: BuildChartInputArgs): Omit<IReportInput, 'series'> & {
  series: EventSerie[];
} {
  const segment = chartSegmentFor(metric) ?? { segment: 'event' as const };
  const events: string[] = [];
  const keys: string[] = [];

  for (const { path } of selected) {
    const [event, key] = path.split('/').filter(Boolean);
    if (!event) {
      continue;
    }
    if (!events.includes(event)) {
      events.push(event);
    }
    if (key && !keys.includes(key)) {
      keys.push(key);
    }
  }

  const series: EventSerie[] = events.map((event) => ({
    id: event,
    name: event,
    displayName: event,
    ...segment,
    filters,
    type: 'event',
  }));

  const breakdowns: IChartBreakdown[] = keys.map((name) => ({ name }));

  return {
    projectId,
    range,
    startDate,
    endDate,
    interval: granularity satisfies IInterval,
    chartType,
    series,
    breakdowns,
    previous: false,
    lineType: 'monotone',
    metric: 'sum',
  };
}

