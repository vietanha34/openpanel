import type {
  IEventAnalyticsListInput,
  IEventAnalyticsListOutput,
  IEventAnalyticsPropertyType,
  IEventAnalyticsSortDir,
  IEventAnalyticsSortKey,
  IEventAnalyticsTotalsOutput,
  IEventPropertyKeyRow,
  IEventPropertyKeysInput,
  IEventPropertyKeysOutput,
  IEventPropertyValuesInput,
  IEventPropertyValuesOutput,
} from '@openpanel/validation';

/**
 * Deterministic mock data for the event analytics tree, transcribed from the
 * design file's `tree` sample (Claude Design project
 * cde63790-13aa-464a-851a-edf3a279a8e3, EventAnalyticsScreen.dc.html).
 *
 * Wave 1 replaces these resolvers with real ClickHouse queries; the shapes they
 * return are the binding contract in
 * docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md §4.
 */

type Metric = { events: number; users: number };

type MockValue = Metric & {
  value: string;
  /** Keys that only exist below this value (nested drill-down). */
  keys?: MockKey[];
};

type MockKey = Metric & {
  /** Full dotted path, e.g. `payload.source`. */
  path: string;
  type: Exclude<IEventAnalyticsPropertyType, 'unknown'>;
  values?: MockValue[];
  /** Distinct values beyond the ones sampled here. */
  remaining?: number;
};

type MockEvent = Metric & {
  name: string;
  keys: MockKey[];
};

const TREE: MockEvent[] = [
  {
    name: 'level_start',
    events: 842910,
    users: 24180,
    keys: [
      {
        path: 'level_id',
        type: 'num',
        events: 842910,
        users: 24180,
        remaining: 1244,
        values: [
          { value: '2680', events: 38420, users: 9130 },
          { value: '2681', events: 35110, users: 8740 },
          { value: '2682', events: 31980, users: 8402 },
          { value: '2683', events: 29455, users: 8117 },
          { value: '2684', events: 27310, users: 7866 },
          { value: '2685', events: 25904, users: 7602 },
          { value: '2686', events: 24188, users: 7311 },
          { value: '2687', events: 22740, users: 7065 },
          { value: '2688', events: 21403, users: 6822 },
          { value: '2689', events: 20190, users: 6588 },
        ],
      },
      {
        path: 'level_mode',
        type: 'str',
        events: 842910,
        users: 24180,
        values: [
          {
            value: 'classic',
            events: 612300,
            users: 22050,
            keys: [
              {
                path: 'payload.lives_left',
                type: 'num',
                events: 546081,
                users: 18422,
                values: [
                  { value: '5', events: 402880, users: 18422 },
                  { value: '3', events: 143201, users: 11908 },
                ],
              },
              {
                path: 'payload.boost_pack',
                type: 'str',
                events: 66219,
                users: 7204,
                values: [{ value: 'starter', events: 66219, users: 7204 }],
              },
            ],
          },
          {
            value: 'hard',
            events: 230610,
            users: 11840,
            keys: [
              {
                path: 'payload.lives_left',
                type: 'num',
                events: 121430,
                users: 9012,
                values: [{ value: '5', events: 121430, users: 9012 }],
              },
              {
                path: 'payload.retry_index',
                type: 'num',
                events: 74980,
                users: 6431,
                values: [{ value: '2', events: 74980, users: 6431 }],
              },
              {
                path: 'payload.boost_pack',
                type: 'str',
                events: 34200,
                users: 4118,
                values: [{ value: 'none', events: 34200, users: 4118 }],
              },
            ],
          },
        ],
      },
      {
        path: 'payload.source',
        type: 'str',
        events: 842910,
        users: 24180,
        values: [
          { value: 'map', events: 704120, users: 23410 },
          { value: 'replay', events: 138790, users: 9877 },
        ],
      },
      {
        path: 'payload.session_index',
        type: 'num',
        events: 842910,
        users: 24180,
        values: [
          { value: '1', events: 244810, users: 21002 },
          { value: '2', events: 198440, users: 16310 },
        ],
      },
    ],
  },
  {
    name: 'level_finish',
    events: 611204,
    users: 23504,
    keys: [
      {
        path: 'stars',
        type: 'num',
        events: 611204,
        users: 23504,
        values: [
          { value: '3', events: 301220, users: 19880 },
          { value: '2', events: 188400, users: 16402 },
          { value: '1', events: 121584, users: 12044 },
        ],
      },
      { path: 'duration_ms', type: 'num', events: 611204, users: 23504 },
    ],
  },
  {
    name: 'ads_inter_shown',
    events: 402588,
    users: 21033,
    keys: [
      {
        path: 'placement',
        type: 'str',
        events: 402588,
        users: 21033,
        values: [
          { value: 'level_end', events: 288410, users: 19204 },
          { value: 'menu_return', events: 114178, users: 11028 },
        ],
      },
      { path: 'network', type: 'str', events: 402588, users: 21033 },
    ],
  },
  {
    name: 'level_lose',
    events: 231706,
    users: 19860,
    keys: [
      {
        path: 'fail_reason',
        type: 'str',
        events: 231706,
        users: 19860,
        values: [
          { value: 'out_of_moves', events: 178220, users: 17402 },
          { value: 'timeout', events: 53486, users: 7911 },
        ],
      },
    ],
  },
  {
    name: 'ads_reward_shown',
    events: 188340,
    users: 9410,
    keys: [{ path: 'placement', type: 'str', events: 188340, users: 9410 }],
  },
  {
    name: 'booster_use',
    events: 96415,
    users: 12507,
    keys: [
      {
        path: 'booster_id',
        type: 'str',
        events: 96415,
        users: 12507,
        values: [
          { value: 'hammer', events: 44190, users: 8802 },
          { value: 'shuffle', events: 31408, users: 6914 },
          { value: 'rocket', events: 20817, users: 5230 },
        ],
      },
    ],
  },
  {
    name: 'tutorial_step',
    events: 77220,
    users: 8820,
    keys: [{ path: 'step_index', type: 'num', events: 77220, users: 8820 }],
  },
  {
    name: 'iap_purchase',
    events: 42115,
    users: 1204,
    keys: [{ path: 'product_id', type: 'str', events: 42115, users: 1204 }],
  },
];

/** Users seen across the whole sample, counted once (design: `uniqueUsers`). */
const UNIQUE_USERS = 25072;

function metricValue(row: Metric, sort: IEventAnalyticsSortKey) {
  if (sort === 'events') {
    return row.events;
  }
  if (sort === 'users') {
    return row.users;
  }
  return row.users === 0 ? 0 : row.events / row.users;
}

function sortRows<T extends Metric>(
  rows: T[],
  sort: IEventAnalyticsSortKey,
  dir: IEventAnalyticsSortDir
) {
  const direction = dir === 'desc' ? -1 : 1;
  return rows
    .slice()
    .sort((a, b) => (metricValue(a, sort) - metricValue(b, sort)) * direction);
}

function page<T>(rows: T[], cursor: number | undefined, limit: number) {
  const offset = cursor ?? 0;
  const slice = rows.slice(offset, offset + limit);
  const next = offset + slice.length;
  return { slice, nextCursor: next < rows.length ? next : null };
}

/** Keys visible at `parentPath`: the event's own keys, or a value's nested keys. */
function keysAtPath(
  event: MockEvent | undefined,
  parentPath: { key: string; value: string }[]
): MockKey[] {
  if (!event) {
    return [];
  }
  let keys = event.keys;
  for (const step of parentPath) {
    const key = keys.find((candidate) => candidate.path === step.key);
    const value = key?.values?.find(
      (candidate) => candidate.value === step.value
    );
    if (!value?.keys) {
      return [];
    }
    keys = value.keys;
  }
  return keys;
}

export function mockEventAnalyticsList(
  input: Pick<
    IEventAnalyticsListInput,
    'search' | 'sort' | 'dir' | 'cursor' | 'limit'
  >
): IEventAnalyticsListOutput {
  const search = input.search?.trim().toLowerCase();
  const matched = search
    ? TREE.filter((event) => event.name.toLowerCase().includes(search))
    : TREE;
  const sorted = sortRows(matched, input.sort, input.dir);
  const { slice, nextCursor } = page(sorted, input.cursor, input.limit);

  return {
    rows: slice.map((event) => ({
      name: event.name,
      events: event.events,
      users: event.users,
    })),
    nextCursor,
  };
}

export function mockEventAnalyticsTotals(): IEventAnalyticsTotalsOutput {
  return {
    events: TREE.reduce((acc, event) => acc + event.events, 0),
    users: UNIQUE_USERS,
  };
}

export function mockEventPropertyKeys(
  input: Pick<
    IEventPropertyKeysInput,
    'event' | 'prefix' | 'parentPath' | 'cursor' | 'limit'
  >
): IEventPropertyKeysOutput {
  const event = TREE.find((candidate) => candidate.name === input.event);
  const keys = keysAtPath(event, input.parentPath).filter((key) =>
    key.path.startsWith(input.prefix)
  );

  // Group by the first segment after the prefix: a segment with more segments
  // behind it is an object node the UI can expand further.
  const grouped = new Map<string, IEventPropertyKeyRow>();
  for (const key of keys) {
    const rest = key.path.slice(input.prefix.length);
    const dot = rest.indexOf('.');
    const isObject = dot !== -1;
    const path = input.prefix + (isObject ? rest.slice(0, dot) : rest);
    const existing = grouped.get(path);
    if (existing) {
      existing.events = Math.max(existing.events, key.events);
      existing.users = Math.max(existing.users, key.users);
      continue;
    }
    grouped.set(path, {
      key: path,
      kind: isObject ? 'obj' : 'key',
      type: isObject ? 'unknown' : key.type,
      events: key.events,
      users: key.users,
    });
  }

  const { slice, nextCursor } = page(
    [...grouped.values()],
    input.cursor,
    input.limit
  );
  return { rows: slice, nextCursor };
}

export function mockEventPropertyValues(
  input: Pick<
    IEventPropertyValuesInput,
    'event' | 'key' | 'type' | 'parentPath' | 'sort' | 'dir' | 'cursor' | 'limit'
  >
): IEventPropertyValuesOutput {
  const event = TREE.find((candidate) => candidate.name === input.event);
  const key = keysAtPath(event, input.parentPath).find(
    (candidate) => candidate.path === input.key
  );
  if (!key?.values) {
    return { rows: [], remaining: 0, nextCursor: null };
  }

  const sorted = sortRows(key.values, input.sort, input.dir);
  const { slice, nextCursor } = page(sorted, input.cursor, input.limit);
  const totalDistinct = key.values.length + (key.remaining ?? 0);
  const seen = (input.cursor ?? 0) + slice.length;

  return {
    rows: slice.map((value) => ({
      value: value.value,
      events: value.events,
      users: value.users,
    })),
    remaining: Math.max(0, totalDistinct - seen),
    nextCursor,
  };
}
