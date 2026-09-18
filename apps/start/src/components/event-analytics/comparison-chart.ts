import { COMPARISON_MARKS } from './comparison-state';
import { deltaPercent, longDate, shiftDays } from './periods';

/**
 * Geometry and numbers of the comparison overlay chart (Phase 3 §5.3, design
 * states 3c / 3e).
 *
 * Every constant here is read from the design's SVG block. Comparison plots one
 * line per period per series, all in the series' own colour: the period is told
 * apart by weight, opacity and dash, never by colour, because colour already
 * encodes the series.
 *
 * Pure on purpose — `apps/start` has no React test setup, so the component only
 * renders what this module computes.
 */

/** Stroke width per period, index 0 = A (the baseline). */
export const PERIOD_WIDTHS = [2.4, 1.9, 1.6, 1.4] as const;
export const PERIOD_OPACITY = [1, 0.68, 0.46, 0.3] as const;
/** SVG `stroke-dasharray` per period; `'0'` is a solid line. */
export const PERIOD_DASHES = ['0', '5 4', '1 3', '9 3 2 3'] as const;

/** The isolated period, and what happens to the others. */
export const ISOLATED_WIDTH = 2.6;
export const DIMMED_OPACITY = 0.12;

export const OVERLAY_WIDTH = 1000;
export const OVERLAY_HEIGHT = 236;
/** Headroom above the tallest point, so the peak is not glued to the top. */
const SCALE_HEADROOM = 1.15;
/** Pixels the top of the plot keeps free inside the viewBox. */
const TOP_PADDING = 12;
const GRID_LINES = 5;

export type ComparisonChartSerie = {
  /** Stable identity of the plotted row; the selection path. */
  key: string;
  /** Full name, `event › property` for a nested row. */
  label: string;
  color: string;
  /** Bucket values per period, index 0 = A. */
  valuesByPeriod: number[][];
};

export type PeriodLineStyle = {
  width: number;
  opacity: number;
  dash: string;
};

export function periodLineStyle(
  period: number,
  focusPeriod: number,
): PeriodLineStyle {
  const dash = PERIOD_DASHES[period] ?? PERIOD_DASHES[0];
  if (focusPeriod < 0) {
    return {
      width: PERIOD_WIDTHS[period] ?? PERIOD_WIDTHS[0],
      opacity: PERIOD_OPACITY[period] ?? PERIOD_OPACITY[0],
      dash,
    };
  }
  if (focusPeriod === period) {
    return { width: ISOLATED_WIDTH, opacity: 1, dash };
  }
  return {
    width: PERIOD_WIDTHS[period] ?? PERIOD_WIDTHS[0],
    opacity: DIMMED_OPACITY,
    dash,
  };
}

export type OverlayScale = {
  /** Value at the top of the plot, shared by every period (and by T8's split). */
  max: number;
  /** Buckets on the x axis: period A's, because the axis shows A's dates. */
  buckets: number;
};

function periodValues(
  serie: ComparisonChartSerie,
  period: number,
): number[] {
  return serie.valuesByPeriod[period] ?? [];
}

export function overlayScale(
  series: ComparisonChartSerie[],
  periodCount: number,
): OverlayScale {
  let max = 0;
  let buckets = 0;

  for (const serie of series) {
    buckets = Math.max(buckets, periodValues(serie, 0).length);
    for (let period = 0; period < periodCount; period++) {
      for (const value of periodValues(serie, period)) {
        max = Math.max(max, value);
      }
    }
  }

  return { max: Math.max(1, max) * SCALE_HEADROOM, buckets };
}

export type OverlayLine = PeriodLineStyle & {
  key: string;
  period: number;
  color: string;
  path: string;
};

export type Overlay = OverlayScale & {
  lines: OverlayLine[];
  grid: { y: string }[];
  /** x of the crosshair on a bucket, as an SVG coordinate string. */
  crosshairX: (bucket: number) => string;
};

export function buildOverlay(input: {
  series: ComparisonChartSerie[];
  periodCount: number;
  focusPeriod: number;
}): Overlay {
  const { series, periodCount, focusPeriod } = input;
  const scale = overlayScale(series, periodCount);
  // A single bucket has no span to spread over, so it sits in the middle.
  const xAt = (bucket: number) =>
    scale.buckets <= 1
      ? OVERLAY_WIDTH / 2
      : (bucket / (scale.buckets - 1)) * OVERLAY_WIDTH;
  const yAt = (value: number) =>
    OVERLAY_HEIGHT - (value / scale.max) * (OVERLAY_HEIGHT - TOP_PADDING);

  const lines: OverlayLine[] = [];
  for (const serie of series) {
    for (let period = 0; period < periodCount; period++) {
      const values = periodValues(serie, period);
      if (values.length === 0) {
        continue;
      }
      // Bucket index, not date: an older period shorter than A keeps its
      // points on A's x positions instead of being stretched across the width.
      const points = values.map(
        (value, bucket) => `${xAt(bucket).toFixed(1)},${yAt(value).toFixed(1)}`,
      );
      lines.push({
        ...periodLineStyle(period, focusPeriod),
        key: serie.key,
        period,
        color: serie.color,
        path: `M${points.join(' L')}`,
      });
    }
  }

  const grid = Array.from({ length: GRID_LINES }, (_, index) => ({
    y: ((1 - index / (GRID_LINES - 1)) * OVERLAY_HEIGHT).toFixed(1),
  }));

  return {
    ...scale,
    lines,
    grid,
    crosshairX: (bucket: number) => xAt(bucket).toFixed(1),
  };
}

/** Width of the crosshair tooltip: the labels plus one column per period. */
export function tooltipWidth(periodCount: number): number {
  return 200 + periodCount * 96;
}

export type TooltipColumn = { mark: string; label: string };

/** One column per period, each labelled with its own date for that bucket. */
export function tooltipColumns(input: {
  anchorStart: Date;
  periodDays: number;
  periodCount: number;
  bucket: number;
}): TooltipColumn[] {
  const { anchorStart, periodDays, periodCount, bucket } = input;
  const columns: TooltipColumn[] = [];

  for (let period = 0; period < periodCount; period++) {
    const date = shiftDays(anchorStart, bucket - periodDays * period);
    columns.push({
      mark: COMPARISON_MARKS[period] ?? '',
      label: longDate(date),
    });
  }

  return columns;
}

export type TooltipCell = {
  value: number;
  /**
   * Percent against A, `null` when there is nothing to compare: column A
   * itself, or an A of 0 (spec A3 renders that as `—`, not `0.00 %`).
   */
  delta: number | null;
};

export type TooltipRow = {
  key: string;
  label: string;
  color: string;
  cells: TooltipCell[];
};

export function tooltipRows(input: {
  series: ComparisonChartSerie[];
  periodCount: number;
  bucket: number;
}): TooltipRow[] {
  const { series, periodCount, bucket } = input;

  return series.map((serie) => {
    // A bucket the older period never reached reads as 0, the same way the
    // table treats a period with no events.
    const valueAt = (period: number) =>
      periodValues(serie, period)[bucket] ?? 0;
    const baseline = valueAt(0);
    const cells: TooltipCell[] = [];

    for (let period = 0; period < periodCount; period++) {
      cells.push({
        value: valueAt(period),
        delta: period === 0 ? null : deltaPercent(valueAt(period), baseline),
      });
    }

    return {
      key: serie.key,
      // The design shows the leaf: `level_mode`, not `level_start › level_mode`.
      label: serie.label.split(' › ').slice(-1)[0] ?? serie.label,
      color: serie.color,
      cells,
    };
  });
}

export type LegendRow = {
  key: string;
  label: string;
  color: string;
  cells: { mark: string; total: number }[];
};

/** One row per series, with each period's total behind its line mark. */
export function legendRows(input: {
  series: ComparisonChartSerie[];
  periodCount: number;
}): LegendRow[] {
  const { series, periodCount } = input;

  return series.map((serie) => {
    const cells: { mark: string; total: number }[] = [];
    for (let period = 0; period < periodCount; period++) {
      cells.push({
        mark: COMPARISON_MARKS[period] ?? '',
        total: periodValues(serie, period).reduce(
          (sum, value) => sum + value,
          0,
        ),
      });
    }
    return {
      key: serie.key,
      label: serie.label,
      color: serie.color,
      cells,
    };
  });
}
