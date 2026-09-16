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
