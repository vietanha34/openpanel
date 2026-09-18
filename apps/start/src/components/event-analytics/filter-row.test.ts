import { describe, expect, it } from 'vitest';

import { FILTER_ROW_EMPTY_TEXT, filterRowState } from './filter-row';

/**
 * R1: the active filter chips move to their own row under the toolbar. That row
 * shows the chips when any filter is applied, and the design's empty line when
 * none is — across all three filter sources the Analytics tab has.
 */
describe('filterRowState', () => {
  it('is empty when no filter of any kind is applied', () => {
    expect(
      filterRowState({ flatFilters: 0, eventNames: 0, groupConditions: 0 }),
    ).toEqual({ hasFilters: false, emptyText: FILTER_ROW_EMPTY_TEXT });
  });

  it('counts a flat property filter', () => {
    expect(
      filterRowState({ flatFilters: 1, eventNames: 0, groupConditions: 0 })
        .hasFilters,
    ).toBe(true);
  });

  it('counts an event-name filter, which renders its own chips', () => {
    expect(
      filterRowState({ flatFilters: 0, eventNames: 2, groupConditions: 0 })
        .hasFilters,
    ).toBe(true);
  });

  it('counts an advanced filter group', () => {
    expect(
      filterRowState({ flatFilters: 0, eventNames: 0, groupConditions: 3 })
        .hasFilters,
    ).toBe(true);
  });

  it('never returns the empty text as a chip label', () => {
    expect(FILTER_ROW_EMPTY_TEXT).toBe(
      'No property filters — showing all traffic',
    );
  });
});
