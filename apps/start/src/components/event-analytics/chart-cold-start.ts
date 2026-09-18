import { childPath } from './tree-utils';

/** How many events the chart plots on a cold start (R1). */
export const COLD_START_SELECTION_SIZE = 5;

type ColdStartArgs = {
  /** Event names in the order the list returned them (the current sort). */
  names: string[];
  selectedCount: number;
  /**
   * A stored `selected` entry exists, even an empty one. An empty stored
   * selection is a deliberate choice; only an ABSENT entry gets the default.
   */
  hasPersistedSelection: boolean;
};

/**
 * The event paths to select when the chart would otherwise start empty, or
 * `null` when the default must not apply. The caller runs it once per mount.
 */
export function coldStartSelection({
  names,
  selectedCount,
  hasPersistedSelection,
}: ColdStartArgs): string[] | null {
  if (hasPersistedSelection || selectedCount > 0 || names.length === 0) {
    return null;
  }
  return names
    .slice(0, COLD_START_SELECTION_SIZE)
    .map((name) => childPath('', name));
}

export type ColdStartPrefsStatus = 'loading' | 'stored' | 'absent';

type ColdStartTriggerArgs = {
  prefsStatus: ColdStartPrefsStatus;
  /** Only read by `coldStartSelection`; kept here so callers pass one object. */
  selectedCount: number;
  /** Serialised filters of the previous render; `null` on the first one. */
  previousFilterKey: string | null;
  filterKey: string;
};

/**
 * What the route should do this render (R2).
 *
 * - `wait` — preferences are still loading; deciding now could clobber them.
 * - `seed` — first render with nothing stored: the original cold start.
 * - `reseed` — the filter changed: clear the selection and seed the top rows of
 *   the filtered list. This happens even when preferences ARE stored, and it
 *   drops a selection the user picked by hand — R2 asks for exactly that
 *   ("clear the previous selection and add the new one").
 * - `none` — leave the selection alone. Notably when the filter is unchanged,
 *   which is what keeps a deliberately emptied selection empty.
 */
export function coldStartTrigger({
  prefsStatus,
  selectedCount,
  previousFilterKey,
  filterKey,
}: ColdStartTriggerArgs): 'wait' | 'seed' | 'reseed' | 'none' {
  if (prefsStatus === 'loading') {
    return 'wait';
  }

  if (previousFilterKey === null) {
    // `coldStartSelection` owns the "already has a selection" guard; keeping it
    // in one place stops the two from drifting apart.
    return prefsStatus === 'absent' ? 'seed' : 'none';
  }

  return previousFilterKey === filterKey ? 'none' : 'reseed';
}
