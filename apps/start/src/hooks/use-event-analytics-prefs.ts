import {
  allowedSortKeys,
  EVENT_ANALYTICS_PREFS_VERSION,
  eventAnalyticsPrefsKey,
  type IEventAnalyticsPreferences,
  zEventAnalyticsPreferences,
} from '@openpanel/validation';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Persisted Event Analytics view preferences, one localStorage entry per
 * project. See docs/superpowers/specs/2026-09-16-event-analytics-phase2-design.md §6.
 *
 * Filters, the filter group, the date range and the search term are NOT here:
 * they are URL state (shareable) or transient. Expanded tree nodes are not
 * persisted either (A13).
 *
 * No `@/` imports in this file: its pure helpers are unit tested under the
 * event-analytics vitest config, which has no path aliases.
 */

/** Today's table columns and chart controls. */
export const DEFAULT_EVENT_ANALYTICS_PREFS: IEventAnalyticsPreferences = {
  version: EVENT_ANALYTICS_PREFS_VERSION,
  metrics: [{ id: 'events' }, { id: 'users' }, { id: 'epu' }, { id: 'pctu' }],
  sort: { key: 'events', dir: 'desc' },
  pct: true,
  chart: {
    metric: 'events',
    granularity: 'day',
    // The chart component's `IChartType` value; §6's example says "line".
    type: 'linear',
    collapsed: false,
  },
  selected: [],
};

function parsePrefs(value: unknown): IEventAnalyticsPreferences | null {
  const result = zEventAnalyticsPreferences.safeParse(value);
  if (!result.success) {
    return null;
  }
  // A stored sort the request schema would reject must not survive either,
  // otherwise the restored view fails its first query.
  if (!allowedSortKeys(result.data.metrics).includes(result.data.sort.key)) {
    return null;
  }
  return result.data;
}

/**
 * The stored preferences, or `null` when there is nothing usable: no entry,
 * unreadable storage, corrupt JSON, or any schema failure. An invalid entry is
 * discarded wholesale — never partially restored.
 *
 * `null` is "no entry"; an entry whose `selected` is `[]` is a deliberate empty
 * selection. The chart's cold-start default must only apply to the former.
 */
export function readEventAnalyticsPrefs(
  storage: Pick<Storage, 'getItem'>,
  projectId: string,
): IEventAnalyticsPreferences | null {
  try {
    const raw = storage.getItem(eventAnalyticsPrefsKey(projectId));
    return raw === null ? null : parsePrefs(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeEventAnalyticsPrefs(
  storage: Pick<Storage, 'setItem'>,
  projectId: string,
  prefs: IEventAnalyticsPreferences,
): void {
  // Parsing strips keys outside the schema, so nothing else leaks into storage.
  const valid = parsePrefs(prefs);
  if (!valid) {
    return;
  }
  try {
    storage.setItem(eventAnalyticsPrefsKey(projectId), JSON.stringify(valid));
  } catch {
    // Quota exceeded or storage disabled: preferences are best effort.
  }
}

const WRITE_DEBOUNCE_MS = 300;

/**
 * - `loading`: storage not read yet (the first render is server-rendered, so
 *   nothing can be read before mount). `prefs` holds the defaults.
 * - `absent`: no usable entry for this project — the only state in which the
 *   chart's cold-start selection may apply.
 * - `stored`: an entry was restored, even if its `selected` is empty.
 *
 * The status describes what was found on load; writing does not change it.
 */
export type EventAnalyticsPrefsStatus = 'loading' | 'absent' | 'stored';

export type EventAnalyticsPrefsPatch = Partial<
  Omit<IEventAnalyticsPreferences, 'version'>
>;

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

interface LoadedState {
  projectId: string;
  status: Exclude<EventAnalyticsPrefsStatus, 'loading'>;
  prefs: IEventAnalyticsPreferences;
}

export function useEventAnalyticsPrefs(projectId: string): {
  status: EventAnalyticsPrefsStatus;
  prefs: IEventAnalyticsPreferences;
  /** Ignored while `loading`, so an early write cannot clobber the entry. */
  update: (patch: EventAnalyticsPrefsPatch) => void;
} {
  const [state, setState] = useState<LoadedState | null>(null);
  const pending = useRef<{
    projectId: string;
    prefs: IEventAnalyticsPreferences;
  } | null>(null);

  const flush = useCallback(() => {
    const write = pending.current;
    pending.current = null;
    const storage = browserStorage();
    if (write && storage) {
      writeEventAnalyticsPrefs(storage, write.projectId, write.prefs);
    }
  }, []);

  useEffect(() => {
    const storage = browserStorage();
    const stored = storage ? readEventAnalyticsPrefs(storage, projectId) : null;
    setState({
      projectId,
      status: stored ? 'stored' : 'absent',
      prefs: stored ?? DEFAULT_EVENT_ANALYTICS_PREFS,
    });
    // Do not lose the last change when leaving the page or the project.
    return flush;
  }, [projectId, flush]);

  useEffect(() => {
    if (!state) {
      return;
    }
    const timer = window.setTimeout(flush, WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [state, flush]);

  const update = useCallback(
    (patch: EventAnalyticsPrefsPatch) => {
      setState((current) => {
        if (current?.projectId !== projectId) {
          return current;
        }
        const prefs = { ...current.prefs, ...patch };
        pending.current = { projectId, prefs };
        return { ...current, prefs };
      });
    },
    [projectId],
  );

  const loaded = state?.projectId === projectId ? state : null;
  return {
    status: loaded?.status ?? 'loading',
    prefs: loaded?.prefs ?? DEFAULT_EVENT_ANALYTICS_PREFS,
    update,
  };
}
