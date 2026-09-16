import { useDebounceValue } from '@/hooks/use-debounce-value';
import { useTRPC } from '@/integrations/trpc/react';
import { cn } from '@/utils/cn';
import type {
  IEventAnalyticsMetricRow,
  IEventAnalyticsSortDir,
} from '@openpanel/validation';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Info, RotateCw, Search, SearchX } from 'lucide-react';
import { useState } from 'react';
import {
  type EventAnalyticsRangeInput,
  EventNode,
  type TreeContextValue,
  type TreeSelection,
} from './tree-nodes';
import {
  type SortColumn,
  formatCount,
  formatEventsPerUser,
  formatPercent,
  nextSort,
  sortArrow,
  sortKeyForColumn,
} from './tree-utils';

const EVENTS_PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;

const EMPTY_TOTALS: IEventAnalyticsMetricRow = { events: 0, users: 0 };

const CELL = 'w-[158px] shrink-0 pr-[18px] text-right';

type SortState = {
  sort: SortColumn;
  dir: IEventAnalyticsSortDir;
};

const COLUMNS: { label: string; key: SortColumn }[] = [
  { label: 'EVENTS', key: 'events' },
  { label: 'USERS', key: 'users' },
  { label: 'EVENTS PER USER', key: 'epu' },
  // "% of all users" is users / totals.users. totals.users is constant within one
  // query, so ordering by the percentage is identical to ordering by users —
  // sortKeyForColumn maps it to 'users' while the cell still shows a percentage.
  { label: '% OF ALL USERS', key: 'pctu' },
];

function TotalsCell({ value, sub }: { value: string; sub: string }) {
  return (
    <div className={CELL}>
      <div className="font-mono text-[13px] font-semibold">{value}</div>
      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
        {sub}
      </div>
    </div>
  );
}

export function EventTreeTable({
  input,
  selection,
}: {
  input: EventAnalyticsRangeInput;
  selection: TreeSelection;
}) {
  const trpc = useTRPC();
  const [{ sort, dir }, setSort] = useState<SortState>({
    sort: 'events',
    dir: 'desc',
  });
  const [search, setSearch] = useState('');
  const [showPct, setShowPct] = useState(true);
  const debouncedSearch = useDebounceValue(search, SEARCH_DEBOUNCE_MS);

  const sortKey = sortKeyForColumn(sort);

  const listQuery = useInfiniteQuery(
    trpc.overview.eventAnalyticsList.infiniteQueryOptions(
      {
        ...input,
        search: debouncedSearch.trim() || undefined,
        sort: sortKey,
        dir,
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
    sort: sortKey,
    dir,
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

      {/* Metric columns are fixed-width; below ~860px the card scrolls
          horizontally instead of clipping the right-hand columns. */}
      <div className="overflow-x-auto">
        <div className="min-w-[860px]">
      <div className="flex h-[38px] items-center border-b bg-muted/40">
        <div className="min-w-0 flex-1 pl-3.5 text-[11px] font-medium tracking-wide text-muted-foreground">
          EVENT › PROPERTY › VALUE › NESTED KEY
        </div>
        {COLUMNS.map((column) => (
          <button
            key={column.label}
            type="button"
            className={cn(
              CELL,
              'flex items-center justify-end gap-1 text-[11px] font-medium tracking-wide',
              sort === column.key ? 'text-foreground' : 'text-muted-foreground',
            )}
            onClick={() =>
              setSort((current) => nextSort(current, column.key))
            }
          >
            {column.label}
            <span className="w-2 font-mono text-[10px]">
              {sortArrow({ sort, dir }, column.key)}
            </span>
          </button>
        ))}
      </div>

      <div className="flex h-[50px] items-center border-b bg-muted/60">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-3.5">
          <span className="text-[13px] font-semibold">Totals and averages</span>
          <span className="flex h-[18px] items-center rounded-full border bg-background px-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
            DEDUPLICATED
          </span>
        </div>
        <TotalsCell value={formatCount(totals.events)} sub="100.00 %" />
        <TotalsCell
          value={formatCount(totals.users)}
          sub="unique · not a sum"
        />
        <TotalsCell value={formatEventsPerUser(totals)} sub="average" />
        <TotalsCell
          value={formatPercent(totals.users, totals.users)}
          sub="of tracked users"
        />
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
