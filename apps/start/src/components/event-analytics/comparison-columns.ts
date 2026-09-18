import {
  type IEventAnalyticsMetric,
  type IEventAnalyticsMetricRow,
  metricKey,
  periodLabel,
} from '@openpanel/validation';

import { deltaPercent } from './periods';
import { type MetricCellValue, metricCell, metricColumnLabel } from './tree-utils';

/**
 * The table in comparison mode: every metric repeated once per period, with a
 * delta against the baseline under every column but A (Phase 3 §5.3).
 *
 * Measurements come from the design: 118px per number column and a 300px name
 * track that never shrinks.
 */

/** Design: `colW` is 118px once comparison is on. */
export const COMPARISON_COLUMN_PX = 118;

/** Design: `labelFlex = 0 0 300px` — the name column is pinned, never squeezed. */
export const COMPARISON_LABEL_PX = 300;

export type ComparisonColumn = {
  /** Identity of the rendered column, e.g. `events:B`. */
  key: string;
  label: string;
  sub: string;
  /**
   * What the server is asked to sort by. Always the metric of period A, so the
   * rows keep one order no matter which period's column was clicked (§3 D7).
   */
  sortKey: string;
};

export function comparisonColumns(
  metrics: IEventAnalyticsMetric[],
  compareCount: number,
): ComparisonColumn[] {
  return metrics.flatMap((metric) => {
    const key = metricKey(metric);
    const label = metricColumnLabel(metric);

    return Array.from({ length: compareCount }, (_unused, period) => ({
      key: `${key}:${periodLabel(period)}`,
      label,
      sub: `SEGMENT ${periodLabel(period)}`,
      sortKey: key,
    }));
  });
}

/** Design: `rowMinW = 300 + metrics × periods × 118`. */
export function comparisonMinWidth(
  metricCount: number,
  compareCount: number,
): number {
  return (
    COMPARISON_LABEL_PX + metricCount * compareCount * COMPARISON_COLUMN_PX
  );
}

export type DeltaTone = 'up' | 'down' | 'flat';
export type DeltaCell = { text: string; tone: DeltaTone };

/** Below this the change is shown as flat rather than as noise. */
const FLAT_THRESHOLD = 0.005;

/**
 * The delta line under a period column.
 *
 * A zero baseline renders `—`, not `0.00 %`: there is nothing to compare
 * against, and claiming "unchanged" would be a different statement. The design
 * computes `0.00 %` here; spec A3 settles it the other way on purpose.
 */
export function deltaCell(value: number, baseline: number): DeltaCell {
  const delta = deltaPercent(value, baseline);

  if (delta === null) {
    return { text: '—', tone: 'flat' };
  }
  if (Math.abs(delta) < FLAT_THRESHOLD) {
    return { text: '0.00 %', tone: 'flat' };
  }

  return {
    text: `${delta > 0 ? '+' : ''}${delta.toFixed(2)} %`,
    tone: delta > 0 ? 'up' : 'down',
  };
}

export type ComparisonCell = {
  column: ComparisonColumn;
  value: MetricCellValue;
  /** `null` for the baseline column, which has nothing to compare with. */
  delta: DeltaCell | null;
};

/** The numeric value a delta is computed from, for one metric of one period. */
function metricNumber(
  metric: IEventAnalyticsMetric,
  row: IEventAnalyticsMetricRow,
  totals: IEventAnalyticsMetricRow,
): number {
  switch (metric.id) {
    case 'events':
      return row.events;
    case 'users':
      return row.users;
    case 'epu':
      return row.users === 0 ? 0 : row.events / row.users;
    case 'pctu':
      return totals.users === 0 ? 0 : row.users / totals.users;
    case 'epau':
      return totals.users === 0 ? 0 : row.events / totals.users;
    default:
      return row.metrics?.[metricKey(metric)] ?? 0;
  }
}

/** The period's own row and totals; falls back to the baseline when absent. */
function atPeriod(
  row: IEventAnalyticsMetricRow,
  period: number,
): IEventAnalyticsMetricRow {
  return row.periods?.[period] ?? row;
}

export function comparisonTableCells(
  metrics: IEventAnalyticsMetric[],
  compareCount: number,
  row: IEventAnalyticsMetricRow,
  totals: IEventAnalyticsMetricRow,
  showPct: boolean,
): ComparisonCell[] {
  const columns = comparisonColumns(metrics, compareCount);

  return columns.map((column, index) => {
    const metric = metrics[Math.floor(index / compareCount)] as IEventAnalyticsMetric;
    const period = index % compareCount;
    // Every period reads its own numbers, including its own totals: `% of all
    // users` for period B divides by period B's users (§3 D2).
    const periodRow = atPeriod(row, period);
    const periodTotals = atPeriod(totals, period);

    return {
      column,
      value: metricCell(metric, periodRow, periodTotals, showPct),
      delta:
        period === 0
          ? null
          : deltaCell(
              metricNumber(metric, periodRow, periodTotals),
              metricNumber(metric, atPeriod(row, 0), atPeriod(totals, 0)),
            ),
    };
  });
}
