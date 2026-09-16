import { AdvancedFiltersPanel } from '@/components/event-analytics/advanced-filters-panel';
import { EventAnalyticsChart } from '@/components/event-analytics/chart';
import { EventTreeTable } from '@/components/event-analytics/event-tree-table';
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
import { getChartColor } from '@/utils/theme';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

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
  const { prefs, update: updatePrefs } = useEventAnalyticsPrefs(projectId);
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

  return (
    <div className="col gap-4">
      <div className="row flex-wrap gap-2">
        <OverviewRange />
        {/* No 'profile' category: event analytics queries have no profile CTE
            join, so a profile.properties.* filter is dropped when the SQL is
            built and the numbers narrow with no error. */}
        <OverviewFilterButton
          categories={['event', 'group', 'cohort']}
          enableEventsFilter
        />
        <OverviewFiltersButtons className="p-0" />
        <AdvancedFiltersPanel onChange={setFilterGroup} value={filterGroup} />
      </div>
      <EventAnalyticsChart {...input} selected={selected} />
      <EventTreeTable input={input} selection={selection} />
    </div>
  );
}
