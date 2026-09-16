import { ReportChart } from '@/components/report-chart';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ChartColumnIcon,
  ChartLineIcon,
  Minimize2Icon,
  MoveDiagonalIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import type { IChartEventFilter, IChartRange, IChartType } from '@openpanel/validation';

import type {
  EventAnalyticsChartGranularity,
  EventAnalyticsChartMetric,
  EventAnalyticsSelection,
} from './chart-input';
import { buildEventAnalyticsChartInput } from './chart-input';

export type {
  EventAnalyticsChartGranularity,
  EventAnalyticsChartMetric,
  EventAnalyticsSelection,
} from './chart-input';

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

type EventAnalyticsChartProps = {
  projectId: string;
  range: IChartRange;
  startDate?: string | null;
  endDate?: string | null;
  filters: IChartEventFilter[];
  selected: EventAnalyticsSelection[];
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
  collapsed,
  onCollapsedChange,
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
