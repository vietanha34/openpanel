import { ReportChart } from '@/components/report-chart';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChartColumnIcon, ChartLineIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import type {
  IChartBreakdown,
  IChartEventItem,
  IChartEventSegment,
  IChartEventFilter,
  IChartType,
  IInterval,
  IReportInput,
  IRange,
} from '@openpanel/validation';

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

const METRIC_LABEL: Record<EventAnalyticsChartMetric, string> = {
  events: 'Events',
  users: 'Users',
  epu: 'Events per user',
};

const GRANULARITY_LABEL: Record<EventAnalyticsChartGranularity, string> = {
  hour: 'Hour',
  day: 'Day',
  week: 'Week',
};

type BuildChartInputArgs = {
  projectId: string;
  range: IRange;
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
}: BuildChartInputArgs): IReportInput {
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

  const series: IChartEventItem[] = events.map((event) => ({
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

type EventAnalyticsChartProps = {
  projectId: string;
  range: IRange;
  startDate?: string | null;
  endDate?: string | null;
  filters: IChartEventFilter[];
  selected: EventAnalyticsSelection[];
};

export function EventAnalyticsChart({
  projectId,
  range,
  startDate,
  endDate,
  filters,
  selected,
}: EventAnalyticsChartProps) {
  const [metric, setMetric] = useState<EventAnalyticsChartMetric>('events');
  const [granularity, setGranularity] =
    useState<EventAnalyticsChartGranularity>('day');
  const [chartType, setChartType] =
    useState<Extract<IChartType, 'linear' | 'bar'>>('linear');

  const report = useMemo(
    () =>
      buildEventAnalyticsChartInput({
        projectId,
        range,
        startDate,
        endDate,
        filters,
        selected,
        metric,
        granularity,
        chartType,
      }),
    [
      projectId,
      range,
      startDate,
      endDate,
      filters,
      selected,
      metric,
      granularity,
      chartType,
    ],
  );

  return (
    <div className="col rounded-lg border bg-background">
      <div className="row flex-wrap items-center gap-2 border-b p-3">
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={metric}
          onValueChange={(value) =>
            value && setMetric(value as EventAnalyticsChartMetric)
          }
        >
          {Object.entries(METRIC_LABEL).map(([value, label]) => (
            <ToggleGroupItem key={value} value={value} aria-label={label}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="flex-1" />
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={granularity}
          onValueChange={(value) =>
            value && setGranularity(value as EventAnalyticsChartGranularity)
          }
        >
          {Object.entries(GRANULARITY_LABEL).map(([value, label]) => (
            <ToggleGroupItem key={value} value={value} aria-label={label}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={chartType}
          onValueChange={(value) =>
            value && setChartType(value as 'linear' | 'bar')
          }
        >
          <ToggleGroupItem value="linear" aria-label="Line chart">
            <ChartLineIcon size={15} />
          </ToggleGroupItem>
          <ToggleGroupItem value="bar" aria-label="Bar chart">
            <ChartColumnIcon size={15} />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="p-3">
        {report.series.length === 0 ? (
          <div className="center-center h-40 text-muted-foreground text-sm">
            Select rows in the table to plot them
          </div>
        ) : (
          <ReportChart report={report} options={{}} />
        )}
      </div>
    </div>
  );
}
