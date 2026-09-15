import type {
  IChartBreakdown,
  IChartEventFilter,
  IChartEventItem,
  IChartEventSegment,
  IChartRange,
  IChartType,
  IInterval,
  IReportInput,
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

export type EventAnalyticsChartMetric = 'events' | 'users' | 'epu';
export type EventAnalyticsChartGranularity = 'hour' | 'day' | 'week';

const METRIC_SEGMENT: Record<EventAnalyticsChartMetric, IChartEventSegment> = {
  events: 'event',
  users: 'user',
  epu: 'user_average',
};

type BuildChartInputArgs = {
  projectId: string;
  range: IChartRange;
  startDate?: string | null;
  endDate?: string | null;
  filters: IChartEventFilter[];
  selected: EventAnalyticsSelection[];
  metric: EventAnalyticsChartMetric;
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
  const segment = METRIC_SEGMENT[metric];
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
    segment,
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

