import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  zEventAnalyticsListInput,
  zEventAnalyticsTotalsInput,
  zEventPropertyKeysInput,
  zEventPropertyValuesInput,
} from './event-analytics';

const range = {
  projectId: 'p1',
  range: '7d',
  filters: [],
};

describe('zEventAnalyticsListInput', () => {
  it('defaults limit to 10', () => {
    const parsed = zEventAnalyticsListInput.parse({
      ...range,
      sort: 'events',
      dir: 'desc',
    });
    expect(parsed.limit).toBe(10);
    expect(parsed.cursor).toBeUndefined();
  });

  it('accepts null start and end dates', () => {
    const parsed = zEventAnalyticsListInput.parse({
      ...range,
      startDate: null,
      endDate: null,
      sort: 'epu',
      dir: 'asc',
    });
    expect(parsed.startDate).toBeNull();
  });

  it('rejects an unknown sort key', () => {
    expect(() =>
      zEventAnalyticsListInput.parse({ ...range, sort: 'nope', dir: 'desc' })
    ).toThrow();
  });
});

describe('zEventAnalyticsTotalsInput', () => {
  it('requires only the range fields', () => {
    expect(zEventAnalyticsTotalsInput.parse(range).projectId).toBe('p1');
  });
});

describe('zEventPropertyKeysInput', () => {
  it('defaults limit to 20', () => {
    const parsed = zEventPropertyKeysInput.parse({
      ...range,
      event: 'level_start',
      prefix: '',
      parentPath: [],
    });
    expect(parsed.limit).toBe(20);
  });

  // Levels below the event: key(1) -> value(2) -> nested key(3) -> value(4).
  // The node being queried occupies a level too, so one parentPath pair is the
  // deepest legal request: it returns keys at level 3 (and values at level 4).
  it('accepts a single parentPath pair, the deepest legal drill-down', () => {
    const parsed = zEventPropertyKeysInput.parse({
      ...range,
      event: 'level_start',
      prefix: '',
      parentPath: [{ key: 'level_mode', value: 'hard' }],
    });
    expect(parsed.parentPath).toHaveLength(1);
  });

  it('rejects two parentPath pairs, which would ask for level 5 keys', () => {
    expect(() =>
      zEventPropertyKeysInput.parse({
        ...range,
        event: 'level_start',
        prefix: '',
        parentPath: [
          { key: 'a', value: '1' },
          { key: 'b', value: '2' },
        ],
      })
    ).toThrow();
  });

  it('rejects a non-positive limit and a negative cursor', () => {
    const base = { ...range, event: 'level_start', prefix: '', parentPath: [] };
    expect(() => zEventPropertyKeysInput.parse({ ...base, limit: 0 })).toThrow();
    expect(() => zEventPropertyKeysInput.parse({ ...base, cursor: -1 })).toThrow();
  });
});

describe('zEventPropertyValuesInput', () => {
  it('defaults limit to 5', () => {
    const parsed = zEventPropertyValuesInput.parse({
      ...range,
      event: 'level_start',
      key: 'level_id',
      type: 'num',
      parentPath: [],
      sort: 'events',
      dir: 'desc',
    });
    expect(parsed.limit).toBe(5);
  });

  it('rejects an unknown property type', () => {
    expect(() =>
      zEventPropertyValuesInput.parse({
        ...range,
        event: 'level_start',
        key: 'level_id',
        type: 'bool',
        parentPath: [],
        sort: 'events',
        dir: 'desc',
      })
    ).toThrow();
  });
});

describe('module graph', () => {
  it('does not import from the package barrel, which re-exports it', () => {
    const source = readFileSync(
      new URL('./event-analytics.ts', import.meta.url),
      'utf8'
    );
    // index.ts does `export * from './event-analytics'`, so importing back from
    // './index' here would close a runtime import cycle.
    expect(source).not.toMatch(/from\s+'\.\/index'/);
  });
});
