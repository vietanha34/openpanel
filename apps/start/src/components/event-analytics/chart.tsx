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
import { useNumber } from '@/hooks/use-numer-formatter';
import { useTRPC } from '@/integrations/trpc/react';
import { cn } from '@/utils/cn';
import { getChartColor } from '@/utils/theme';
import { useQueries } from '@tanstack/react-query';
import {
  ChartColumnIcon,
  ChartLineIcon,
  Columns3Icon,
  LayersIcon,
  Minimize2Icon,
  MoveDiagonalIcon,
} from 'lucide-react';
import { type MouseEvent, useMemo, useState } from 'react';

import {
  type IChartEventFilter,
  type IChartRange,
  type IChartType,
  type IEventAnalyticsMetric,
  type IFilterGroup,
  metricKey,
} from '@openpanel/validation';

import type {
  EventAnalyticsChartGranularity,
  EventAnalyticsSelection,
} from './chart-input';
import {
  buildComparisonChartInputs,
  buildEventAnalyticsChartInput,
  chartSegmentFor,
  resolveChartMetric,
} from './chart-input';
import {
  axisLabels,
  buildOverlay,
  buildSplitPanels,
  legendRows,
  tooltipAnchor,
  mergeComparisonSeries,
  tooltipColumns,
  tooltipRows,
  tooltipWidth,
  OVERLAY_HEIGHT,
  OVERLAY_WIDTH,
  SPLIT_HEIGHT,
} from './comparison-chart';
import {
  COMPARISON_MARKS,
  type BaselinePeriod,
  type ComparisonState,
  comparisonPeriodChips,
  periodsForRequest,
  toggleFocusPeriod,
} from './comparison-state';
import { chipLabel } from './metrics-state';
import { axisLabel } from './periods';

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
  /** The table's advanced filter group; the chart must filter exactly as it. */
  filterGroup?: IFilterGroup;
  selected: EventAnalyticsSelection[];
  /** The table's chosen metrics; the select lists exactly these. */
  metrics: IEventAnalyticsMetric[];
  /** Persisted metric key; stale keys fall back via `resolveChartMetric`. */
  metric: string;
  onMetricChange: (metric: string) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Comparison mode; absent means the plain one-period chart. */
  comparison?: ComparisonState;
  /** The period comparison steps back from, or null for a range it cannot. */
  baseline?: BaselinePeriod | null;
  onComparisonChange?: (next: ComparisonState) => void;
};

export function EventAnalyticsChart({
  projectId,
  range,
  startDate,
  endDate,
  filters,
  filterGroup,
  selected,
  metrics,
  metric: storedMetric,
  onMetricChange,
  collapsed,
  onCollapsedChange,
  comparison,
  baseline,
  onComparisonChange,
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
        filterGroup,
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
      filterGroup,
      selected,
      metric,
      granularity,
      chartType,
    ],
  );

  const comparing = Boolean(comparison?.compare && baseline);
  const comparisonInputs = useMemo(() => {
    if (!(comparison && baseline && comparing)) {
      return [];
    }
    const periods = periodsForRequest(
      comparison,
      baseline.anchorStart,
      baseline.periodDays,
    );
    if (!periods) {
      return [];
    }
    // Same builder as the plain chart: only the dates differ, so a compared
    // number can never drift from the number the ordinary chart shows.
    return buildComparisonChartInputs({
      projectId,
      range,
      startDate,
      endDate,
      filters,
      filterGroup,
      selected,
      metric,
      granularity,
      chartType,
      periods,
    });
  }, [
    comparison,
    baseline,
    comparing,
    projectId,
    range,
    startDate,
    endDate,
    filters,
    filterGroup,
    selected,
    metric,
    granularity,
    chartType,
  ]);

  // Not rendering ReportChart is what keeps its query from running (§7).
  if (collapsed) {
    return (
      <div className="row justify-center">
        <Button
          variant="outline"
          className="h-8 gap-2 rounded-lg px-3.5 text-[13px] shadow-sm"
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
                      tooltip would never show: say it inline. Only epau and
                      pctu get here; see chartSegmentFor. */}
                  {!chartable && (
                    <span className="text-muted-foreground">
                      · not in chart: needs all users per interval
                    </span>
                  )}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <span className="text-[12px] text-muted-foreground">
          {selected.length > 0
            ? `${selected.length} series plotted`
            : 'no series plotted'}
        </span>
        {comparing && comparison && onComparisonChange && (
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={comparison.compareView}
            onValueChange={(value) =>
              value &&
              onComparisonChange({
                ...comparison,
                compareView: value as ComparisonState['compareView'],
                // Split has no isolate; overlay keeps whatever was focused.
                focusPeriod: value === 'split' ? -1 : comparison.focusPeriod,
              })
            }
          >
            <ToggleGroupItem value="overlay" aria-label="Overlay">
              <LayersIcon size={14} />
              Overlay
            </ToggleGroupItem>
            <ToggleGroupItem value="split" aria-label="Split">
              <Columns3Icon size={14} />
              Split
            </ToggleGroupItem>
          </ToggleGroup>
        )}
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
      {comparing && comparison && baseline ? (
        <ComparisonChart
          baseline={baseline}
          granularity={granularity}
          inputs={comparisonInputs}
          onComparisonChange={onComparisonChange}
          state={comparison}
        />
      ) : (
        <div className="p-3">
          {report.series.length === 0 ? (
            <div className="center-center h-40 text-muted-foreground text-sm">
              Select rows in the table to plot them
            </div>
          ) : (
            <ReportChart report={report} options={{}} />
          )}
        </div>
      )}
    </div>
  );
}

/** Tooltip delta colours — read on the tooltip's dark background. */
const DELTA_UP = '#34d399';
const DELTA_DOWN = '#f87171';
/** Split panel delta colours — read on white, so darker than the tooltip's. */
const PANEL_DELTA_UP = '#047857';
const PANEL_DELTA_DOWN = '#dc2626';

type ComparisonChartProps = {
  inputs: ReturnType<typeof buildComparisonChartInputs>;
  state: ComparisonState;
  baseline: BaselinePeriod;
  /** Picks the axis tick format: hourly buckets need the hour, not the date. */
  granularity: EventAnalyticsChartGranularity;
  onComparisonChange?: (next: ComparisonState) => void;
};

/**
 * The overlay view (design 3c / 3e): one line per period per series, all in the
 * series' colour, told apart by weight, opacity and dash.
 *
 * `ReportChart` cannot express that — its options carry no per-series stroke and
 * no custom tooltip, and it fetches internally — so comparison draws its own
 * SVG from the same query the ordinary chart uses. The plain chart above is
 * untouched.
 */
function ComparisonChart({
  inputs,
  state,
  baseline,
  granularity,
  onComparisonChange,
}: ComparisonChartProps) {
  const trpc = useTRPC();
  const number = useNumber();
  const [hoverBucket, setHoverBucket] = useState<number | null>(null);

  const results = useQueries({
    queries: inputs.map((input) => trpc.chart.chart.queryOptions(input)),
  });
  const series = mergeComparisonSeries(
    results.map((result) => result.data),
    getChartColor,
  );
  const overlay = buildOverlay({
    series,
    periodCount: inputs.length,
    focusPeriod: state.focusPeriod,
  });
  // The x axis is period A's own dates.
  const dates = results[0]?.data?.series[0]?.data.map((point) => point.date) ?? [];
  const chips = comparisonPeriodChips(
    state,
    baseline.anchorStart,
    baseline.periodDays,
  );
  const bucket =
    hoverBucket === null
      ? null
      : Math.min(Math.max(hoverBucket, 0), Math.max(0, overlay.buckets - 1));

  const readDelta = (
    delta: number | null,
    colors: { up: string; down: string } = { up: DELTA_UP, down: DELTA_DOWN },
  ) => {
    if (delta === null) {
      // Nothing to compare against — never `0.00 %`, which would claim
      // "unchanged" (spec A3).
      return { text: '—', color: 'inherit' };
    }
    if (Math.abs(delta) < 0.005) {
      return { text: '', color: 'inherit' };
    }
    return {
      text: `${delta > 0 ? '+' : ''}${delta.toFixed(2)}%`,
      color: delta > 0 ? colors.up : colors.down,
    };
  };

  const bucketLabels = dates.map((date) => axisLabel(new Date(date), granularity));

  if (state.compareView === 'split') {
    const panels = buildSplitPanels({
      series,
      periodCount: inputs.length,
      anchorStart: baseline.anchorStart,
      periodDays: baseline.periodDays,
      bucketLabels,
    });

    return (
      <div className="col gap-3 p-3.5">
        {panels.length === 0 ? (
          <div className="center-center h-40 text-muted-foreground text-sm">
            {results.some((result) => result.isLoading)
              ? 'Loading trend…'
              : 'Select rows in the table to plot them'}
          </div>
        ) : (
          <>
            <div className="row items-stretch gap-3">
              {panels.map((panel) => {
                const delta = readDelta(panel.delta, {
                  up: PANEL_DELTA_UP,
                  down: PANEL_DELTA_DOWN,
                });
                return (
                  <button
                    // Back to overlay, isolated on the panel that was clicked.
                    className="col min-w-0 flex-1 basis-0 rounded-lg border bg-background px-2.5 pt-2.5 pb-2 text-left hover:bg-def-100"
                    key={panel.letter}
                    onClick={() =>
                      onComparisonChange?.({
                        ...state,
                        compareView: 'overlay',
                        focusPeriod: panel.period,
                      })
                    }
                    type="button"
                  >
                    <div className="row items-center gap-1.5 pb-2">
                      <span
                        className={cn(
                          'row size-[19px] items-center justify-center rounded-[5px] font-mono text-[11px] font-semibold',
                          panel.period === 0
                            ? 'bg-highlight/10 text-highlight'
                            : 'bg-def-100 text-muted-foreground',
                        )}
                      >
                        {panel.letter}
                      </span>
                      <span className="flex-1 truncate font-medium text-[12px]">
                        {panel.range}
                      </span>
                      <span className="font-mono text-[10px] text-def-400">
                        {panel.mark}
                      </span>
                    </div>
                    <svg
                      aria-label={`Period ${panel.letter}`}
                      className="block w-full"
                      height={SPLIT_HEIGHT}
                      preserveAspectRatio="none"
                      role="img"
                      viewBox={`0 0 ${OVERLAY_WIDTH} ${SPLIT_HEIGHT}`}
                    >
                      {panel.grid.map((line) => (
                        <line
                          className="text-border"
                          key={line.y}
                          stroke="currentColor"
                          strokeWidth={1}
                          vectorEffect="non-scaling-stroke"
                          x1={0}
                          x2={OVERLAY_WIDTH}
                          y1={line.y}
                          y2={line.y}
                        />
                      ))}
                      {panel.lines.map((line) => (
                        <path
                          d={line.path}
                          fill="none"
                          key={line.key}
                          stroke={line.color}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          vectorEffect="non-scaling-stroke"
                        />
                      ))}
                    </svg>
                    <div className="row items-center gap-2 border-t pt-1.5">
                      <span className="font-mono text-[10px] text-def-400">
                        {panel.xFirst}
                      </span>
                      <span className="font-mono text-[10px] text-def-400">
                        →
                      </span>
                      <span className="font-mono text-[10px] text-def-400">
                        {panel.xLast}
                      </span>
                      <div className="flex-1" />
                      <span className="font-mono font-semibold text-[12px]">
                        {number.short(panel.total)}
                      </span>
                      <span
                        className="font-mono text-[11px]"
                        style={{
                          color:
                            panel.period === 0 ? undefined : delta.color,
                        }}
                      >
                        {panel.period === 0 ? 'baseline' : delta.text}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="row flex-wrap items-center gap-4 border-t pt-2.5">
              {series.map((serie) => (
                <div className="row items-center gap-1.5" key={serie.key}>
                  <span
                    className="size-[9px] rounded-[2px]"
                    style={{ background: serie.color }}
                  />
                  <span className="font-mono text-[11px]">{serie.label}</span>
                </div>
              ))}
              <div className="flex-1" />
              <span className="text-[11px] text-def-400">
                {inputs.length} panels · shared y axis · Δ of all plotted series
                vs A
              </span>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="row flex-wrap items-center gap-2 border-b px-3.5 py-2.5">
        <span className="font-medium text-[11px] text-muted-foreground tracking-wide">
          PERIODS
        </span>
        {chips.map((chip) => (
          <button
            className={cn(
              'row h-[26px] items-center gap-1.5 rounded-full border px-2.5 text-[12px]',
              state.focusPeriod === chip.index
                ? 'bg-foreground text-background'
                : 'bg-background hover:bg-def-100',
            )}
            key={chip.letter}
            onClick={() =>
              onComparisonChange?.(toggleFocusPeriod(state, chip.index))
            }
            type="button"
          >
            <span className="font-mono font-semibold text-[11px]">
              {chip.letter}
            </span>
            <span className="font-mono text-[11px] opacity-70">
              {COMPARISON_MARKS[chip.index]}
            </span>
            {chip.range}
          </button>
        ))}
        <span className="text-[11px] text-muted-foreground">
          Click a period to isolate it · line weight fades with age
        </span>
      </div>
      <div className="relative p-3.5">
        {series.length === 0 ? (
          <div className="center-center h-40 text-muted-foreground text-sm">
            {results.some((result) => result.isLoading)
              ? 'Loading trend…'
              : 'Select rows in the table to plot them'}
          </div>
        ) : (
          <>
            <button
              className="block w-full cursor-crosshair"
              onMouseLeave={() => setHoverBucket(null)}
              onMouseMove={(event: MouseEvent<HTMLButtonElement>) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const ratio = (event.clientX - rect.left) / rect.width;
                setHoverBucket(
                  Math.round(ratio * Math.max(0, overlay.buckets - 1)),
                );
              }}
              type="button"
            >
              <svg
                aria-label="Comparison overlay"
                className="block w-full overflow-visible"
                height={OVERLAY_HEIGHT}
                preserveAspectRatio="none"
                role="img"
                viewBox={`0 0 ${OVERLAY_WIDTH} ${OVERLAY_HEIGHT}`}
              >
                {overlay.grid.map((line) => (
                  <line
                    key={line.y}
                    stroke="currentColor"
                    strokeWidth={1}
                    className="text-border"
                    vectorEffect="non-scaling-stroke"
                    x1={0}
                    x2={OVERLAY_WIDTH}
                    y1={line.y}
                    y2={line.y}
                  />
                ))}
                {overlay.lines.map((line) => (
                  <path
                    d={line.path}
                    fill="none"
                    key={`${line.key}-${line.period}`}
                    stroke={line.color}
                    strokeDasharray={line.dash}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeOpacity={line.opacity}
                    strokeWidth={line.width}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {bucket !== null && (
                  <line
                    stroke="#798290"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    x1={overlay.crosshairX(bucket)}
                    x2={overlay.crosshairX(bucket)}
                    y1={0}
                    y2={OVERLAY_HEIGHT}
                  />
                )}
              </svg>
            </button>
            <div className="row justify-between pt-2">
              {axisLabels(bucketLabels).map((label) => (
                <span
                  className="font-mono text-[10px] text-muted-foreground"
                  key={label}
                >
                  {label}
                </span>
              ))}
            </div>
            <div className="row flex-wrap items-center gap-4 border-t pt-2.5">
              {legendRows({ series, periodCount: inputs.length }).map((row) => (
                <div className="row items-center gap-1.5" key={row.key}>
                  <span
                    className="size-[9px] rounded-[2px]"
                    style={{ background: row.color }}
                  />
                  <span className="font-mono text-[11px]">{row.label}</span>
                  {row.cells.map((cell, index) => (
                    <span
                      className={cn(
                        'font-mono text-[11px]',
                        index === 0
                          ? 'text-muted-foreground'
                          : 'text-def-400',
                      )}
                      key={cell.mark}
                    >
                      {cell.mark} {number.short(cell.total)}
                    </span>
                  ))}
                </div>
              ))}
            </div>
            {bucket !== null && (
              <div
                className="pointer-events-none absolute top-[-6px] z-30 rounded-lg bg-foreground px-3.5 py-3 text-background shadow-lg"
                style={{
                  ...tooltipAnchor(bucket, overlay.buckets),
                  width: tooltipWidth(inputs.length),
                }}
              >
                <div className="row items-center gap-3 pb-2">
                  <span className="flex-1 font-semibold text-[12px]">
                    Compare periods
                  </span>
                  {tooltipColumns({
                    anchorStart: baseline.anchorStart,
                    periodDays: baseline.periodDays,
                    periodCount: inputs.length,
                    bucket,
                  }).map((column) => (
                    <span
                      className="w-[92px] shrink-0 text-right font-mono text-[11px] opacity-80"
                      key={column.label}
                    >
                      {column.mark} {column.label}
                    </span>
                  ))}
                </div>
                {tooltipRows({
                  series,
                  periodCount: inputs.length,
                  bucket,
                }).map((row) => (
                  <div className="row items-center gap-3 pt-1" key={row.key}>
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: row.color }}
                    />
                    <span className="flex-1 truncate text-[12px]">
                      {row.label}
                    </span>
                    {row.cells.map((cell, index) => {
                      const delta = readDelta(
                        index === 0 ? 0 : cell.delta,
                      );
                      return (
                        <span
                          className="w-[92px] shrink-0 text-right font-mono text-[12px]"
                          key={`period-${index}`}
                        >
                          {/* Δ first, then the value (design 3c). */}
                          <span
                            className="mr-1.5 text-[10px]"
                            style={{ color: delta.color }}
                          >
                            {delta.text}
                          </span>
                          {number.short(cell.value)}
                        </span>
                      );
                    })}
                  </div>
                ))}
                <div className="mt-2 border-white/15 border-t pt-2 font-mono text-[10px] opacity-70">
                  {bucketLabels[bucket] ?? ''} · A solid, earlier periods
                  dashed · Δ vs A
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
