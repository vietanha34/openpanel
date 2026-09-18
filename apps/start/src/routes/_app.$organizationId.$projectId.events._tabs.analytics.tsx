import {
  AdvancedFilterChips,
  advancedFilterChipCount,
  AdvancedFiltersPanel,
} from '@/components/event-analytics/advanced-filters-panel';
import {
  baselinePeriod,
  comparisonFromParams,
  comparisonToParams,
  cancelComparison,
  type ComparisonState,
  periodsForRequest,
} from '@/components/event-analytics/comparison-state';
import {
  ComparisonButton,
  ComparisonPeriodBar,
} from '@/components/event-analytics/comparison-toolbar';
import { filterRowState } from '@/components/event-analytics/filter-row';
import { EventAnalyticsChart } from '@/components/event-analytics/chart';
import {
  coldStartSelection,
  coldStartTrigger,
} from '@/components/event-analytics/chart-cold-start';
import { EventTreeTable } from '@/components/event-analytics/event-tree-table';
import { MetricsDialog } from '@/components/event-analytics/metrics-dialog';
import type { EventAnalyticsRangeInput } from '@/components/event-analytics/tree-nodes';
import {
  OverviewFilterButton,
  OverviewFiltersButtons,
} from '@/components/overview/filters/overview-filters-buttons';
import { OverviewRange } from '@/components/overview/overview-range';
import { useOverviewOptions } from '@/components/overview/useOverviewOptions';
import {
  useEventAnalyticsComparisonParams,
  useEventQueryFilterGroup,
  useEventQueryFilters,
  useEventQueryNamesFilter,
} from '@/hooks/use-event-query-filters';
import { useEventAnalyticsPrefs } from '@/hooks/use-event-analytics-prefs';
import { useTRPC } from '@/integrations/trpc/react';
import { getChartColor } from '@/utils/theme';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export const Route = createFileRoute(
  '/_app/$organizationId/$projectId/events/_tabs/analytics',
)({ component: EventAnalytics });

function EventAnalytics() {
  const { projectId } = Route.useParams();
  const { range, startDate, endDate } = useOverviewOptions();
  const [filters] = useEventQueryFilters();
  const [filterGroup, setFilterGroup] = useEventQueryFilterGroup();
  const [eventNames] = useEventQueryNamesFilter();

  // Comparison lives in the URL so a compared view can be shared (§3 D6).
  const [comparisonParams, setComparisonParams] =
    useEventAnalyticsComparisonParams();
  const comparison = useMemo(
    () => comparisonFromParams(comparisonParams),
    [comparisonParams],
  );
  const baseline = useMemo(
    () => baselinePeriod({ range, startDate, endDate }),
    [range, startDate, endDate],
  );
  const setComparison = useCallback(
    (next: ComparisonState) => setComparisonParams(comparisonToParams(next)),
    [setComparisonParams],
  );
  const periods = useMemo(
    () =>
      baseline
        ? periodsForRequest(comparison, baseline.anchorStart, baseline.periodDays)
        : undefined,
    [comparison, baseline],
  );

  const input: EventAnalyticsRangeInput = useMemo(
    () => ({
      projectId,
      range,
      startDate,
      endDate,
      filters,
      ...(filterGroup ? { filterGroup } : {}),
      ...(periods ? { periods } : {}),
    }),
    [projectId, range, startDate, endDate, filters, filterGroup, periods],
  );

  // Lifted here because the chart panel (T5) plots exactly these paths. The
  // persisted preferences own the selection, so it survives a reload (§6).
  const {
    status: prefsStatus,
    prefs,
    update: updatePrefs,
  } = useEventAnalyticsPrefs(projectId);
  const paths = prefs.selected;
  // Colour by position so the swatches stay dense after a removal.
  const selected = useMemo(
    () => paths.map((path, index) => ({ path, color: getChartColor(index) })),
    [paths],
  );
  const toggle = useCallback(
    (path: string) => {
      updatePrefs({
        selected: paths.includes(path)
          ? paths.filter((item) => item !== path)
          : [...paths, path],
      });
    },
    [paths, updatePrefs],
  );
  const selection = useMemo(() => ({ selected, toggle }), [selected, toggle]);

  // Cold start. On mount it runs only when nothing was stored (a stored empty
  // selection is a choice). Applying a filter re-seeds: Phase 3 R2 asks to drop
  // the previous selection and take the top rows of the filtered list, even
  // when the user picked those rows by hand.
  const trpc = useTRPC();
  const filterKey = useMemo(
    () => JSON.stringify([filters, filterGroup, eventNames]),
    [filters, filterGroup, eventNames],
  );
  const appliedFilterKey = useRef<string | null>(null);
  const [coldStartPending, setColdStartPending] = useState(true);
  const coldStartQuery = useInfiniteQuery(
    trpc.overview.eventAnalyticsList.infiniteQueryOptions(
      // Mirrors EventTreeTable's first request, so both share one fetch.
      {
        ...input,
        metrics: prefs.metrics,
        search: undefined,
        sort: prefs.sort.key,
        dir: prefs.sort.dir,
        limit: 10,
      },
      {
        initialCursor: 0,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: coldStartPending,
      },
    ),
  );
  const coldStartRows = coldStartQuery.data?.pages[0]?.rows;

  // A filter change re-arms the query; the effect below then seeds from its
  // rows. Kept out of the effect so the arming does not depend on row arrival.
  useEffect(() => {
    if (appliedFilterKey.current !== null && appliedFilterKey.current !== filterKey) {
      setColdStartPending(true);
    }
  }, [filterKey]);

  useEffect(() => {
    const trigger = coldStartTrigger({
      prefsStatus,
      selectedCount: paths.length,
      previousFilterKey: appliedFilterKey.current,
      filterKey,
    });

    if (trigger === 'wait' || !coldStartPending) {
      return;
    }

    if (trigger === 'none') {
      appliedFilterKey.current = filterKey;
      setColdStartPending(false);
      return;
    }

    // Both `seed` and `reseed` need the filtered list first.
    if (coldStartRows === undefined) {
      return;
    }

    appliedFilterKey.current = filterKey;
    setColdStartPending(false);

    const names = coldStartRows.map((row) => row.name);
    if (trigger === 'reseed') {
      updatePrefs({
        selected:
          coldStartSelection({
            names,
            selectedCount: 0,
            hasPersistedSelection: false,
          }) ?? [],
      });
      return;
    }

    const coldStart = coldStartSelection({
      names,
      selectedCount: paths.length,
      hasPersistedSelection: false,
    });
    if (coldStart) {
      updatePrefs({ selected: coldStart });
    }
  }, [
    coldStartPending,
    coldStartRows,
    prefsStatus,
    paths.length,
    filterKey,
    updatePrefs,
  ]);

  const setSort = useCallback(
    (sort: typeof prefs.sort) => updatePrefs({ sort }),
    [updatePrefs],
  );

  const setShowPct = useCallback(
    (pct: boolean) => updatePrefs({ pct }),
    [updatePrefs],
  );

  const setChartMetric = useCallback(
    (metric: string) => updatePrefs({ chart: { ...prefs.chart, metric } }),
    [prefs.chart, updatePrefs],
  );
  const setChartCollapsed = useCallback(
    (collapsed: boolean) =>
      updatePrefs({ chart: { ...prefs.chart, collapsed } }),
    [prefs.chart, updatePrefs],
  );

  const filterRow = filterRowState({
    flatFilters: filters.length,
    eventNames: eventNames.length,
    groupConditions: advancedFilterChipCount(filterGroup),
  });

  return (
    <div className="col gap-4">
      <div className="row flex-wrap gap-2">
        <OverviewRange />
        {/* Profile filters resolve through a profiles subselect since Phase 2
            P2 (#22); see the B1 plan. */}
        <OverviewFilterButton
          categories={['event', 'profile', 'group', 'cohort']}
          enableEventsFilter
        />
        <MetricsDialog
          projectId={projectId}
          metrics={prefs.metrics}
          sort={prefs.sort}
          disabled={prefsStatus === 'loading'}
          onApply={updatePrefs}
        />
        <AdvancedFiltersPanel onChange={setFilterGroup} value={filterGroup} />
        {/* Ranges without a fixed day count cannot be stepped back (I10), so
            the control is absent rather than offering a broken comparison. */}
        {baseline && (
          <ComparisonButton onChange={setComparison} state={comparison} />
        )}
      </div>
      {baseline && comparison.compare && (
        <ComparisonPeriodBar
          anchorStart={baseline.anchorStart}
          onCancel={() => {
            const next = cancelComparison(comparison, {
              sortKey: prefs.sort.key,
              chartMetric: prefs.chart.metric,
            });
            setComparison(next.state);
            updatePrefs({
              sort: { ...prefs.sort, key: next.sortKey },
              chart: { ...prefs.chart, metric: next.chartMetric },
            });
          }}
          onChange={setComparison}
          periodDays={baseline.periodDays}
          state={comparison}
        />
      )}
      {/* R1: the applied chips live on their own row, so the toolbar row holds
          buttons only and a long filter list cannot push them around. */}
      <div className="row min-h-[26px] flex-wrap items-center gap-1.5">
        <OverviewFiltersButtons className="p-0" />
        <AdvancedFilterChips onChange={setFilterGroup} value={filterGroup} />
        {!filterRow.hasFilters && (
          <span className="text-[12px] text-muted-foreground">
            {filterRow.emptyText}
          </span>
        )}
      </div>
      <EventAnalyticsChart
        {...input}
        baseline={baseline}
        comparison={comparison}
        onComparisonChange={setComparison}
        selected={selected}
        metrics={prefs.metrics}
        metric={prefs.chart.metric}
        onMetricChange={setChartMetric}
        collapsed={prefs.chart.collapsed}
        onCollapsedChange={setChartCollapsed}
      />
      <EventTreeTable
        input={input}
        metrics={prefs.metrics}
        sort={prefs.sort}
        onSortChange={setSort}
        showPct={prefs.pct}
        onShowPctChange={setShowPct}
        selection={selection}
      />
    </div>
  );
}
