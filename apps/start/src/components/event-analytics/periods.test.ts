import { describe, expect, it } from 'vitest';

import {
  axisLabel,
  deltaPercent,
  longDate,
  periodRange,
  periodsFrom,
  shiftDays,
} from './periods';

describe('shiftDays', () => {
  it('crosses a month boundary backwards', () => {
    // The requirements name the bug this replaces: subtracting on the day
    // number of a string turned "Sep 15 minus 21 days" into "-6 Sep".
    expect(shiftDays(new Date(2026, 8, 12), -21).toDateString()).toBe(
      new Date(2026, 7, 22).toDateString(),
    );
  });

  it('crosses a year boundary backwards', () => {
    expect(shiftDays(new Date(2026, 0, 3), -7).toDateString()).toBe(
      new Date(2025, 11, 27).toDateString(),
    );
  });

  it('does not mutate its argument', () => {
    const date = new Date(2026, 8, 12);
    shiftDays(date, -7);
    expect(date.getDate()).toBe(12);
  });
});

describe('periodsFrom', () => {
  const periods = periodsFrom(new Date(2026, 8, 12), 7, 4);

  it('puts the baseline first and steps back one period at a time', () => {
    expect(periods.map((period) => period.startDate.slice(0, 10))).toEqual([
      '2026-09-12',
      '2026-09-05',
      '2026-08-29',
      '2026-08-22',
    ]);
  });

  it('ends each period on its last day, inclusive', () => {
    expect(periods[0]?.endDate.slice(0, 10)).toBe('2026-09-18');
    expect(periods[3]?.endDate.slice(0, 10)).toBe('2026-08-28');
  });

  it('spans the whole day so nothing falls between two periods', () => {
    expect(periods[0]?.startDate).toMatch(/00:00:00$/);
    expect(periods[0]?.endDate).toMatch(/23:59:59$/);
  });

  it('gives every period the same length (invariant I10)', () => {
    const lengths = periods.map(
      (period) =>
        Date.parse(period.endDate.replace(' ', 'T')) -
        Date.parse(period.startDate.replace(' ', 'T')),
    );
    expect(new Set(lengths).size).toBe(1);
  });
});

describe('labels', () => {
  it('formats the axis as dd.mm', () => {
    expect(axisLabel(new Date(2026, 8, 5))).toBe('05.09');
    expect(axisLabel(new Date(2026, 8, 5, 14), 'hour')).toBe('14:00');
    expect(axisLabel(new Date(2026, 8, 5, 14), 'day')).toBe('05.09');
  });

  it('formats a long date', () => {
    expect(longDate(new Date(2026, 8, 5))).toBe('5 Sep 2026');
  });

  it('omits the repeated month inside one period', () => {
    expect(periodRange(new Date(2026, 8, 12), 7)).toBe('Sep 12 — 18');
  });

  it('keeps both months when a period crosses one', () => {
    expect(periodRange(new Date(2026, 7, 29), 7)).toBe('Aug 29 — Sep 4');
  });
});

describe('deltaPercent', () => {
  it('is the relative change against the baseline', () => {
    expect(deltaPercent(150, 100)).toBe(50);
    expect(deltaPercent(50, 100)).toBe(-50);
    expect(deltaPercent(100, 100)).toBe(0);
  });

  it('is null when the baseline is zero — not comparable, not "unchanged"', () => {
    // Spec A3: the design renders 0.00 % here; the requirements ask for "—",
    // and this returns null so the renderer can show it.
    expect(deltaPercent(42, 0)).toBeNull();
    expect(deltaPercent(0, 0)).toBeNull();
  });
});
