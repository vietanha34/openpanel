import {
  EVENT_ANALYTICS_MAX_PERIODS,
  type IEventAnalyticsPeriod,
  periodLabel,
  sortKeyWithoutPeriod,
} from '@openpanel/validation';

import { periodRange, periodsFrom, shiftDays } from './periods';

/**
 * Comparison mode state and the transitions the toolbar drives (Phase 3 R3).
 *
 * Pure on purpose: `apps/start` has no React test setup, so everything that can
 * be reasoned about without a DOM lives here and the component only renders.
 */

/** Line style per period, oldest last. Index 0 is the baseline. */
export const COMPARISON_MARKS = ['—', '– –', '·-·', '-·-'] as const;

/** Two periods is the smallest comparison: a baseline and one previous. */
export const MIN_COMPARE_COUNT = 2;

export type ComparisonState = {
  compare: boolean;
  /** Total periods including the baseline: 2, 3 or 4. */
  compareCount: number;
  compareView: 'overlay' | 'split';
  /** Index of the isolated period, or -1 for none. */
  focusPeriod: number;
  /** Chips read newest-last instead of newest-first. A stays the baseline. */
  reversed: boolean;
};

export function defaultComparison(): ComparisonState {
  return {
    compare: false,
    compareCount: MIN_COMPARE_COUNT,
    compareView: 'overlay',
    focusPeriod: -1,
    reversed: false,
  };
}

function clampCount(count: number): number {
  return Math.min(
    EVENT_ANALYTICS_MAX_PERIODS,
    Math.max(MIN_COMPARE_COUNT, Math.round(count)),
  );
}

/** A focus that no longer addresses a period is dropped. */
function clampFocus(state: ComparisonState): ComparisonState {
  return state.focusPeriod >= state.compareCount
    ? { ...state, focusPeriod: -1 }
    : state;
}

/** `previousCount` is what the menu's pills offer: 1, 2 or 3 previous periods. */
export function startComparison(
  state: ComparisonState,
  previousCount: number,
): ComparisonState {
  return {
    ...state,
    compare: true,
    compareCount: clampCount(previousCount + 1),
    focusPeriod: -1,
  };
}

export function setCompareCount(
  state: ComparisonState,
  count: number,
): ComparisonState {
  return clampFocus({ ...state, compareCount: clampCount(count) });
}

export function addPeriod(state: ComparisonState): ComparisonState {
  return setCompareCount(state, state.compareCount + 1);
}

export function removePeriod(state: ComparisonState): ComparisonState {
  return setCompareCount(state, state.compareCount - 1);
}

export function toggleFocusPeriod(
  state: ComparisonState,
  index: number,
): ComparisonState {
  return {
    ...state,
    focusPeriod: state.focusPeriod === index ? -1 : index,
  };
}

export function swapPeriods(state: ComparisonState): ComparisonState {
  return { ...state, reversed: !state.reversed };
}

/**
 * Leaving comparison also undoes what comparison changed elsewhere: the sort
 * loses its period suffix and the chart goes back to Events (spec §5.3).
 */
export function cancelComparison(
  state: ComparisonState,
  view: { sortKey: string; chartMetric: string },
): { state: ComparisonState; sortKey: string; chartMetric: string } {
  return {
    state: { ...defaultComparison(), compareView: state.compareView },
    sortKey: sortKeyWithoutPeriod(view.sortKey),
    chartMetric: 'events',
  };
}

/**
 * The `periods` the four endpoints take, or `undefined` when comparison is off
 * — which is what keeps the SQL byte-identical outside comparison mode.
 *
 * The baseline is always first, whatever order the chips are displayed in:
 * every delta is measured against A (spec §3 D3).
 */
export function periodsForRequest(
  state: ComparisonState,
  anchorStart: Date,
  periodDays: number,
): IEventAnalyticsPeriod[] | undefined {
  if (!state.compare) {
    return undefined;
  }
  return periodsFrom(anchorStart, periodDays, state.compareCount);
}

export type ComparisonPeriodChip = {
  index: number;
  letter: string;
  range: string;
  /** `baseline` for A, the line style for the rest. */
  mark: string;
  /** Only the last chip can go, and never below two periods. */
  removable: boolean;
};

export function comparisonPeriodChips(
  state: ComparisonState,
  anchorStart: Date,
  periodDays: number,
): ComparisonPeriodChip[] {
  const chips: ComparisonPeriodChip[] = [];

  for (let index = 0; index < state.compareCount; index++) {
    chips.push({
      index,
      letter: periodLabel(index),
      // Each chip steps one period further back; shiftDays so the month
      // boundary is handled by Date, never by arithmetic on a label.
      range: periodRange(shiftDays(anchorStart, -periodDays * index), periodDays),
      mark: index === 0 ? 'baseline' : (COMPARISON_MARKS[index] ?? ''),
      removable: index >= 2 && index === state.compareCount - 1,
    });
  }

  return chips;
}

/** URL <-> state. Unknown or malformed values fall back to the default. */
export function comparisonFromParams(params: {
  cmp: string | null;
  cmpn: string | null;
  cmpv: string | null;
  cmpf: string | null;
}): ComparisonState {
  const base = defaultComparison();
  if (params.cmp !== '1') {
    return base;
  }

  const count = Number(params.cmpn);
  const focus = Number(params.cmpf);

  return clampFocus({
    compare: true,
    compareCount: Number.isFinite(count)
      ? clampCount(count)
      : base.compareCount,
    compareView: params.cmpv === 'split' ? 'split' : 'overlay',
    focusPeriod: Number.isInteger(focus) && focus >= 0 ? focus : -1,
    reversed: false,
  });
}

export function comparisonToParams(state: ComparisonState): {
  cmp: string | null;
  cmpn: string | null;
  cmpv: string | null;
  cmpf: string | null;
} {
  if (!state.compare) {
    // null clears the param, so leaving comparison leaves a clean URL.
    return { cmp: null, cmpn: null, cmpv: null, cmpf: null };
  }

  return {
    cmp: '1',
    cmpn: String(state.compareCount),
    cmpv: state.compareView,
    cmpf: state.focusPeriod >= 0 ? String(state.focusPeriod) : null,
  };
}
