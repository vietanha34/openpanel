import {
  type IEventAnalyticsMetric,
  type IEventAnalyticsMetricRow,
  metricKey,
  periodLabel,
} from '@openpanel/validation';

import { deltaPercent } from './periods';
import {
  type MetricCellValue,
  metricCell,
  metricColumnLabel,
} from './tree-utils';

/**
 * The table in comparison mode: every metric repeated once per period, with a
 * delta against the baseline under every column but A (Phase 3 §5.3).
 *
 * Pure on purpose — `apps/start` has no React test setup, so the arithmetic and
 * the layout numbers live here and the components only render them.
 */

/** Design `colW` once comparison is on. */
export const COMPARISON_COLUMN_PX = 118;

/** Design `labelFlex = 0 0 300px`: the name track is pinned, never squeezed. */
export const COMPARISON_LABEL_PX = 300;

export type ComparisonColumn = {
  /** Identity of the rendered column, e.g. `events:B`. */
  key: string;
  label: string;
  /** Sub-header, `SEGMENT A`…`SEGMENT D`. */
  sub: string;
  /** Index of the period this column reads. 0 is the baseline. */
  period: number;
  /**
   * What the server is asked to sort by: always the metric of period A, so the
   * rows keep one order whichever period's header was clicked (§3 D7).
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
      period,
      sortKey: key,
    }));
  });
}

/** Design `rowMinW = 300 + metrics × periods × 118`. */
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

/** Below this a change reads as flat rather than as noise. */
const FLAT_THRESHOLD = 0.005;

/**
 * The delta line under a period column.
 *
 * A zero baseline renders `—`, not `0.00 %`: there is nothing to compare
 * against, and "unchanged" would be a different claim. The design computes
 * `0.00 %` here; spec A3 settles it the other way on purpose.
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

/** The number a delta is computed from, for one metric of one period. */
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

/**
 * The period's own numbers. A response without `periods` (comparison off, or an
 * older server) falls back to the single set it does carry.
 */
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
  const baselineRow = atPeriod(row, 0);
  const baselineTotals = atPeriod(totals, 0);

  return comparisonColumns(metrics, compareCount).map((column, index) => {
    const metric = metrics[
      Math.floor(index / compareCount)
    ] as IEventAnalyticsMetric;
    // Each period reads its own row AND its own totals: `% of all users` for
    // period B divides by the users of period B (§3 D2).
    const periodRow = atPeriod(row, column.period);
    const periodTotals = atPeriod(totals, column.period);
    const baseline = column.period === 0;

    return {
      column,
      // The `#/%` toggle belongs to the baseline column; the others spend that
      // line on the delta.
      value: metricCell(metric, periodRow, periodTotals, baseline && showPct),
      delta: baseline
        ? null
        : deltaCell(
            metricNumber(metric, periodRow, periodTotals),
            metricNumber(metric, baselineRow, baselineTotals),
          ),
    };
  });
}

/** Table footer: `Sep 12 — 18 vs Sep 5 — 11 vs …`, baseline first. */
export function comparisonFooterLabel(ranges: string[]): string {
  return ranges.join(' vs ');
}
