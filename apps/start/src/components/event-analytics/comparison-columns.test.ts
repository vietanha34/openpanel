import type {
  IEventAnalyticsMetric,
  IEventAnalyticsMetricRow,
} from '@openpanel/validation';
import { describe, expect, it } from 'vitest';

import {
  COMPARISON_COLUMN_PX,
  COMPARISON_LABEL_PX,
  comparisonColumns,
  comparisonFooterLabel,
  comparisonMinWidth,
  comparisonTableCells,
  deltaCell,
} from './comparison-columns';

const metrics: IEventAnalyticsMetric[] = [
  { id: 'events' },
  { id: 'sum_param', param: 'day' },
];

describe('comparisonColumns', () => {
  it('repeats every metric once per period, in metric order', () => {
    expect(comparisonColumns(metrics, 3).map((column) => column.key)).toEqual([
      'events:A',
      'events:B',
      'events:C',
      'sum_param:day:A',
      'sum_param:day:B',
      'sum_param:day:C',
    ]);
  });

  it('labels the metric once and the period in the sub-header', () => {
    const [a, b] = comparisonColumns(metrics, 2);

    expect(a).toMatchObject({ label: 'EVENTS', sub: 'SEGMENT A', period: 0 });
    expect(b).toMatchObject({ label: 'EVENTS', sub: 'SEGMENT B', period: 1 });
  });

  it('sorts every column by the metric of period A (§3 D7)', () => {
    for (const column of comparisonColumns(metrics, 4)) {
      expect(column.sortKey).not.toMatch(/:(A|B|C|D)$/);
    }
    expect(comparisonColumns(metrics, 4).map((c) => c.sortKey)).toEqual([
      'events',
      'events',
      'events',
      'events',
      'sum_param:day',
      'sum_param:day',
      'sum_param:day',
      'sum_param:day',
    ]);
  });
});

describe('comparisonMinWidth', () => {
  it('is the pinned name track plus one 118px column per metric and period', () => {
    expect(COMPARISON_LABEL_PX).toBe(300);
    expect(COMPARISON_COLUMN_PX).toBe(118);
    expect(comparisonMinWidth(2, 2)).toBe(300 + 2 * 2 * 118);
    expect(comparisonMinWidth(4, 4)).toBe(300 + 4 * 4 * 118);
  });
});

describe('deltaCell', () => {
  it('signs the change and colours it by direction', () => {
    expect(deltaCell(120, 100)).toEqual({ text: '+20.00 %', tone: 'up' });
    expect(deltaCell(80, 100)).toEqual({ text: '-20.00 %', tone: 'down' });
  });

  it('reads an unchanged value as flat', () => {
    expect(deltaCell(100, 100)).toEqual({ text: '0.00 %', tone: 'flat' });
  });

  it('shows a dash when the baseline is 0 — there is nothing to compare', () => {
    expect(deltaCell(12, 0)).toEqual({ text: '—', tone: 'flat' });
    expect(deltaCell(0, 0)).toEqual({ text: '—', tone: 'flat' });
  });
});

describe('comparisonTableCells', () => {
  const row: IEventAnalyticsMetricRow = {
    events: 100,
    users: 20,
    metrics: { 'sum_param:day': 40 },
    periods: [
      { events: 100, users: 20, metrics: { 'sum_param:day': 40 } },
      { events: 50, users: 25, metrics: { 'sum_param:day': 30 } },
    ],
  };
  const totals: IEventAnalyticsMetricRow = {
    events: 1000,
    users: 200,
    metrics: { 'sum_param:day': 400 },
    periods: [
      { events: 1000, users: 200, metrics: { 'sum_param:day': 400 } },
      { events: 500, users: 50, metrics: { 'sum_param:day': 300 } },
    ],
  };

  it('reads each period from its own entry', () => {
    const cells = comparisonTableCells(metrics, 2, row, totals, false);

    expect(cells.map((cell) => cell.value.value)).toEqual([
      '100',
      '50',
      '40.00',
      '30.00',
    ]);
  });

  it('leaves the baseline without a delta and measures B against A', () => {
    const cells = comparisonTableCells(metrics, 2, row, totals, false);

    expect(cells[0]?.delta).toBeNull();
    expect(cells[1]?.delta).toEqual({ text: '-50.00 %', tone: 'down' });
    expect(cells[3]?.delta).toEqual({ text: '-25.00 %', tone: 'down' });
  });

  it('divides a ratio by its own period, never by the baseline (§3 D2)', () => {
    const [a, b] = comparisonTableCells([{ id: 'pctu' }], 2, row, totals, false);

    // A: 20 / 200. B: 25 / 50 — B's own users, not A's.
    expect(a?.value.value).toBe('10.00 %');
    expect(b?.value.value).toBe('50.00 %');
    expect(b?.delta).toEqual({ text: '+400.00 %', tone: 'up' });
  });

  it('applies the % toggle to column A only: B–D use the line for the delta', () => {
    const cells = comparisonTableCells(metrics, 2, row, totals, true);

    expect(cells[0]?.value.sub).toBe('10.00 %');
    expect(cells[1]?.value.sub).toBeNull();
  });

  it('falls back to the top-level row when a period is missing', () => {
    const flat: IEventAnalyticsMetricRow = { events: 7, users: 2 };
    const cells = comparisonTableCells([{ id: 'events' }], 2, flat, flat, false);

    expect(cells.map((cell) => cell.value.value)).toEqual(['7', '7']);
    expect(cells[1]?.delta).toEqual({ text: '0.00 %', tone: 'flat' });
  });
});

describe('comparisonFooterLabel', () => {
  it('joins the period ranges with vs, baseline first', () => {
    expect(
      comparisonFooterLabel(['Sep 12 — 18', 'Sep 5 — 11', 'Aug 29 — Sep 4']),
    ).toBe('Sep 12 — 18 vs Sep 5 — 11 vs Aug 29 — Sep 4');
  });
});
