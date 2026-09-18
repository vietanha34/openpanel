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
  COMPARISON_COLUMN_PX,
  type DeltaCell,
  comparisonColumns,
  comparisonFooterLabel,
  comparisonMinWidth,
  comparisonTableCells,
} from './comparison-columns';
import {
  CELL,
  DELTA_TONE_CLASS,
  type EventAnalyticsRangeInput,
  EventNode,
  type TreeContextValue,
  type TreeSelection,
  cellStyle,
  labelTrackStyle,
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

/** Comparison totals: the number and its delta on one line (design 3b). */
function ComparisonTotalsCell({
  value,
  delta,
  width,
}: {
  value: string;
  delta: DeltaCell | null;
  width: number;
}) {
  return (
    <div className={CELL} style={cellStyle(width)}>
      <div className="whitespace-nowrap font-mono text-[13px] font-semibold">
        {value}
        {delta ? (
          <span className={cn('ml-1.5 font-normal', DELTA_TONE_CLASS[delta.tone])}>
            {delta.text}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function EventTreeTable({
  input: rangeInput,
  metrics,
  sort: storedSort,
  onSortChange,
  showPct,
  onShowPctChange,
  comparison,
  selection,
}: {
  input: EventAnalyticsRangeInput;
  /** One column per metric, in this order (design 2c). */
  metrics: IEventAnalyticsMetric[];
  sort: TableSort;
  onSortChange: (sort: TableSort) => void;
  /** The `%` toggle: relative shares under the absolute values. */
  showPct: boolean;
  onShowPctChange: (showPct: boolean) => void;
  /**
   * Comparison mode: how many periods the columns split into, and the range of
   * each one for the footer. `null` when comparison is off.
   */
  comparison: { compareCount: number; ranges: string[] } | null;
  selection: TreeSelection;
}) {
  const trpc = useTRPC();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounceValue(search, SEARCH_DEBOUNCE_MS);

  // Every level asks for the same metrics, so the server fills `row.metrics`.
  const input = { ...rangeInput, metrics };
  const sort = resolveSort(storedSort, metrics);
  const compareCount = comparison?.compareCount ?? null;
  const columnWidth =
    compareCount === null ? metricColumnWidth(metrics.length) : COMPARISON_COLUMN_PX;
  const minWidth =
    compareCount === null
      ? tableMinWidth(metrics.length)
      : comparisonMinWidth(metrics.length, compareCount);
  // One block of columns per metric, each split per period when comparing.
  const columns =
    compareCount === null
      ? metrics.map((metric) => ({
          key: metricKey(metric),
          label: metricColumnLabel(metric),
          sub: '',
          period: 0,
          sortKey: metricKey(metric),
        }))
      : comparisonColumns(metrics, compareCount);

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
    compareCount,
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
            onClick={() => onShowPctChange(false)}
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
            onClick={() => onShowPctChange(true)}
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
        <div style={{ minWidth }}>
      <div className="flex min-h-[38px] items-center border-b bg-muted/40">
        <div
          className={cn(
            'min-w-0 pl-3.5 text-[11px] font-medium tracking-wide text-muted-foreground',
            compareCount === null && 'flex-1',
          )}
          style={labelTrackStyle(compareCount)}
        >
          EVENT › PROPERTY › VALUE › NESTED KEY
        </div>
        {columns.map((column) => {
          // Sorting is by the metric of period A whichever header is clicked,
          // so the arrow marks that metric's first column (§3 D7).
          const active = sort.key === column.sortKey && column.period === 0;
          return (
            <button
              key={column.key}
              type="button"
              style={cellStyle(columnWidth)}
              className={cn(
                'flex shrink-0 items-center justify-end gap-[5px] py-1.5 pr-[18px] pl-1.5 text-[11px] font-medium tracking-wide hover:text-foreground',
                active ? 'text-foreground' : 'text-muted-foreground',
              )}
              onClick={() => onSortChange(nextSort(sort, column.sortKey))}
            >
              {/* Long labels wrap rather than widen the column. */}
              <span className="text-right leading-[1.3]">
                {column.label}
                {column.sub ? (
                  <span className="mt-[3px] block font-normal text-muted-foreground">
                    {column.sub}
                  </span>
                ) : null}
              </span>
              <span className="w-2 shrink-0 font-mono text-[10px]">
                {active ? sortArrow(sort, column.sortKey) : ''}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex h-[50px] items-center border-b bg-muted/60">
        <div
          className={cn(
            'flex min-w-0 items-center gap-2.5 pl-3.5',
            compareCount === null && 'flex-1',
          )}
          style={labelTrackStyle(compareCount)}
        >
          <span className="whitespace-nowrap text-[13px] font-semibold">
            Totals and averages
          </span>
          <span className="flex h-[18px] items-center rounded-full border bg-background px-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
            DEDUPLICATED
          </span>
        </div>
        {compareCount === null
          ? metrics.map((metric) => (
              <TotalsCell
                key={metricKey(metric)}
                width={columnWidth}
                {...totalsCell(metric, totals)}
              />
            ))
          : // The totals of every period come from the totals query, so a
            // non-additive metric is never summed over the branches (§3 D2).
            comparisonTableCells(
              metrics,
              compareCount,
              totals,
              totals,
              showPct,
            ).map((cell) => (
              <ComparisonTotalsCell
                key={cell.column.key}
                width={columnWidth}
                value={cell.value.value}
                delta={cell.delta}
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
        <span>
          Children load on expand
          {comparison
            ? ` — ${comparisonFooterLabel(comparison.ranges)}`
            : null}
        </span>
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
