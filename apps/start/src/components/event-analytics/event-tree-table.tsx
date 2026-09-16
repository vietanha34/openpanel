import { useDebounceValue } from '@/hooks/use-debounce-value';
import { useTRPC } from '@/integrations/trpc/react';
import { cn } from '@/utils/cn';
import {
  type IEventAnalyticsMetric,
  type IEventAnalyticsMetricRow,
  metricKey,
} from '@openpanel/validation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Info, RotateCw, Search, SearchX } from 'lucide-react';
import { useState } from 'react';
import {
  CELL,
  type EventAnalyticsRangeInput,
  EventNode,
  type TreeContextValue,
  type TreeSelection,
  cellStyle,
} from './tree-nodes';
import {
  type TableSort,
  formatCount,
  metricColumnLabel,
  metricColumnWidth,
  nextSort,
  resolveSort,
  sortArrow,
  tableMinWidth,
  totalsCell,
} from './tree-utils';

const EVENTS_PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

const EMPTY_TOTALS: IEventAnalyticsMetricRow = { events: 0, users: 0 };

function TotalsCell({
  value,
  sub,
  width,
}: {
  value: string;
  sub: string | null;
  width: number;
}) {
  return (
    <div className={CELL} style={cellStyle(width)}>
      <div className="font-mono text-[13px] font-semibold">{value}</div>
      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
        {sub}
      </div>
    </div>
  );
}

export function EventTreeTable({
  input: rangeInput,
  metrics,
  sort: storedSort,
  onSortChange,
  selection,
}: {
  input: EventAnalyticsRangeInput;
  /** One column per metric, in this order (design 2c). */
  metrics: IEventAnalyticsMetric[];
  sort: TableSort;
  onSortChange: (sort: TableSort) => void;
  selection: TreeSelection;
}) {
  const trpc = useTRPC();
  const [search, setSearch] = useState('');
  const [showPct, setShowPct] = useState(true);
  const debouncedSearch = useDebounceValue(search, SEARCH_DEBOUNCE_MS);

  // Every level asks for the same metrics, so the server fills `row.metrics`.
  const input = { ...rangeInput, metrics };
  const sort = resolveSort(storedSort, metrics);
  const columnWidth = metricColumnWidth(metrics.length);

  const listQuery = useInfiniteQuery(
    trpc.overview.eventAnalyticsList.infiniteQueryOptions(
      {
        ...input,
        search: debouncedSearch.trim() || undefined,
        sort: sort.key,
        dir: sort.dir,
        limit: EVENTS_PAGE_SIZE,
      },
      {
        initialCursor: 0,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    ),
  );

  const totalsQuery = useQuery(
    trpc.overview.eventAnalyticsTotals.queryOptions(input),
  );

  const totals = totalsQuery.data ?? EMPTY_TOTALS;
  const rows = listQuery.data?.pages.flatMap((page) => page.rows) ?? [];
  const sumOfVisibleUsers = rows.reduce((acc, row) => acc + row.users, 0);

  const ctx: TreeContextValue = {
    input,
    metrics,
    columnWidth,
    sort: sort.key,
    dir: sort.dir,
    showPct,
    totals,
    selection,
  };

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="flex h-11 items-center gap-2.5 border-b px-3.5">
        <span className="text-[13px] font-semibold">Event tree</span>
        <span className="text-[12px] text-muted-foreground">
          {rows.length} events
        </span>
        <div className="flex-1" />
        <span className="text-[12px] text-muted-foreground">
          {selection.selected.length} selected
        </span>
        <div className="flex h-7 overflow-hidden rounded-md border">
          <button
            type="button"
            title="Absolute values"
            className={cn(
              'w-8 font-mono text-[12px]',
              showPct ? 'bg-background' : 'bg-muted',
            )}
            onClick={() => setShowPct(false)}
          >
            #
          </button>
          <button
            type="button"
            title="Show relative percentages"
            className={cn(
              'w-8 border-l font-mono text-[12px]',
              showPct ? 'bg-muted' : 'bg-background',
            )}
            onClick={() => setShowPct(true)}
          >
            %
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2.5 border-b px-3.5 py-2">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          type="text"
          aria-label="Search events"
          placeholder="Search events"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {/* Metric columns are fixed-width; below the track width the card
          scrolls horizontally instead of clipping the right-hand columns. */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: tableMinWidth(metrics.length) }}>
      <div className="flex min-h-[38px] items-center border-b bg-muted/40">
        <div className="min-w-0 flex-1 pl-3.5 text-[11px] font-medium tracking-wide text-muted-foreground">
          EVENT › PROPERTY › VALUE › NESTED KEY
        </div>
        {metrics.map((metric) => {
          const key = metricKey(metric);
          return (
            <button
              key={key}
              type="button"
              style={cellStyle(columnWidth)}
              className={cn(
                'flex shrink-0 items-center justify-end gap-[5px] py-1.5 pr-[18px] pl-1.5 text-[11px] font-medium tracking-wide hover:text-foreground',
                sort.key === key ? 'text-foreground' : 'text-muted-foreground',
              )}
              onClick={() => onSortChange(nextSort(sort, key))}
            >
              {/* Long labels wrap rather than widen the column. */}
              <span className="text-right leading-[1.3]">
                {metricColumnLabel(metric)}
              </span>
              <span className="w-2 shrink-0 font-mono text-[10px]">
                {sortArrow(sort, key)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex h-[50px] items-center border-b bg-muted/60">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-3.5">
          <span className="text-[13px] font-semibold">Totals and averages</span>
          <span className="flex h-[18px] items-center rounded-full border bg-background px-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
            DEDUPLICATED
          </span>
        </div>
        {metrics.map((metric) => (
          <TotalsCell
            key={metricKey(metric)}
            width={columnWidth}
            {...totalsCell(metric, totals)}
          />
        ))}
      </div>

      {/* Padded to 40px so the note starts under the row labels, not under the
          chevron column. */}
      <div className="flex items-center gap-2 border-b bg-muted/20 py-2 pr-[18px] pl-10 text-[12px] text-muted-foreground">
        <Info className="size-3.5 shrink-0" />
        <span>
        Totals count each user once. Branches overlap — the visible event rows
        sum to{' '}
        <span className="font-mono text-foreground">
          {formatCount(sumOfVisibleUsers)}
        </span>{' '}
        users against{' '}
        <span className="font-mono text-foreground">
          {formatCount(totals.users)}
        </span>{' '}
        unique, so child rows never add up to the totals row.
        </span>
      </div>

      {listQuery.isPending ? (
        <div className="border-b px-3.5 py-2 text-[13px] text-muted-foreground">
          Loading…
        </div>
      ) : null}

      {listQuery.isError ? (
        <div className="flex items-center gap-2.5 border-b bg-destructive/5 px-3.5 py-2">
          <span className="text-[13px] text-destructive">
            {listQuery.error.message}
          </span>
          <button
            type="button"
            className="flex items-center gap-1 rounded border px-2 py-0.5 text-[12px] hover:bg-muted"
            onClick={() => listQuery.refetch()}
          >
            <RotateCw className="size-3" />
            Retry
          </button>
        </div>
      ) : (
        rows.map((row) => (
          <EventNode key={row.name} ctx={ctx} row={row} depth={0} />
        ))
      )}

      {!listQuery.isPending && !listQuery.isError && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-3.5 py-7">
          <SearchX className="size-7 text-muted-foreground" />
          <div className="text-[13px] font-medium">
            {search ? `No events match “${search}”` : 'No events match'}
          </div>
          <div className="text-[12px] text-muted-foreground">
            Try a shorter term, or clear the property filters.
          </div>
        </div>
      ) : null}

      <div className="flex h-11 items-center gap-2.5 px-3.5 text-[12px] text-muted-foreground">
        <span>Children load on expand</span>
        <div className="flex-1" />
        {listQuery.hasNextPage ? (
          <button
            type="button"
            className="h-7 whitespace-nowrap rounded-md border px-2.5 text-[12px] text-foreground hover:bg-muted disabled:opacity-60"
            disabled={listQuery.isFetchingNextPage}
            onClick={() => listQuery.fetchNextPage()}
          >
            Load {EVENTS_PAGE_SIZE} more events
          </button>
        ) : null}
      </div>
        </div>
      </div>
    </div>
  );
}
