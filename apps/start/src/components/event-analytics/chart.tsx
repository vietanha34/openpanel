import { ReportChart } from '@/components/report-chart';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ChartColumnIcon,
  ChartLineIcon,
  Minimize2Icon,
  MoveDiagonalIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  type IChartEventFilter,
  type IChartRange,
  type IChartType,
  type IEventAnalyticsMetric,
  metricKey,
} from '@openpanel/validation';

import type {
  EventAnalyticsChartGranularity,
  EventAnalyticsSelection,
} from './chart-input';
import {
  buildEventAnalyticsChartInput,
  chartSegmentFor,
  resolveChartMetric,
} from './chart-input';
import { chipLabel } from './metrics-state';

export type {
  EventAnalyticsChartGranularity,
  EventAnalyticsSelection,
} from './chart-input';

const GRANULARITY_LABEL: Record<EventAnalyticsChartGranularity, string> = {
  hour: 'Hour',
  day: 'Day',
  week: 'Week',
};

type EventAnalyticsChartProps = {
  projectId: string;
  range: IChartRange;
  startDate?: string | null;
  endDate?: string | null;
  filters: IChartEventFilter[];
  selected: EventAnalyticsSelection[];
  /** The table's chosen metrics; the select lists exactly these. */
  metrics: IEventAnalyticsMetric[];
  /** Persisted metric key; stale keys fall back via `resolveChartMetric`. */
  metric: string;
  onMetricChange: (metric: string) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

export function EventAnalyticsChart({
  projectId,
  range,
  startDate,
  endDate,
  filters,
  selected,
  metrics,
  metric: storedMetric,
  onMetricChange,
  collapsed,
  onCollapsedChange,
}: EventAnalyticsChartProps) {
  const metric = useMemo(
    () => resolveChartMetric(metrics, storedMetric),
    [metrics, storedMetric],
  );
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

  // Not rendering ReportChart is what keeps its query from running (§7).
  if (collapsed) {
    return (
      <div className="row justify-center">
        <Button
          variant="outline"
          className="h-8 gap-2 px-3.5 shadow-sm"
          onClick={() => onCollapsedChange(false)}
        >
          Show chart
          <MoveDiagonalIcon size={14} className="text-muted-foreground" />
        </Button>
      </div>
    );
  }

  return (
    <div className="col rounded-lg border bg-background">
      <div className="row flex-wrap items-center gap-2 border-b p-3">
        <Select value={metricKey(metric)} onValueChange={onMetricChange}>
          <SelectTrigger size="sm" aria-label="Chart metric">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {metrics.map((item) => {
              const chartable = chartSegmentFor(item) !== null;
              return (
                <SelectItem
                  key={metricKey(item)}
                  value={metricKey(item)}
                  disabled={!chartable}
                >
                  {chipLabel(item)}
                  {/* A disabled item swallows pointer events, so a title
                      tooltip would never show: say it inline. */}
                  {!chartable && (
                    <span className="text-muted-foreground">
                      · not in chart
                    </span>
                  )}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground text-xs">
          {selected.length > 0
            ? `${selected.length} series plotted`
            : 'no series plotted'}
        </span>
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
        <Button
          variant="outline"
          size="icon"
          className="h-[30px] w-8"
          title="Hide chart"
          aria-label="Hide chart"
          onClick={() => onCollapsedChange(true)}
        >
          <Minimize2Icon size={15} />
        </Button>
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
