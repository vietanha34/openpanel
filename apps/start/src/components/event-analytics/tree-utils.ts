import type {
  IEventAnalyticsMetricRow,
  IEventAnalyticsPropertyType,
  IEventAnalyticsSortDir,
  IEventAnalyticsSortKey,
} from '@openpanel/validation';

/**
 * Pure helpers for the event analytics tree. Types only are imported so this
 * module runs under a plain vitest config without the `@/` path alias.
 */

/** Horizontal step per tree depth, matching the design's `flatten()`. */
export const INDENT_PX = 22;

/** Mirrors EVENT_ANALYTICS_MAX_DEPTH in packages/validation/src/event-analytics.ts. */
export const MAX_LEVEL = 4;

const DASH = '—';

const countFormatter = new Intl.NumberFormat('en-US');

export type TreeNodeKind = 'event' | 'key' | 'obj' | 'value' | 'leaf';

const ICONS: Record<TreeNodeKind, string> = {
  event: 'E',
  key: 'K',
  obj: '{}',
  value: 'V',
  leaf: '·',
};

/** `/level_start/level_mode/hard` — the design's row key and our selection key. */
export function childPath(parentPath: string, id: string) {
  return `${parentPath}/${id}`;
}

export function indentStyle(depth: number) {
  return { paddingLeft: `${depth * INDENT_PX}px` };
}

export function iconFor(kind: TreeNodeKind) {
  return ICONS[kind];
}

export function badgeFor(
  kind: TreeNodeKind,
  type: IEventAnalyticsPropertyType,
) {
  if (kind === 'obj') {
    return 'object';
  }
  // Events carry no category in the backend contract, so they get no badge.
  if (kind !== 'key' || type === 'unknown') {
    return null;
  }
  return type;
}

/** A node may show a chevron only while the children it loads stay in the tree. */
export function canExpand(childLevel: number) {
  return childLevel <= MAX_LEVEL;
}

export function valueKindForLevel(level: number): 'value' | 'leaf' {
  return level >= MAX_LEVEL ? 'leaf' : 'value';
}

export function formatCount(value: number) {
  return Number.isFinite(value) ? countFormatter.format(value) : DASH;
}

export function formatEventsPerUser(row: IEventAnalyticsMetricRow) {
  if (row.users <= 0) {
    return DASH;
  }
  return (row.events / row.users).toFixed(2);
}

export function formatPercent(part: number, total: number) {
  if (total <= 0 || !Number.isFinite(part)) {
    return DASH;
  }
  return `${((part / total) * 100).toFixed(2)} %`;
}

export function subPercent(part: number, total: number, showPct: boolean) {
  return showPct ? formatPercent(part, total) : null;
}

/**
 * Header columns. `pctu` is `% of all users`, which the contract has no sort key
 * for: the share is `users / totals.users` and `totals.users` is constant within
 * one query, so ordering by it is identical to ordering by `users`. It stays a
 * separate column id purely so only one header shows the sort arrow.
 */
export type SortColumn = IEventAnalyticsSortKey | 'pctu';

export function sortKeyForColumn(column: SortColumn): IEventAnalyticsSortKey {
  return column === 'pctu' ? 'users' : column;
}

export function nextSort(
  current: { sort: SortColumn; dir: IEventAnalyticsSortDir },
  clicked: SortColumn,
): { sort: SortColumn; dir: IEventAnalyticsSortDir } {
  if (current.sort !== clicked) {
    return { sort: clicked, dir: 'desc' };
  }
  return { sort: clicked, dir: current.dir === 'desc' ? 'asc' : 'desc' };
}

export function sortArrow(
  current: { sort: SortColumn; dir: IEventAnalyticsSortDir },
  column: SortColumn,
): '↓' | '↑' | '' {
  if (current.sort !== column) {
    return '';
  }
  return current.dir === 'desc' ? '↓' : '↑';
}
