import { describe, expect, it } from 'vitest';
import {
  mockEventAnalyticsList,
  mockEventAnalyticsTotals,
  mockEventPropertyKeys,
  mockEventPropertyValues,
} from './overview.event-analytics-mock';

const range = {
  projectId: 'p1',
  range: '7d' as const,
  startDate: null,
  endDate: null,
  filters: [],
};

describe('mockEventAnalyticsList', () => {
  it('returns every sample event sorted by events desc and no next cursor', () => {
    const { rows, nextCursor } = mockEventAnalyticsList({
      ...range,
      sort: 'events',
      dir: 'desc',
      limit: 10,
    });

    expect(rows.map((row) => row.name)).toEqual([
      'level_start',
      'level_finish',
      'ads_inter_shown',
      'level_lose',
      'ads_reward_shown',
      'booster_use',
      'tutorial_step',
      'iap_purchase',
    ]);
    expect(rows[0]).toEqual({ name: 'level_start', events: 842910, users: 24180 });
    expect(nextCursor).toBeNull();
  });

  it('pages with cursor and limit', () => {
    const first = mockEventAnalyticsList({
      ...range,
      sort: 'events',
      dir: 'desc',
      limit: 3,
    });
    expect(first.rows).toHaveLength(3);
    expect(first.nextCursor).toBe(3);

    const last = mockEventAnalyticsList({
      ...range,
      sort: 'events',
      dir: 'desc',
      cursor: 6,
      limit: 3,
    });
    expect(last.rows.map((row) => row.name)).toEqual([
      'tutorial_step',
      'iap_purchase',
    ]);
    expect(last.nextCursor).toBeNull();
  });

  it('sorts by users ascending', () => {
    const { rows } = mockEventAnalyticsList({
      ...range,
      sort: 'users',
      dir: 'asc',
      limit: 2,
    });
    expect(rows.map((row) => row.name)).toEqual(['iap_purchase', 'tutorial_step']);
  });

  it('filters by search, case insensitively', () => {
    const { rows } = mockEventAnalyticsList({
      ...range,
      search: 'ADS',
      sort: 'events',
      dir: 'desc',
      limit: 10,
    });
    expect(rows.map((row) => row.name)).toEqual([
      'ads_inter_shown',
      'ads_reward_shown',
    ]);
  });
});

describe('mockEventAnalyticsTotals', () => {
  it('returns deduplicated users, not the sum of the event rows', () => {
    const totals = mockEventAnalyticsTotals();
    expect(totals).toEqual({ events: 2492498, users: 25072 });

    const { rows } = mockEventAnalyticsList({
      ...range,
      sort: 'events',
      dir: 'desc',
      limit: 10,
    });
    const summedUsers = rows.reduce((acc, row) => acc + row.users, 0);
    expect(summedUsers).toBeGreaterThan(totals.users);
  });
});

describe('mockEventPropertyKeys', () => {
  it('returns top level keys with payload grouped as an object', () => {
    const { rows, nextCursor } = mockEventPropertyKeys({
      ...range,
      event: 'level_start',
      prefix: '',
      parentPath: [],
      limit: 20,
    });

    expect(rows).toEqual([
      { key: 'level_id', kind: 'key', type: 'num', events: 842910, users: 24180 },
      {
        key: 'level_mode',
        kind: 'key',
        type: 'str',
        events: 842910,
        users: 24180,
      },
      {
        key: 'payload',
        kind: 'obj',
        type: 'unknown',
        events: 842910,
        users: 24180,
      },
    ]);
    expect(nextCursor).toBeNull();
  });

  it('returns nested keys under a prefix', () => {
    const { rows } = mockEventPropertyKeys({
      ...range,
      event: 'level_start',
      prefix: 'payload.',
      parentPath: [],
      limit: 20,
    });
    expect(rows.map((row) => row.key)).toEqual([
      'payload.source',
      'payload.session_index',
    ]);
    expect(rows.map((row) => row.kind)).toEqual(['key', 'key']);
  });

  it('narrows to the keys under a parent value', () => {
    const { rows } = mockEventPropertyKeys({
      ...range,
      event: 'level_start',
      prefix: 'payload.',
      parentPath: [{ key: 'level_mode', value: 'hard' }],
      limit: 20,
    });
    expect(rows).toEqual([
      {
        key: 'payload.lives_left',
        kind: 'key',
        type: 'num',
        events: 121430,
        users: 9012,
      },
      {
        key: 'payload.retry_index',
        kind: 'key',
        type: 'num',
        events: 74980,
        users: 6431,
      },
      {
        key: 'payload.boost_pack',
        kind: 'key',
        type: 'str',
        events: 34200,
        users: 4118,
      },
    ]);
  });

  it('pages keys with cursor and limit', () => {
    const { rows, nextCursor } = mockEventPropertyKeys({
      ...range,
      event: 'level_start',
      prefix: '',
      parentPath: [],
      limit: 2,
    });
    expect(rows.map((row) => row.key)).toEqual(['level_id', 'level_mode']);
    expect(nextCursor).toBe(2);
  });

  it('returns nothing for an unknown event', () => {
    expect(
      mockEventPropertyKeys({
        ...range,
        event: 'nope',
        prefix: '',
        parentPath: [],
        limit: 20,
      })
    ).toEqual({ rows: [], nextCursor: null });
  });
});

describe('mockEventPropertyValues', () => {
  it('pages values and reports how many are left', () => {
    const { rows, remaining, nextCursor } = mockEventPropertyValues({
      ...range,
      event: 'level_start',
      key: 'level_id',
      type: 'num',
      parentPath: [],
      sort: 'events',
      dir: 'desc',
      limit: 5,
    });

    expect(rows).toHaveLength(5);
    expect(rows[0]).toEqual({ value: '2680', events: 38420, users: 9130 });
    expect(remaining).toBe(1249);
    expect(nextCursor).toBe(5);
  });

  it('keeps paging while values remain', () => {
    const { rows, remaining, nextCursor } = mockEventPropertyValues({
      ...range,
      event: 'level_start',
      key: 'level_id',
      type: 'num',
      parentPath: [],
      sort: 'events',
      dir: 'desc',
      cursor: 5,
      limit: 5,
    });
    expect(rows.map((row) => row.value)).toEqual([
      '2685',
      '2686',
      '2687',
      '2688',
      '2689',
    ]);
    expect(remaining).toBe(1244);
    expect(nextCursor).toBe(10);
  });

  it('stops paging only once the last value is served', () => {
    const { rows, remaining, nextCursor } = mockEventPropertyValues({
      ...range,
      event: 'level_start',
      key: 'level_id',
      type: 'num',
      parentPath: [],
      sort: 'events',
      dir: 'desc',
      cursor: 1250,
      limit: 5,
    });
    expect(rows).toHaveLength(4);
    expect(remaining).toBe(0);
    expect(nextCursor).toBeNull();
  });

  it('sorts by users ascending when asked', () => {
    const { rows } = mockEventPropertyValues({
      ...range,
      event: 'booster_use',
      key: 'booster_id',
      type: 'str',
      parentPath: [],
      sort: 'users',
      dir: 'asc',
      limit: 5,
    });
    expect(rows.map((row) => row.value)).toEqual([
      'rocket',
      'shuffle',
      'hammer',
    ]);
  });

  it('narrows values by parentPath', () => {
    const { rows, remaining } = mockEventPropertyValues({
      ...range,
      event: 'level_start',
      key: 'payload.lives_left',
      type: 'num',
      parentPath: [{ key: 'level_mode', value: 'classic' }],
      sort: 'events',
      dir: 'desc',
      limit: 5,
    });
    expect(rows).toEqual([
      { value: '5', events: 402880, users: 18422 },
      { value: '3', events: 143201, users: 11908 },
    ]);
    expect(remaining).toBe(0);
  });

  it('returns nothing for an unknown key', () => {
    expect(
      mockEventPropertyValues({
        ...range,
        event: 'level_start',
        key: 'nope',
        type: 'str',
        parentPath: [],
        sort: 'events',
        dir: 'desc',
        limit: 5,
      })
    ).toEqual({ rows: [], remaining: 0, nextCursor: null });
  });
});
