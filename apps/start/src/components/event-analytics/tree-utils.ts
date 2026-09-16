import {
  EVENT_ANALYTICS_MAX_DEPTH,
  EVENT_ANALYTICS_METRICS,
  allowedSortKeys,
  metricKey,
} from '@openpanel/validation';
import type {
  IEventAnalyticsMetric,
  IEventAnalyticsMetricRow,
  IEventAnalyticsPropertyType,
  IEventAnalyticsSortDir,
  IEventAnalyticsSortKey,
} from '@openpanel/validation';
import { chipLabel } from './metrics-state';

/** Pure helpers for the event analytics tree. */

/** Horizontal step per tree depth, matching the design's `flatten()`. */
export const INDENT_PX = 22;

/** How deep below an event a node may sit. Owned by the shared contract. */
export const MAX_LEVEL = EVENT_ANALYTICS_MAX_DEPTH;

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

/** The card gutter every row label starts from, before the depth step. */
export const ROW_PADDING_PX = 14;

export function indentStyle(depth: number) {
  return { paddingLeft: `${ROW_PADDING_PX + depth * INDENT_PX}px` };
}

/**
 * A "load more" row sits 25px past the values it extends, so the eye reads it
 * as part of that branch rather than as another value.
 */
export function loadMoreIndentStyle(depth: number) {
  return { paddingLeft: `${ROW_PADDING_PX + depth * INDENT_PX + 25}px` };
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

export type TableSort = {
  key: IEventAnalyticsSortKey;
  dir: IEventAnalyticsSortDir;
};

const DEFAULT_SORT: TableSort = { key: 'events', dir: 'desc' };

/**
 * The sort the table requests. The key is the metric key itself — `pctu` and
 * `epau` included, the server maps them onto their numerator column. A key the
 * request schema would reject (not in `allowedSortKeys(metrics)`) falls back
 * to the default rather than failing every query.
 */
export function resolveSort(
  sort: TableSort,
  metrics: IEventAnalyticsMetric[],
): TableSort {
  return allowedSortKeys(metrics).includes(sort.key) ? sort : DEFAULT_SORT;
}

export function nextSort(current: TableSort, clicked: string): TableSort {
  if (current.key !== clicked) {
    return { key: clicked, dir: 'desc' };
  }
  return { key: clicked, dir: current.dir === 'desc' ? 'asc' : 'desc' };
}

export function sortArrow(current: TableSort, column: string): '↓' | '↑' | '' {
  if (current.key !== column) {
    return '';
  }
  return current.dir === 'desc' ? '↓' : '↑';
}

/** Design 2c: columns narrow once more than four metrics are shown. */
export function metricColumnWidth(count: number) {
  return count > 4 ? 132 : 158;
}

/** The label track the metric columns sit beside. 228 + 4 × 158 = 860. */
const LABEL_TRACK_PX = 228;

/** Below this width the card scrolls horizontally instead of clipping columns. */
export function tableMinWidth(count: number) {
  return LABEL_TRACK_PX + count * metricColumnWidth(count);
}

export function metricColumnLabel(metric: IEventAnalyticsMetric) {
  return chipLabel(metric).toUpperCase();
}

export type MetricCellValue = { value: string; sub: string | null };

function formatDecimal(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) ? value.toFixed(2) : DASH;
}

function formatSum(value: number | undefined) {
  return value !== undefined && Number.isFinite(value)
    ? value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : DASH;
}

function ratio(part: number, total: number) {
  return total > 0 ? part / total : undefined;
}

/**
 * One row cell. `events` and `users` come from their own fields; parameter
 * metrics from `row.metrics`, which the server fills only for requested
 * metrics. `epu` divides by the row's users, while `pctu` and `epau` divide by
 * `totals.users` — a query-level denominator, so they are derived here and
 * never computed per node in SQL.
 */
export function metricCell(
  metric: IEventAnalyticsMetric,
  row: IEventAnalyticsMetricRow,
  totals: IEventAnalyticsMetricRow,
  showPct: boolean,
): MetricCellValue {
  const key = metricKey(metric);
  const value = row.metrics?.[key];
  switch (metric.id) {
    case 'events':
      return {
        value: formatCount(row.events),
        sub: subPercent(row.events, totals.events, showPct),
      };
    case 'users':
      return {
        value: formatCount(row.users),
        sub: subPercent(row.users, totals.users, showPct),
      };
    case 'epu':
      return { value: formatEventsPerUser(row), sub: null };
    case 'pctu':
      return { value: formatPercent(row.users, totals.users), sub: null };
    case 'epau':
      return { value: formatDecimal(ratio(row.events, totals.users)), sub: null };
    case 'uniq_param':
      return { value: formatCount(value ?? Number.NaN), sub: null };
    case 'sum_param':
      return {
        value: formatSum(value),
        sub:
          value === undefined
            ? null
            : subPercent(value, totals.metrics?.[key] ?? 0, showPct),
      };
    default:
      return { value: formatDecimal(value), sub: null };
  }
}

/**
 * One totals-row cell, read only from the deduplicated totals response. It
 * takes no rows on purpose: a non-additive metric summed over branches would
 * count the same user several times (§3 D5).
 */
export function totalsCell(
  metric: IEventAnalyticsMetric,
  totals: IEventAnalyticsMetricRow,
): MetricCellValue {
  switch (metric.id) {
    case 'events':
      return { value: formatCount(totals.events), sub: '100.00 %' };
    case 'users':
      return { value: formatCount(totals.users), sub: 'unique · not a sum' };
    case 'pctu':
      return {
        value: formatPercent(totals.users, totals.users),
        sub: 'of tracked users',
      };
    default: {
      const { value } = metricCell(metric, totals, totals, false);
      return {
        value,
        sub: EVENT_ANALYTICS_METRICS[metric.id].additive ? '100.00 %' : 'average',
      };
    }
  }
}
