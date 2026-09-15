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

  it('rejects a parentPath deeper than 4 levels', () => {
    expect(() =>
      zEventPropertyKeysInput.parse({
        ...range,
        event: 'level_start',
        prefix: '',
        parentPath: [
          { key: 'a', value: '1' },
          { key: 'b', value: '2' },
          { key: 'c', value: '3' },
          { key: 'd', value: '4' },
          { key: 'e', value: '5' },
        ],
      })
    ).toThrow();
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
