import { useTRPC } from '@/integrations/trpc/react';
import { cn } from '@/utils/cn';
import type {
  IChartEventFilter,
  IFilterGroup,
  IChartRange,
  IEventAnalyticsListRow,
  IEventAnalyticsMetric,
  IEventAnalyticsMetricRow,
  IEventAnalyticsParentPathItem,
  IEventAnalyticsPropertyType,
  IEventAnalyticsSortDir,
  IEventAnalyticsSortKey,
  IEventPropertyKeyRow,
} from '@openpanel/validation';
import {
  EVENT_ANALYTICS_MAX_PARENT_PATH,
  metricKey,
} from '@openpanel/validation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronRight, Plus, RotateCw } from 'lucide-react';
import { useState } from 'react';
import {
  type DeltaCell,
  type DeltaTone,
  comparisonTableCells,
} from './comparison-columns';
import {
  type TreeNodeKind,
  badgeFor,
  canExpand,
  childPath,
  formatCount,
  iconFor,
  indentStyle,
  loadMoreIndentStyle,
  metricCell,
  valueKindForLevel,
} from './tree-utils';

export type EventAnalyticsRangeInput = {
  projectId: string;
  range: IChartRange;
  startDate?: string | null;
  endDate?: string | null;
  filters: IChartEventFilter[];
  /** Advanced filters (AND/OR groups). Wins over `filters` when present. */
  filterGroup?: IFilterGroup;
};

/** Shared with T5: the chart plots exactly these paths, in these colours. */
export type TreeSelection = {
  selected: { path: string; color: string }[];
  toggle: (path: string) => void;
};

export type TreeContextValue = {
  /** Carries `metrics`, so every level asks the server for the same columns. */
  input: EventAnalyticsRangeInput & { metrics: IEventAnalyticsMetric[] };
  /** Column order and width of the table (design 2c). */
  metrics: IEventAnalyticsMetric[];
  columnWidth: number;
  /**
   * Periods per metric in comparison mode, 1 otherwise. Every metric repeats
   * once per period, and every column but A carries a delta (design 3b).
   */
  compareCount: number;
  sort: IEventAnalyticsSortKey;
  dir: IEventAnalyticsSortDir;
  showPct: boolean;
  totals: IEventAnalyticsMetricRow;
  selection: TreeSelection;
};

const KEYS_PAGE_SIZE = 20;
const VALUES_PAGE_SIZE = 5;

export const CELL = 'shrink-0 pr-[18px] text-right';

export function cellStyle(width: number) {
  return { width, flex: `0 0 ${width}px` };
}

const ICON_CLASSES: Record<TreeNodeKind, string> = {
  event: 'bg-blue-50 text-blue-600',
  key: 'bg-muted text-muted-foreground',
  obj: 'bg-muted text-muted-foreground',
  value: 'bg-muted/60 text-muted-foreground',
  leaf: 'bg-muted/60 text-muted-foreground',
};

/** Rows tint by depth, so a deep branch reads as one block (design §tree). */
const DEPTH_BACKGROUNDS = ['bg-background', 'bg-muted/10', 'bg-muted/20'];

function depthBackground(depth: number) {
  return DEPTH_BACKGROUNDS[Math.min(depth, DEPTH_BACKGROUNDS.length - 1)];
}

function selectedColor(selection: TreeSelection, path: string) {
  return selection.selected.find((item) => item.path === path)?.color ?? null;
}

const DELTA_TONE: Record<DeltaTone, string> = {
  up: 'text-emerald-700',
  down: 'text-red-600',
  flat: 'text-muted-foreground',
};

function MetricCell({
  value,
  sub,
  width,
  delta,
}: {
  value: string;
  sub?: string | null;
  width: number;
  /** Comparison only, and never on the baseline column. */
  delta?: DeltaCell | null;
}) {
  return (
    <div className={CELL} style={cellStyle(width)}>
      <div className="font-mono text-[13px]">{value}</div>
      {sub ? (
        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
          {sub}
        </div>
      ) : null}
      {delta ? (
        <div className={cn('mt-0.5 font-mono text-[11px]', DELTA_TONE[delta.tone])}>
          {delta.text}
        </div>
      ) : null}
    </div>
  );
}

function TreeRow({
  ctx,
  depth,
  kind,
  label,
  metric,
  type = 'unknown',
  path,
  expandable,
  expanded,
  onToggle,
}: {
  ctx: TreeContextValue;
  depth: number;
  kind: TreeNodeKind;
  label: string;
  metric: IEventAnalyticsMetricRow;
  type?: IEventAnalyticsPropertyType;
  path: string;
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const badge = badgeFor(kind, type);
  const selectable = depth <= 1;
  const color = selectable ? selectedColor(ctx.selection, path) : null;

  return (
    <div
      className={cn(
        'flex min-h-11 w-full items-center border-b hover:bg-muted/40',
        depthBackground(depth),
      )}
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-2.5 py-2"
        style={indentStyle(depth)}
      >
        {/* The design puts the chevron before the checkbox, so the tree's
            structure reads first and the plot toggle second. */}
        <button
          type="button"
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
          className="shrink-0"
          disabled={!expandable}
          onClick={onToggle}
        >
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              expandable ? 'visible' : 'invisible',
              expanded && 'rotate-90',
            )}
          />
        </button>
        {selectable ? (
          <input
            type="checkbox"
            aria-label={`Plot ${label}`}
            className="size-4 shrink-0 cursor-pointer rounded-sm accent-blue-600"
            checked={color !== null}
            onChange={() => ctx.selection.toggle(path)}
          />
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
          disabled={!expandable}
          onClick={onToggle}
        >
          <span
            className={cn(
              'flex size-[18px] shrink-0 items-center justify-center rounded font-mono text-[9px] font-semibold',
              ICON_CLASSES[kind],
            )}
          >
            {iconFor(kind)}
          </span>
          <span
            className={cn(
              'truncate font-mono text-[13px]',
              kind === 'event' && 'font-semibold',
              (kind === 'key' || kind === 'obj') && 'font-medium',
              kind === 'leaf' && 'text-muted-foreground',
            )}
          >
            {label}
          </span>
          {badge ? (
            <span className="flex h-[18px] shrink-0 items-center rounded bg-muted px-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
              {badge}
            </span>
          ) : null}
          {color ? (
            <span
              className="size-[9px] shrink-0 rounded-[2px]"
              style={{ background: color }}
            />
          ) : null}
        </button>
      </div>
      {ctx.compareCount > 1
        ? comparisonTableCells(
            ctx.metrics,
            ctx.compareCount,
            metric,
            ctx.totals,
            ctx.showPct,
          ).map((cell) => (
            <MetricCell
              delta={cell.delta}
              key={cell.column.key}
              width={ctx.columnWidth}
              {...cell.value}
            />
          ))
        : ctx.metrics.map((column) => (
            <MetricCell
              key={metricKey(column)}
              width={ctx.columnWidth}
              {...metricCell(column, metric, ctx.totals, ctx.showPct)}
            />
          ))}
    </div>
  );
}

export function LoadMoreRow({
  depth,
  label,
  disabled,
  onClick,
}: {
  depth: number;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center border-b bg-muted/20 text-left hover:bg-muted/40 disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
    >
      <div
        className="flex items-center gap-2.5 py-2"
        style={loadMoreIndentStyle(depth)}
      >
        {/* Two empty slots stand in for the chevron and the checkbox so the
            row lines up with the values it extends. */}
        <span className="size-4 shrink-0" />
        <span className="size-4 shrink-0" />
        <span className="flex size-[18px] shrink-0 items-center justify-center rounded bg-blue-50 font-mono text-[9px] font-semibold text-blue-600">
          <Plus className="size-3" />
        </span>
        <span className="text-[13px] font-medium text-blue-600">{label}</span>
      </div>
    </button>
  );
}

/** One failing node keeps the rest of the tree usable (spec §6). */
export function NodeErrorRow({
  depth,
  message,
  onRetry,
}: {
  depth: number;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex w-full items-center border-b bg-destructive/5">
      <div
        className="flex items-center gap-2.5 py-2"
        style={indentStyle(depth)}
      >
        <span className="size-4 shrink-0" />
        <span className="text-[13px] text-destructive">{message}</span>
        <button
          type="button"
          className="flex items-center gap-1 rounded border px-2 py-0.5 text-[12px] hover:bg-muted"
          onClick={onRetry}
        >
          <RotateCw className="size-3" />
          Retry
        </button>
      </div>
    </div>
  );
}

function NoteRow({ depth, text }: { depth: number; text: string }) {
  return (
    <div className="flex w-full items-center border-b">
      <div
        className="flex items-center gap-2.5 py-2"
        style={indentStyle(depth)}
      >
        <span className="size-4 shrink-0" />
        <span className="text-[13px] text-muted-foreground">{text}</span>
      </div>
    </div>
  );
}

function PropertyKeysBranch({
  ctx,
  event,
  eventPath,
  prefix,
  parentPath,
  depth,
  level,
  emptyText,
}: {
  ctx: TreeContextValue;
  event: string;
  /** Selection paths stay anchored to the event, not to the render depth. */
  eventPath: string;
  prefix: string;
  parentPath: IEventAnalyticsParentPathItem[];
  depth: number;
  level: number;
  /**
   * Shown when the branch comes back empty. A key always has at least one
   * value, but a value may genuinely carry no nested keys.
   */
  emptyText?: string;
}) {
  const trpc = useTRPC();
  const query = useInfiniteQuery(
    trpc.overview.eventPropertyKeys.infiniteQueryOptions(
      {
        ...ctx.input,
        event,
        prefix,
        parentPath,
        limit: KEYS_PAGE_SIZE,
      },
      {
        initialCursor: 0,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    ),
  );

  if (query.isError) {
    return (
      <NodeErrorRow
        depth={depth}
        message={query.error.message}
        onRetry={() => query.refetch()}
      />
    );
  }

  if (query.isPending) {
    return <NoteRow depth={depth} text="Loading…" />;
  }

  const rows = query.data.pages.flatMap((page) => page.rows);

  if (rows.length === 0 && emptyText) {
    return <NoteRow depth={depth} text={emptyText} />;
  }

  return (
    <>
      {rows.map((row) => (
        <PropertyKeyNode
          key={row.key}
          ctx={ctx}
          row={row}
          event={event}
          eventPath={eventPath}
          parentPath={parentPath}
          depth={depth}
          level={level}
        />
      ))}
      {query.hasNextPage ? (
        <LoadMoreRow
          depth={depth}
          label="Load more properties"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        />
      ) : null}
    </>
  );
}

function PropertyKeyNode({
  ctx,
  row,
  event,
  eventPath,
  parentPath,
  depth,
  level,
}: {
  ctx: TreeContextValue;
  row: IEventPropertyKeyRow;
  event: string;
  eventPath: string;
  parentPath: IEventAnalyticsParentPathItem[];
  depth: number;
  level: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const path = childPath(eventPath, row.key);
  // An object only regroups keys behind a prefix; it does not consume a level.
  const isObject = row.kind === 'obj';
  const childLevel = isObject ? level : level + 1;
  const expandable = canExpand(childLevel);

  return (
    <>
      <TreeRow
        ctx={ctx}
        depth={depth}
        kind={isObject ? 'obj' : 'key'}
        label={row.key}
        metric={row}
        type={row.type}
        path={path}
        expandable={expandable}
        expanded={expanded}
        onToggle={() => setExpanded((current) => !current)}
      />
      {expanded && expandable ? (
        isObject ? (
          <PropertyKeysBranch
            ctx={ctx}
            event={event}
            eventPath={eventPath}
            prefix={`${row.key}.`}
            parentPath={parentPath}
            depth={depth + 1}
            level={level}
          />
        ) : (
          <PropertyValuesBranch
            ctx={ctx}
            event={event}
            eventPath={eventPath}
            propertyKey={row.key}
            type={row.type}
            parentPath={parentPath}
            depth={depth + 1}
            level={childLevel}
          />
        )
      ) : null}
    </>
  );
}

function PropertyValuesBranch({
  ctx,
  event,
  eventPath,
  propertyKey,
  type,
  parentPath,
  depth,
  level,
}: {
  ctx: TreeContextValue;
  event: string;
  eventPath: string;
  propertyKey: string;
  type: IEventAnalyticsPropertyType;
  parentPath: IEventAnalyticsParentPathItem[];
  depth: number;
  level: number;
}) {
  const trpc = useTRPC();
  const query = useInfiniteQuery(
    trpc.overview.eventPropertyValues.infiniteQueryOptions(
      {
        ...ctx.input,
        event,
        key: propertyKey,
        type,
        parentPath,
        sort: ctx.sort,
        dir: ctx.dir,
        limit: VALUES_PAGE_SIZE,
      },
      {
        initialCursor: 0,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    ),
  );

  if (query.isError) {
    return (
      <NodeErrorRow
        depth={depth}
        message={query.error.message}
        onRetry={() => query.refetch()}
      />
    );
  }

  if (query.isPending) {
    return <NoteRow depth={depth} text="Loading…" />;
  }

  const pages = query.data.pages;
  const rows = pages.flatMap((page) => page.rows);
  const remaining = pages[pages.length - 1]?.remaining ?? 0;

  return (
    <>
      {rows.map((row) => (
        <PropertyValueNode
          key={row.value}
          ctx={ctx}
          value={row.value}
          metric={row}
          event={event}
          eventPath={eventPath}
          propertyKey={propertyKey}
          parentPath={parentPath}
          depth={depth}
          level={level}
        />
      ))}
      {query.hasNextPage ? (
        <LoadMoreRow
          depth={depth}
          label={`Load ${VALUES_PAGE_SIZE} more values · ${formatCount(remaining)} remaining`}
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        />
      ) : null}
    </>
  );
}

function PropertyValueNode({
  ctx,
  value,
  metric,
  event,
  eventPath,
  propertyKey,
  parentPath,
  depth,
  level,
}: {
  ctx: TreeContextValue;
  value: string;
  metric: IEventAnalyticsMetricRow;
  event: string;
  eventPath: string;
  propertyKey: string;
  parentPath: IEventAnalyticsParentPathItem[];
  depth: number;
  level: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const path = childPath(childPath(eventPath, propertyKey), value);
  // Drilling under a value costs a parentPath slot, and the contract allows one.
  const expandable =
    canExpand(level + 1) && parentPath.length < EVENT_ANALYTICS_MAX_PARENT_PATH;

  return (
    <>
      <TreeRow
        ctx={ctx}
        depth={depth}
        kind={valueKindForLevel(level)}
        label={value}
        metric={metric}
        path={path}
        expandable={expandable}
        expanded={expanded}
        onToggle={() => setExpanded((current) => !current)}
      />
      {expanded && expandable ? (
        <PropertyKeysBranch
          ctx={ctx}
          event={event}
          eventPath={path}
          prefix=""
          parentPath={[{ key: propertyKey, value }]}
          depth={depth + 1}
          level={level + 1}
          emptyText="No nested properties"
        />
      ) : null}
    </>
  );
}

export function EventNode({
  ctx,
  row,
  depth,
}: {
  ctx: TreeContextValue;
  row: IEventAnalyticsListRow;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const path = childPath('', row.name);

  return (
    <>
      <TreeRow
        ctx={ctx}
        depth={depth}
        kind="event"
        label={row.name}
        metric={row}
        path={path}
        expandable
        expanded={expanded}
        onToggle={() => setExpanded((current) => !current)}
      />
      {expanded ? (
        <PropertyKeysBranch
          ctx={ctx}
          event={row.name}
          eventPath={path}
          prefix=""
          parentPath={[]}
          depth={depth + 1}
          level={1}
        />
      ) : null}
    </>
  );
}
