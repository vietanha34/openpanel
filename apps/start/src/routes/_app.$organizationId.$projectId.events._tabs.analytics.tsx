import {
  OverviewFilterButton,
  OverviewFiltersButtons,
} from '@/components/overview/filters/overview-filters-buttons';
import { useOverviewOptions } from '@/components/overview/useOverviewOptions';
import { OverviewRange } from '@/components/overview/overview-range';
import { ReportChartShortcut } from '@/components/report-chart/shortcut';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useEventQueryFilters } from '@/hooks/use-event-query-filters';
import { useTRPC } from '@/integrations/trpc/react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import type { IChartEventItem } from '@openpanel/validation';

export const Route = createFileRoute(
  '/_app/$organizationId/$projectId/events/_tabs/analytics',
)({ component: EventAnalytics });

const number = new Intl.NumberFormat();
const percent = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 1,
});

function EventAnalytics() {
  const { projectId } = Route.useParams();
  const { range, startDate, endDate } = useOverviewOptions();
  const [filters] = useEventQueryFilters();
  const trpc = useTRPC();
  const query = useQuery(
    trpc.overview.eventAnalytics.queryOptions({
      projectId,
      range,
      startDate,
      endDate,
      filters,
    }),
  );
  const totals = query.data?.[0];
  const series: IChartEventItem[] = (query.data ?? []).slice(0, 5).map((item) => ({
    id: item.name,
    name: item.name,
    displayName: item.name,
    segment: 'event',
    filters,
    type: 'event',
  }));

  return (
    <div className="col gap-4">
      <div className="row flex-wrap gap-2">
        <OverviewRange />
        <OverviewFilterButton enableEventsFilter />
        <OverviewFiltersButtons className="p-0" />
      </div>
      {series.length > 0 && (
        <ReportChartShortcut projectId={projectId} range={range} chartType="line" series={series} />
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Event</TableHead>
            <TableHead className="text-right">Events</TableHead>
            <TableHead className="text-right">Users</TableHead>
            <TableHead className="text-right">Events/User</TableHead>
            <TableHead className="text-right">% Users</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {totals && (
            <TableRow className="bg-muted/40 font-medium">
              <TableCell>Totals and averages</TableCell>
              <TableCell className="text-right">{number.format(totals.total_events)}</TableCell>
              <TableCell className="text-right">{number.format(totals.total_users)}</TableCell>
              <TableCell className="text-right">{(totals.total_events / totals.total_users).toFixed(2)}</TableCell>
              <TableCell className="text-right">100%</TableCell>
            </TableRow>
          )}
          {query.data?.map((item) => (
            <TableRow key={item.name}>
              <TableCell className="font-medium">{item.name}</TableCell>
              <TableCell className="text-right"><div>{number.format(item.events)}</div><div className="text-xs text-muted-foreground">{percent.format(item.event_percentage)}</div></TableCell>
              <TableCell className="text-right"><div>{number.format(item.users)}</div><div className="text-xs text-muted-foreground">{percent.format(item.user_percentage)}</div></TableCell>
              <TableCell className="text-right">{item.events_per_user.toFixed(2)}</TableCell>
              <TableCell className="text-right">{percent.format(item.user_percentage)}</TableCell>
            </TableRow>
          ))}
          {!query.isLoading && query.data?.length === 0 && (
            <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No events for this range</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
