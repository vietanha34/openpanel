import { describe, expect, it } from 'vitest';

import {
  AXIS_LABEL_MAX,
  DIMMED_OPACITY,
  ISOLATED_WIDTH,
  OVERLAY_HEIGHT,
  OVERLAY_WIDTH,
  PERIOD_DASHES,
  PERIOD_OPACITY,
  PERIOD_WIDTHS,
  SPLIT_HEIGHT,
  buildOverlay,
  buildSplitPanels,
  legendRows,
  mergeComparisonSeries,
  overlayScale,
  periodLineStyle,
  tooltipColumns,
  tooltipRows,
  tooltipWidth,
  axisLabels,
  tooltipAnchor,
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

describe('mergeComparisonSeries', () => {
  const period = (series: { names: string[]; counts: number[] }[]) => ({
    series: series.map((serie, index) => ({
      id: `id-${index}`,
      names: serie.names,
      data: serie.counts.map((count) => ({ count })),
    })),
  });
  const colorAt = (index: number) => `#${index}`;

  it('keeps period A order and colours by that order', () => {
    const merged = mergeComparisonSeries(
      [
        period([
          { names: ['level_start'], counts: [1, 2] },
          { names: ['ads_inter_shown'], counts: [3, 4] },
        ]),
        period([
          { names: ['ads_inter_shown'], counts: [5, 6] },
          { names: ['level_start'], counts: [7, 8] },
        ]),
      ],
      colorAt,
    );

    expect(merged.map((serie) => serie.label)).toEqual([
      'level_start',
      'ads_inter_shown',
    ]);
    expect(merged.map((serie) => serie.color)).toEqual(['#0', '#1']);
    // Matched by name, not by position in the older period's response.
    expect(merged[0]?.valuesByPeriod).toEqual([
      [1, 2],
      [7, 8],
    ]);
  });

  it('joins breakdown names the way the table paths read', () => {
    const merged = mergeComparisonSeries(
      [period([{ names: ['level_start', 'hard'], counts: [1] }])],
      colorAt,
    );

    expect(merged[0]?.label).toBe('level_start › hard');
    expect(merged[0]?.key).toBe('level_start › hard');
  });

  it('leaves a period that never returned the series empty', () => {
    const merged = mergeComparisonSeries(
      [
        period([{ names: ['level_start'], counts: [1, 2] }]),
        period([{ names: ['other'], counts: [9] }]),
      ],
      colorAt,
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]?.valuesByPeriod).toEqual([[1, 2], []]);
  });

  it('is empty until period A has loaded', () => {
    expect(mergeComparisonSeries([undefined, period([])], colorAt)).toEqual([]);
  });
});

describe('buildSplitPanels', () => {
  const panelsOf = (periodCount: number, series = twoPeriods) =>
    buildSplitPanels({
      series,
      periodCount,
      anchorStart: new Date(2026, 8, 12),
      periodDays: 7,
      bucketLabels: ['12.09', '13.09', '14.09'],
    });

  it('builds one panel per period, newest first', () => {
    const panels = panelsOf(2);

    expect(panels.map((panel) => [panel.period, panel.letter])).toEqual([
      [0, 'A'],
      [1, 'B'],
    ]);
    expect(panels.map((panel) => panel.range)).toEqual([
      'Sep 12 — 18',
      'Sep 5 — 11',
    ]);
    expect(panels.map((panel) => panel.mark)).toEqual(['—', '– –']);
  });

  // Shared y axis: both panels use the overlay's max, so a taller period is
  // visibly taller instead of every panel being normalised to its own peak.
  it('plots every panel on the overlay scale', () => {
    const panels = panelsOf(2);
    const { max } = buildOverlay({
      series: twoPeriods,
      periodCount: 2,
      focusPeriod: -1,
    });
    const yOf = (path: string) => path.split(',')[1]?.split(' ')[0];
    const expected = (
      SPLIT_HEIGHT -
      (1 / max) * (SPLIT_HEIGHT - 10)
    ).toFixed(1);

    // Period A's first bucket is 1 on a scale whose max comes from 3.
    expect(yOf(panels[0]!.lines[0]!.path)).toBe(expected);
  });

  it('draws the series solid, told apart by colour', () => {
    const panels = panelsOf(2);

    expect(panels[0]?.lines).toEqual([
      { key: 'level_start', color: '#2563EB', path: expect.any(String) },
    ]);
  });

  it('keeps A x positions in every panel', () => {
    const panels = buildSplitPanels({
      series: [
        {
          key: 'a',
          label: 'a',
          color: '#000',
          valuesByPeriod: [
            [1, 1, 1],
            [1, 1],
          ],
        },
      ],
      periodCount: 2,
      anchorStart: new Date(2026, 8, 12),
      periodDays: 7,
      bucketLabels: ['12.09', '13.09', '14.09'],
    });
    const xs = (path: string) =>
      path
        .slice(1)
        .split(' L')
        .map((point) => point.split(',')[0]);

    expect(xs(panels[1]!.lines[0]!.path)).toEqual(['0.0', '500.0']);
  });

  it('gives each panel three grid lines', () => {
    expect(panelsOf(2)[0]?.grid.map((line) => line.y)).toEqual([
      '132.0',
      '66.0',
      '0.0',
    ]);
  });

  it('totals every plotted series per period', () => {
    const panels = panelsOf(2);

    expect(panels.map((panel) => panel.total)).toEqual([6, 6]);
  });

  it('measures the delta of all series against A, and A has none', () => {
    const panels = buildSplitPanels({
      series: [
        {
          key: 'a',
          label: 'a',
          color: '#000',
          valuesByPeriod: [[10], [5]],
        },
        {
          key: 'b',
          label: 'b',
          color: '#111',
          valuesByPeriod: [[10], [10]],
        },
      ],
      periodCount: 2,
      anchorStart: new Date(2026, 8, 12),
      periodDays: 7,
      bucketLabels: ['12.09'],
    });

    expect(panels[0]?.delta).toBeNull();
    // (15 / 20 - 1) * 100
    expect(panels[1]?.delta).toBeCloseTo(-25, 10);
  });

  it('has no delta when A totals zero', () => {
    const panels = buildSplitPanels({
      series: [
        { key: 'a', label: 'a', color: '#000', valuesByPeriod: [[0], [4]] },
      ],
      periodCount: 2,
      anchorStart: new Date(2026, 8, 12),
      periodDays: 7,
      bucketLabels: ['12.09'],
    });

    expect(panels[1]?.delta).toBeNull();
  });

  it('labels the first and last bucket of the axis', () => {
    const panels = panelsOf(2);

    expect(panels[0]?.xFirst).toBe('12.09');
    expect(panels[0]?.xLast).toBe('14.09');
  });

  it('is empty without series', () => {
    expect(panelsOf(2, [])).toEqual([]);
  });
});

describe('axisLabels', () => {
  const labels = (count: number) =>
    Array.from({ length: count }, (_, index) => `b${index}`);

  it('prints every label while the axis has room', () => {
    expect(axisLabels(labels(AXIS_LABEL_MAX))).toHaveLength(AXIS_LABEL_MAX);
  });

  it('prints every fourth label once the axis is crowded', () => {
    expect(axisLabels(labels(13))).toEqual(['b0', 'b4', 'b8', 'b12']);
    expect(axisLabels(labels(24))).toHaveLength(6);
  });

  it('never draws more labels than fit, however long the range', () => {
    // An hourly week is 168 buckets; every fourth label is still a smudge.
    expect(axisLabels(labels(168)).length).toBeLessThanOrEqual(AXIS_LABEL_MAX);
  });
});

describe('tooltipAnchor', () => {
  it('centres the tooltip loosely in the middle of the plot', () => {
    expect(tooltipAnchor(5, 11)).toEqual({
      left: '50%',
      transform: 'translateX(-40%)',
    });
  });

  it('anchors at the ends so the tooltip stays inside the card', () => {
    expect(tooltipAnchor(0, 11).transform).toBe('translateX(0)');
    expect(tooltipAnchor(10, 11).transform).toBe('translateX(-100%)');
  });

  it('treats a single bucket as the left edge', () => {
    expect(tooltipAnchor(0, 1)).toEqual({
      left: '0%',
      transform: 'translateX(0)',
    });
  });
});
