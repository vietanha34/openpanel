import { EventAnalyticsChart } from '@/components/event-analytics/chart';
import { EventTreeTable } from '@/components/event-analytics/event-tree-table';
import type { EventAnalyticsRangeInput } from '@/components/event-analytics/tree-nodes';
import {
  OverviewFilterButton,
  OverviewFiltersButtons,
} from '@/components/overview/filters/overview-filters-buttons';
import { OverviewRange } from '@/components/overview/overview-range';
import { useOverviewOptions } from '@/components/overview/useOverviewOptions';
import { useEventQueryFilters } from '@/hooks/use-event-query-filters';
import { getChartColor } from '@/utils/theme';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';

export const Route = createFileRoute(
  '/_app/$organizationId/$projectId/events/_tabs/analytics',
)({ component: EventAnalytics });

function EventAnalytics() {
  const { projectId } = Route.useParams();
  const { range, startDate, endDate } = useOverviewOptions();
  const [filters] = useEventQueryFilters();

  const input: EventAnalyticsRangeInput = useMemo(
    () => ({ projectId, range, startDate, endDate, filters }),
    [projectId, range, startDate, endDate, filters],
  );

  // Lifted here because the chart panel (T5) plots exactly these paths.
  const [selected, setSelected] = useState<{ path: string; color: string }[]>(
    [],
  );
  const toggle = useCallback((path: string) => {
    setSelected((current) => {
      const without = current.filter((item) => item.path !== path);
      if (without.length !== current.length) {
        // Re-colour so the swatches stay dense after a removal.
        return without.map((item, index) => ({
          path: item.path,
          color: getChartColor(index),
        }));
      }
      return [...current, { path, color: getChartColor(current.length) }];
    });
  }, []);
  const selection = useMemo(() => ({ selected, toggle }), [selected, toggle]);

  return (
    <div className="col gap-4">
      <div className="row flex-wrap gap-2">
        <OverviewRange />
        <OverviewFilterButton enableEventsFilter />
        <OverviewFiltersButtons className="p-0" />
      </div>
      <EventAnalyticsChart {...input} selected={selected} />
      <EventTreeTable input={input} selection={selection} />
    </div>
  );
}
