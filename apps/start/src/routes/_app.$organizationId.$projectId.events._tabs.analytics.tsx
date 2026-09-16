import { AdvancedFiltersPanel } from '@/components/event-analytics/advanced-filters-panel';
import { EventAnalyticsChart } from '@/components/event-analytics/chart';
import { coldStartSelection } from '@/components/event-analytics/chart-cold-start';
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
  useEventQueryFilterGroup,
  useEventQueryFilters,
} from '@/hooks/use-event-query-filters';
import { useEventAnalyticsPrefs } from '@/hooks/use-event-analytics-prefs';
import { useTRPC } from '@/integrations/trpc/react';
import { getChartColor } from '@/utils/theme';
import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

export const Route = createFileRoute(
  '/_app/$organizationId/$projectId/events/_tabs/analytics',
)({ component: EventAnalytics });

function EventAnalytics() {
  const { projectId } = Route.useParams();
  const { range, startDate, endDate } = useOverviewOptions();
  const [filters] = useEventQueryFilters();
  const [filterGroup, setFilterGroup] = useEventQueryFilterGroup();

  const input: EventAnalyticsRangeInput = useMemo(
    () => ({
      projectId,
      range,
      startDate,
      endDate,
      filters,
      ...(filterGroup ? { filterGroup } : {}),
    }),
    [projectId, range, startDate, endDate, filters, filterGroup],
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

  // R1 cold start, decided once per mount and only when nothing was stored: a
  // stored empty selection is a choice. Pending state (not a ref) so the query
  // below turns off once decided — a later filter change must neither refetch
  // it nor re-select rows the user cleared.
  const trpc = useTRPC();
  const [coldStartPending, setColdStartPending] = useState(true);
  const coldStartQuery = useInfiniteQuery(
    trpc.overview.eventAnalyticsList.infiniteQueryOptions(
      // Mirrors EventTreeTable's first request, so both share one fetch. It
      // only runs without stored prefs, i.e. with the default metrics and sort.
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
        enabled: coldStartPending && prefsStatus === 'absent',
      },
    ),
  );
  const coldStartRows = coldStartQuery.data?.pages[0]?.rows;
  useEffect(() => {
    const hasPersistedSelection = prefsStatus === 'stored';
    const canDecide = hasPersistedSelection || coldStartRows !== undefined;
    if (!(coldStartPending && prefsStatus !== 'loading' && canDecide)) {
      return;
    }
    setColdStartPending(false);
    const coldStart = coldStartSelection({
      names: coldStartRows?.map((row) => row.name) ?? [],
      selectedCount: paths.length,
      hasPersistedSelection,
    });
    if (coldStart) {
      updatePrefs({ selected: coldStart });
    }
  }, [coldStartPending, coldStartRows, prefsStatus, paths.length, updatePrefs]);

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
        <OverviewFiltersButtons className="p-0" />
        <MetricsDialog
          projectId={projectId}
          metrics={prefs.metrics}
          sort={prefs.sort}
          disabled={prefsStatus === 'loading'}
          onApply={updatePrefs}
        />
        <AdvancedFiltersPanel onChange={setFilterGroup} value={filterGroup} />
      </div>
      <EventAnalyticsChart
        {...input}
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
