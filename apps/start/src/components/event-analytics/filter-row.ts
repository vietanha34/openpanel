/**
 * The Analytics tab keeps its active filter chips on a row of their own, under
 * the row of buttons (Phase 3 R1). Three sources feed that row: the flat
 * property filters and the event-name filter (both from `OverviewFiltersButtons`)
 * and the advanced filter group's chips.
 */

/** Shown in place of the chips when nothing is filtered. From the design. */
export const FILTER_ROW_EMPTY_TEXT = 'No property filters — showing all traffic';

type FilterRowCounts = {
  flatFilters: number;
  eventNames: number;
  groupConditions: number;
};

export function filterRowState({
  flatFilters,
  eventNames,
  groupConditions,
}: FilterRowCounts): { hasFilters: boolean; emptyText: string } {
  return {
    hasFilters: flatFilters + eventNames + groupConditions > 0,
    emptyText: FILTER_ROW_EMPTY_TEXT,
  };
}
