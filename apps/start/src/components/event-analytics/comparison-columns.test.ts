import type {
  IEventAnalyticsMetric,
  IEventAnalyticsMetricRow,
} from '@openpanel/validation';
import { describe, expect, it } from 'vitest';

import {
  comparisonColumns,
  comparisonMinWidth,
  comparisonTableCells,
  deltaCell,
} from './comparison-columns';

const metrics: IEventAnalyticsMetric[] = [
  { id: 'events' },
  { id: 'users' },
];

const row: IEventAnalyticsMetricRow = {
  events: 120,
  users: 40,
  periods: [
    { events: 120, users: 40 },
    { events: 80, users: 50 },
    { events: 0, users: 0 },
  ],
};

const totals: IEventAnalyticsMetricRow = {
  events: 400,
  users: 100,
  periods: [
    { events: 400, users: 100 },
    { events: 300, users: 90 },
    { events: 0, users: 0 },
  ],
};

describe('comparisonColumns', () => {
  const columns = comparisonColumns(metrics, 3);

  it('is one column per metric per period', () => {
    expect(columns).toHaveLength(6);
  });

  it('repeats the metric label and sub-labels the period', () => {
    expect(columns.slice(0, 3).map((column) => column.label)).toEqual([
      'EVENTS',
      'EVENTS',
      'EVENTS',
    ]);
    expect(columns.slice(0, 3).map((column) => column.sub)).toEqual([
      'SEGMENT A',
      'SEGMENT B',
      'SEGMENT C',
    ]);
  });

  it('keys each column with the metric and its period letter', () => {
    expect(columns.map((column) => column.key).slice(0, 3)).toEqual([
      'events:A',
      'events:B',
      'events:C',
    ]);
  });

  it('sorts every column of one metric by that metric of period A', () => {
    // Clicking B must not reorder the rows (spec §3 D7).
    expect(columns.map((column) => column.sortKey).slice(0, 3)).toEqual([
      'events',
      'events',
      'events',
    ]);
  });
});

describe('comparisonMinWidth', () => {
  it('is the pinned name track plus 118px per column', () => {
    expect(comparisonMinWidth(2, 3)).toBe(300 + 2 * 3 * 118);
  });
});

describe('deltaCell', () => {
  it('is positive and green above the baseline', () => {
    expect(deltaCell(150, 100)).toEqual({ text: '+50.00 %', tone: 'up' });
  });

  it('is negative and red below it', () => {
    expect(deltaCell(50, 100)).toEqual({ text: '-50.00 %', tone: 'down' });
  });

  it('is flat and grey when the change rounds to nothing', () => {
    expect(deltaCell(100, 100)).toEqual({ text: '0.00 %', tone: 'flat' });
    expect(deltaCell(100.004, 100)).toEqual({ text: '0.00 %', tone: 'flat' });
  });

  it('is a dash when the baseline is zero — not comparable (spec A3)', () => {
    expect(deltaCell(42, 0)).toEqual({ text: '—', tone: 'flat' });
  });
});

describe('comparisonTableCells', () => {
  const cells = comparisonTableCells(metrics, 3, row, totals, false);

  it('gives period A a value and no delta', () => {
    expect(cells[0]?.value.value).toBe('120');
    expect(cells[0]?.delta).toBeNull();
  });

  it('gives later periods a delta against A', () => {
    // 80 events against A's 120 is a third less.
    expect(cells[1]?.delta).toEqual({ text: '-33.33 %', tone: 'down' });
  });

  it('dashes the delta when period A has nothing to divide by', () => {
    const empty = comparisonTableCells(
      metrics,
      2,
      { events: 0, users: 0, periods: [{ events: 0, users: 0 }, { events: 5, users: 2 }] },
      totals,
      false,
    );

    expect(empty[1]?.delta).toEqual({ text: '—', tone: 'flat' });
  });

  it('reads each period against its own totals, never the baseline totals', () => {
    // `% of all users` for period B divides by period B's own user total.
    const pct = comparisonTableCells([{ id: 'pctu' }], 2, row, totals, false);

    expect(pct[0]?.value.value).toBe('40.00 %');
    expect(pct[1]?.value.value).toBe('55.56 %');
  });
});
