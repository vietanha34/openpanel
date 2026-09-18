import { describe, expect, it } from 'vitest';

import {
  DIMMED_OPACITY,
  ISOLATED_WIDTH,
  OVERLAY_HEIGHT,
  OVERLAY_WIDTH,
  PERIOD_DASHES,
  PERIOD_OPACITY,
  PERIOD_WIDTHS,
  buildOverlay,
  legendRows,
  overlayScale,
  periodLineStyle,
  tooltipColumns,
  tooltipRows,
  tooltipWidth,
} from './comparison-chart';
import type { ComparisonChartSerie } from './comparison-chart';

const serie = (
  key: string,
  color: string,
  valuesByPeriod: number[][],
): ComparisonChartSerie => ({ key, label: key, color, valuesByPeriod });

// A two-period set: A rises, B is flat and lower.
const twoPeriods = [
  serie('level_start', '#2563EB', [
    [1, 2, 3],
    [2, 2, 2],
  ]),
];

describe('period line style', () => {
  it('fades with age when nothing is isolated', () => {
    for (const period of [0, 1, 2, 3]) {
      expect(periodLineStyle(period, -1)).toEqual({
        width: PERIOD_WIDTHS[period],
        opacity: PERIOD_OPACITY[period],
        dash: PERIOD_DASHES[period],
      });
    }
  });

  it('isolates the focused period and dims the rest', () => {
    expect(periodLineStyle(1, 1)).toEqual({
      width: ISOLATED_WIDTH,
      opacity: 1,
      dash: PERIOD_DASHES[1],
    });
    expect(periodLineStyle(0, 1)).toEqual({
      width: PERIOD_WIDTHS[0],
      opacity: DIMMED_OPACITY,
      dash: PERIOD_DASHES[0],
    });
  });

  it('keeps the dash of its own period while isolated', () => {
    expect(periodLineStyle(3, 3).dash).toBe('9 3 2 3');
    expect(periodLineStyle(0, 0).dash).toBe('0');
  });
});

describe('overlay scale', () => {
  it('shares one maximum across every period, with the design headroom', () => {
    const { max, buckets } = overlayScale(twoPeriods, 2);

    expect(max).toBeCloseTo(3 * 1.15, 10);
    // The x axis is period A's, so its bucket count wins.
    expect(buckets).toBe(3);
  });

  it('never divides by zero when every value is zero', () => {
    expect(overlayScale([serie('a', '#000', [[0, 0]])], 1).max).toBe(1.15);
  });

  it('takes the maximum from an older period too', () => {
    const { max } = overlayScale(
      [
        serie('a', '#000', [
          [1, 1],
          [9, 1],
        ]),
      ],
      2,
    );

    expect(max).toBeCloseTo(9 * 1.15, 10);
  });

  it('ignores periods beyond the compared count', () => {
    const { max } = overlayScale(
      [
        serie('a', '#000', [
          [1, 1],
          [50, 1],
        ]),
      ],
      1,
    );

    expect(max).toBeCloseTo(1.15, 10);
  });
});

describe('buildOverlay', () => {
  it('draws one line per series and period, styled by age', () => {
    const { lines } = buildOverlay({
      series: twoPeriods,
      periodCount: 2,
      focusPeriod: -1,
    });

    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.period)).toEqual([0, 1]);
    expect(lines.every((line) => line.color === '#2563EB')).toBe(true);
    expect(lines[1]?.dash).toBe(PERIOD_DASHES[1]);
    expect(lines[1]?.width).toBe(PERIOD_WIDTHS[1]);
  });

  it('spreads buckets across the full width and inverts the y axis', () => {
    const { lines, max } = buildOverlay({
      series: [serie('a', '#000', [[0, 3]])],
      periodCount: 1,
      focusPeriod: -1,
    });
    const top = OVERLAY_HEIGHT - (3 / max) * (OVERLAY_HEIGHT - 12);

    expect(lines[0]?.path).toBe(
      `M0.0,${OVERLAY_HEIGHT.toFixed(1)} L${OVERLAY_WIDTH.toFixed(1)},${top.toFixed(1)}`,
    );
  });

  it('centres a single bucket instead of dividing by zero', () => {
    const { lines } = buildOverlay({
      series: [serie('a', '#000', [[5]])],
      periodCount: 1,
      focusPeriod: -1,
    });

    expect(lines[0]?.path.startsWith(`M${(OVERLAY_WIDTH / 2).toFixed(1)},`)).toBe(
      true,
    );
  });

  // The x axis belongs to A. An older period that has fewer buckets keeps its
  // points on A's positions instead of being stretched over the whole width.
  it('aligns an older period by bucket index, not by date', () => {
    const { lines } = buildOverlay({
      series: [
        serie('a', '#000', [
          [1, 1, 1],
          [1, 1],
        ]),
      ],
      periodCount: 2,
      focusPeriod: -1,
    });
    const xs = (path: string) =>
      path
        .slice(1)
        .split(' L')
        .map((point) => point.split(',')[0]);

    expect(xs(lines[0]!.path)).toEqual(['0.0', '500.0', '1000.0']);
    expect(xs(lines[1]!.path)).toEqual(['0.0', '500.0']);
  });

  it('gives five grid lines from the bottom up', () => {
    const { grid } = buildOverlay({
      series: twoPeriods,
      periodCount: 2,
      focusPeriod: -1,
    });

    expect(grid.map((line) => line.y)).toEqual([
      '236.0',
      '177.0',
      '118.0',
      '59.0',
      '0.0',
    ]);
  });

  it('positions the crosshair on a bucket', () => {
    const { crosshairX } = buildOverlay({
      series: twoPeriods,
      periodCount: 2,
      focusPeriod: -1,
    });

    expect(crosshairX(0)).toBe('0.0');
    expect(crosshairX(2)).toBe('1000.0');
  });
});

describe('tooltip', () => {
  it('grows by one column per period', () => {
    expect(tooltipWidth(2)).toBe(392);
    expect(tooltipWidth(4)).toBe(584);
  });

  it('labels every column with its mark and its own date', () => {
    const columns = tooltipColumns({
      anchorStart: new Date(2026, 8, 12),
      periodDays: 7,
      periodCount: 3,
      bucket: 2,
    });

    expect(columns).toEqual([
      { mark: '—', label: '14 Sep 2026' },
      { mark: '– –', label: '7 Sep 2026' },
      { mark: '·-·', label: '31 Aug 2026' },
    ]);
  });

  it('reads each period at the same bucket, with the delta against A', () => {
    const rows = tooltipRows({
      series: twoPeriods,
      periodCount: 2,
      bucket: 1,
    });

    expect(rows).toEqual([
      {
        key: 'level_start',
        label: 'level_start',
        color: '#2563EB',
        cells: [
          { value: 2, delta: null },
          { value: 2, delta: 0 },
        ],
      },
    ]);
  });

  it('has no delta for A and none when A is zero', () => {
    const rows = tooltipRows({
      series: [
        serie('a', '#000', [
          [0],
          [4],
        ]),
      ],
      periodCount: 2,
      bucket: 0,
    });

    expect(rows[0]?.cells[0]).toEqual({ value: 0, delta: null });
    expect(rows[0]?.cells[1]).toEqual({ value: 4, delta: null });
  });

  it('reads a missing bucket of an older period as zero', () => {
    const rows = tooltipRows({
      series: [
        serie('a', '#000', [
          [4, 4],
          [4],
        ]),
      ],
      periodCount: 2,
      bucket: 1,
    });

    expect(rows[0]?.cells[1]).toEqual({ value: 0, delta: -100 });
  });

  it('shows the last series name, as the design does', () => {
    const rows = tooltipRows({
      series: [
        {
          key: '/level_start/level_mode',
          label: 'level_start › level_mode',
          color: '#000',
          valuesByPeriod: [[1]],
        },
      ],
      periodCount: 1,
      bucket: 0,
    });

    expect(rows[0]?.label).toBe('level_mode');
  });
});

describe('legend', () => {
  it('totals each period and marks it', () => {
    expect(legendRows({ series: twoPeriods, periodCount: 2 })).toEqual([
      {
        key: 'level_start',
        label: 'level_start',
        color: '#2563EB',
        cells: [
          { mark: '—', total: 6 },
          { mark: '– –', total: 6 },
        ],
      },
    ]);
  });
});
