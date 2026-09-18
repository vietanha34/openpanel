import { describe, expect, it } from 'vitest';

import {
  COMPARISON_MARKS,
  addPeriod,
  baselinePeriod,
  cancelComparison,
  comparisonFromParams,
  comparisonPeriodChips,
  comparisonToParams,
  defaultComparison,
  periodsForRequest,
  removePeriod,
  setCompareCount,
  startComparison,
  swapPeriods,
  toggleFocusPeriod,
} from './comparison-state';

const anchor = new Date(2026, 8, 12);

describe('starting and cancelling', () => {
  it('starts with two periods — baseline plus one previous', () => {
    const state = startComparison(defaultComparison(), 1);
    expect(state.compare).toBe(true);
    expect(state.compareCount).toBe(2);
  });

  it('starts with the count the menu pill picked', () => {
    expect(startComparison(defaultComparison(), 3).compareCount).toBe(4);
  });

  it('cancelling resets the sort suffix and the plotted metric', () => {
    const state = startComparison(defaultComparison(), 2);
    const cancelled = cancelComparison({ ...state, focusPeriod: 2 }, {
      sortKey: 'sum_param:coins:C',
      chartMetric: 'users',
    });

    expect(cancelled.state.compare).toBe(false);
    expect(cancelled.state.focusPeriod).toBe(-1);
    // Spec §5.3: Cancel resets the sort and the chart metric to Events.
    expect(cancelled.sortKey).toBe('sum_param:coins');
    expect(cancelled.chartMetric).toBe('events');
  });
});

describe('period count', () => {
  const two = startComparison(defaultComparison(), 1);

  it('adds a period up to four', () => {
    expect(addPeriod(two).compareCount).toBe(3);
    expect(addPeriod(addPeriod(addPeriod(two))).compareCount).toBe(4);
  });

  it('never goes past four', () => {
    const four = setCompareCount(two, 4);
    expect(addPeriod(four).compareCount).toBe(4);
  });

  it('never drops below two', () => {
    expect(removePeriod(two).compareCount).toBe(2);
  });

  it('clamps a count coming from the URL', () => {
    expect(setCompareCount(two, 9).compareCount).toBe(4);
    expect(setCompareCount(two, 0).compareCount).toBe(2);
  });

  it('drops a focus that no longer exists after removing a period', () => {
    const three = addPeriod(two);
    const focused = toggleFocusPeriod(three, 2);
    expect(focused.focusPeriod).toBe(2);
    expect(removePeriod(focused).focusPeriod).toBe(-1);
  });
});

describe('focus', () => {
  const state = startComparison(defaultComparison(), 2);

  it('isolates a period and clears on a second click', () => {
    const focused = toggleFocusPeriod(state, 1);
    expect(focused.focusPeriod).toBe(1);
    expect(toggleFocusPeriod(focused, 1).focusPeriod).toBe(-1);
  });
});

describe('swap', () => {
  it('reverses the order the periods are read in', () => {
    const state = startComparison(defaultComparison(), 2);
    expect(swapPeriods(state).reversed).toBe(true);
    expect(swapPeriods(swapPeriods(state)).reversed).toBe(false);
  });
});

describe('periodsForRequest', () => {
  const state = { ...startComparison(defaultComparison(), 2), reversed: false };

  it('is undefined while comparison is off, so the SQL is unchanged', () => {
    expect(
      periodsForRequest({ ...state, compare: false }, anchor, 7),
    ).toBeUndefined();
  });

  it('returns the baseline first, stepping back one period each time', () => {
    const periods = periodsForRequest(state, anchor, 7);
    expect(periods?.map((period) => period.startDate.slice(0, 10))).toEqual([
      '2026-09-12',
      '2026-09-05',
      '2026-08-29',
    ]);
  });

  it('keeps the baseline first even when the order is reversed', () => {
    // Swap changes how the chips read; period A stays the baseline every delta
    // is measured against (spec §3 D3).
    const periods = periodsForRequest({ ...state, reversed: true }, anchor, 7);
    expect(periods?.[0]?.startDate.slice(0, 10)).toBe('2026-09-12');
  });
});

describe('comparisonPeriodChips', () => {
  const chips = comparisonPeriodChips(
    startComparison(defaultComparison(), 2),
    anchor,
    7,
  );

  it('labels the periods A, B, C and marks A as the baseline', () => {
    expect(chips.map((chip) => chip.letter)).toEqual(['A', 'B', 'C']);
    expect(chips[0]?.mark).toBe('baseline');
    expect(chips[1]?.mark).toBe(COMPARISON_MARKS[1]);
  });

  it('prints each period range from the anchor', () => {
    expect(chips[0]?.range).toBe('Sep 12 — 18');
    expect(chips[2]?.range).toBe('Aug 29 — Sep 4');
  });

  it('offers remove only on the last chip, and only past two periods', () => {
    expect(chips.map((chip) => chip.removable)).toEqual([false, false, true]);
  });
});

describe('URL round trip', () => {
  it('reads comparison off when the flag is absent', () => {
    expect(
      comparisonFromParams({ cmp: null, cmpn: '3', cmpv: 'split', cmpf: '1' })
        .compare,
    ).toBe(false);
  });

  it('round-trips an active comparison', () => {
    const state = {
      ...startComparison(defaultComparison(), 2),
      compareView: 'split' as const,
      focusPeriod: 1,
    };
    const params = comparisonToParams(state);

    expect(params).toEqual({ cmp: '1', cmpn: '3', cmpv: 'split', cmpf: '1' });
    expect(comparisonFromParams(params)).toMatchObject({
      compare: true,
      compareCount: 3,
      compareView: 'split',
      focusPeriod: 1,
    });
  });

  it('clears every param when comparison is off', () => {
    expect(comparisonToParams(defaultComparison())).toEqual({
      cmp: null,
      cmpn: null,
      cmpv: null,
      cmpf: null,
    });
  });

  it('reads a missing focus as "nothing isolated"', () => {
    // `comparisonToParams` drops cmpf at focusPeriod -1, so the way back must
    // not turn the absent param into focus 0.
    expect(
      comparisonFromParams({
        cmp: '1',
        cmpn: '2',
        cmpv: 'overlay',
        cmpf: null,
      }).focusPeriod,
    ).toBe(-1);
    expect(
      comparisonFromParams({ cmp: '1', cmpn: null, cmpv: 'overlay', cmpf: '' }),
    ).toMatchObject({ compareCount: 2, focusPeriod: -1 });
  });

  it('survives a hand-edited URL', () => {
    expect(
      comparisonFromParams({ cmp: '1', cmpn: '99', cmpv: 'nope', cmpf: 'x' }),
    ).toMatchObject({ compareCount: 4, compareView: 'overlay', focusPeriod: -1 });
  });

  it('drops a focus that points past the last period', () => {
    expect(
      comparisonFromParams({ cmp: '1', cmpn: '2', cmpv: 'overlay', cmpf: '3' })
        .focusPeriod,
    ).toBe(-1);
  });
});

describe('baselinePeriod', () => {
  const now = new Date(2026, 8, 18);

  it('derives the window from a supported preset range', () => {
    expect(baselinePeriod({ range: '7d', now })).toEqual({
      anchorStart: new Date(2026, 8, 12),
      periodDays: 7,
    });
  });

  it('uses the custom dates when both are set', () => {
    const period = baselinePeriod({
      range: 'custom',
      startDate: '2026-09-01 00:00:00',
      endDate: '2026-09-07 23:59:59',
      now,
    });

    expect(period?.periodDays).toBe(7);
    expect(period?.anchorStart.getDate()).toBe(1);
  });

  it('refuses ranges whose length is not a fixed number of days', () => {
    // A month is not a constant length, so stepping back would break I10.
    for (const range of ['3m', 'monthToDate', 'lastHour', 'yearToDate']) {
      expect(baselinePeriod({ range, now })).toBeNull();
    }
  });

  it('refuses unparseable custom dates instead of guessing', () => {
    expect(
      baselinePeriod({ range: 'custom', startDate: 'x', endDate: 'y', now }),
    ).toBeNull();
  });
});
