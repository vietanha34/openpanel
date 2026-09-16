import type { IEventAnalyticsPreferences } from '@openpanel/validation';
import { describe, expect, it } from 'vitest';

// The hook lives in `src/hooks`, but this folder's vitest config is the only
// one that covers `apps/start`, so its pure helpers are tested from here.
import {
  DEFAULT_EVENT_ANALYTICS_PREFS,
  readEventAnalyticsPrefs,
  writeEventAnalyticsPrefs,
} from '../../hooks/use-event-analytics-prefs';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

const KEY = 'op:event-analytics:v1:proj';

const stored: IEventAnalyticsPreferences = {
  version: 1,
  metrics: [{ id: 'events' }, { id: 'sum_param', param: 'day' }],
  sort: { key: 'sum_param:day', dir: 'asc' },
  pct: false,
  chart: {
    metric: 'events',
    granularity: 'week',
    type: 'bar',
    collapsed: true,
  },
  selected: ['/level_start', '/ads_inter_shown'],
};

function withEntry(value: unknown) {
  return memoryStorage({ [KEY]: JSON.stringify(value) });
}

describe('readEventAnalyticsPrefs', () => {
  it('returns null when nothing is stored', () => {
    expect(readEventAnalyticsPrefs(memoryStorage(), 'proj')).toBeNull();
  });

  it('returns a valid entry as stored', () => {
    expect(readEventAnalyticsPrefs(withEntry(stored), 'proj')).toEqual(stored);
  });

  it('keeps an empty selection as an empty array, not as absent', () => {
    const prefs = readEventAnalyticsPrefs(
      withEntry({ ...stored, selected: [] }),
      'proj',
    );
    expect(prefs).not.toBeNull();
    expect(prefs?.selected).toEqual([]);
  });

  it('reads only the entry of the requested project', () => {
    const storage = withEntry(stored);
    expect(readEventAnalyticsPrefs(storage, 'other')).toBeNull();
  });

  it.each([
    ['corrupt JSON', memoryStorage({ [KEY]: '{not json' })],
    ['an unknown version', withEntry({ ...stored, version: 2 })],
    [
      'a metric id no longer in the catalogue',
      withEntry({ ...stored, metrics: [{ id: 'events' }, { id: 'gone' }] }),
    ],
    [
      'a parameter metric without its parameter',
      withEntry({ ...stored, metrics: [{ id: 'events' }, { id: 'sum_param' }] }),
    ],
    ['a missing field', withEntry({ ...stored, chart: undefined })],
    ['a non-object value', withEntry(['events'])],
    [
      'a sort key that is not among the stored metrics',
      withEntry({ ...stored, sort: { key: 'avg_param:day', dir: 'asc' } }),
    ],
  ])('discards the whole entry on %s', (_label, storage) => {
    expect(readEventAnalyticsPrefs(storage, 'proj')).toBeNull();
  });

  it('returns null when storage throws', () => {
    const storage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readEventAnalyticsPrefs(storage, 'proj')).toBeNull();
  });
});

describe('writeEventAnalyticsPrefs', () => {
  it('writes under the versioned per-project key and reads back', () => {
    const storage = memoryStorage();
    writeEventAnalyticsPrefs(storage, 'proj', stored);
    expect([...storage.data.keys()]).toEqual([KEY]);
    expect(readEventAnalyticsPrefs(storage, 'proj')).toEqual(stored);
  });

  it('does not persist fields outside the preferences schema', () => {
    const storage = memoryStorage();
    writeEventAnalyticsPrefs(storage, 'proj', {
      ...stored,
      filters: [{ name: 'x' }],
      range: '7d',
    } as IEventAnalyticsPreferences);
    const raw = JSON.parse(storage.data.get(KEY) ?? '{}');
    expect(Object.keys(raw).sort()).toEqual(
      ['chart', 'metrics', 'pct', 'selected', 'sort', 'version'].sort(),
    );
  });

  it('swallows quota errors', () => {
    const storage = {
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => writeEventAnalyticsPrefs(storage, 'proj', stored)).not.toThrow();
  });
});

describe('DEFAULT_EVENT_ANALYTICS_PREFS', () => {
  it('survives its own round trip', () => {
    const storage = memoryStorage();
    writeEventAnalyticsPrefs(storage, 'proj', DEFAULT_EVENT_ANALYTICS_PREFS);
    expect(readEventAnalyticsPrefs(storage, 'proj')).toEqual(
      DEFAULT_EVENT_ANALYTICS_PREFS,
    );
  });
});
