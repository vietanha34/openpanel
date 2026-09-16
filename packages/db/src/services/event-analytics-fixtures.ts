/**
 * Deterministic ClickHouse fixture for the event analytics tree (T8).
 *
 * Pattern: `test/retention-fixtures.ts`. Every event sits on a FIXED absolute
 * date so the expected numbers are a hand-computed blueprint, not a snapshot.
 * Shape follows the design sample `tree` in `EventAnalyticsScreen.dc.html`:
 * event -> property key -> value -> nested key -> value.
 *
 * ---------------------------------------------------------------------------
 * Dataset (all on 2024-03-04, project id is passed in per suite)
 * ---------------------------------------------------------------------------
 *
 *   event             rows  users               per-event users
 *   level_start        8    u1, u2, u3, u4      4
 *   level_finish       3    u1, u5              2
 *   ads_inter_shown    2    u2, u5              2
 *   booster_use        1    u3                  1
 *
 *   sum of per-event users = 9, deduplicated users = 5
 *
 * The overlap is the point: `eventAnalyticsTotals` must report 5, never 9.
 *
 * `level_start` rows, by property (empty cell = key absent):
 *
 *   #  user  level_id  level_mode  payload.source  payload.session_index  payload.lives_left  payload.meta.ab.group
 *   1  u1    10        classic     map             1
 *   2  u1    2         hard        map             2                      5
 *   3  u2    2         hard        replay          1                      3
 *   4  u2    10        classic     map             1
 *   5  u3    9         hard        map                                    5                   b
 *   6  u3    10        classic     map
 *   7  u4    2         hard        replay                                 5
 *   8  u1    3         classic     map
 *
 * Row 1 carries two keys under `payload` and rows 2/3/5 carry three, so the
 * `payload` object row proves an event is counted once per object, not once
 * per key below it (naive counting would report 17 events instead of 8).
 */

import { TABLE_NAMES, ch } from '../clickhouse/client';

export const EVENT_ANALYTICS_FIXTURE = {
  users: {
    u1: 'ea-u1',
    u2: 'ea-u2',
    u3: 'ea-u3',
    u4: 'ea-u4',
    u5: 'ea-u5',
  },
  range: {
    startDate: '2024-03-04 00:00:00',
    endDate: '2024-03-04 23:59:59',
    timezone: 'UTC',
  },
} as const;

/**
 * Hand-computed expectations. Derived by reading the table above, never by
 * running the query first.
 */
export const EVENT_ANALYTICS_BLUEPRINT = {
  /** Sorted by events desc, then name asc. */
  list: [
    { name: 'level_start', events: 8, users: 4 },
    { name: 'level_finish', events: 3, users: 2 },
    { name: 'ads_inter_shown', events: 2, users: 2 },
    { name: 'booster_use', events: 1, users: 1 },
  ],
  totals: { events: 14, users: 5 },
  /** What a broken totals query summing the branches would return. */
  summedBranchUsers: 9,
} as const;

type FixtureEvent = {
  user: string;
  name: string;
  properties: Record<string, string>;
};

const { users } = EVENT_ANALYTICS_FIXTURE;

const FIXTURE_EVENTS: FixtureEvent[] = [
  // --- level_start: the drillable event -----------------------------------
  {
    user: users.u1,
    name: 'level_start',
    properties: {
      level_id: '10',
      level_mode: 'classic',
      'payload.source': 'map',
      'payload.session_index': '1',
    },
  },
  {
    user: users.u1,
    name: 'level_start',
    properties: {
      level_id: '2',
      level_mode: 'hard',
      'payload.source': 'map',
      'payload.session_index': '2',
      'payload.lives_left': '5',
    },
  },
  {
    user: users.u2,
    name: 'level_start',
    properties: {
      level_id: '2',
      level_mode: 'hard',
      'payload.source': 'replay',
      'payload.session_index': '1',
      'payload.lives_left': '3',
    },
  },
  {
    user: users.u2,
    name: 'level_start',
    properties: {
      level_id: '10',
      level_mode: 'classic',
      'payload.source': 'map',
      'payload.session_index': '1',
    },
  },
  {
    user: users.u3,
    name: 'level_start',
    properties: {
      level_id: '9',
      level_mode: 'hard',
      'payload.source': 'map',
      'payload.lives_left': '5',
      // Four segments: the deepest nesting the fixture carries.
      'payload.meta.ab.group': 'b',
    },
  },
  {
    user: users.u3,
    name: 'level_start',
    properties: {
      level_id: '10',
      level_mode: 'classic',
      'payload.source': 'map',
    },
  },
  {
    user: users.u4,
    name: 'level_start',
    properties: {
      level_id: '2',
      level_mode: 'hard',
      'payload.source': 'replay',
      'payload.lives_left': '5',
    },
  },
  {
    user: users.u1,
    name: 'level_start',
    properties: {
      level_id: '3',
      level_mode: 'classic',
      'payload.source': 'map',
    },
  },

  // --- level_finish: mixed-type key next to a numeric one ------------------
  { user: users.u1, name: 'level_finish', properties: { stars: '3', grade: '1' } },
  { user: users.u5, name: 'level_finish', properties: { stars: '2', grade: '2' } },
  {
    user: users.u5,
    name: 'level_finish',
    // `gold` is what makes `grade` a `str` key while `stars` stays `num`.
    properties: { stars: '2', grade: 'gold' },
  },

  // --- events that only exist to overlap users with the ones above ---------
  {
    user: users.u5,
    name: 'ads_inter_shown',
    properties: { placement: 'level_end' },
  },
  {
    user: users.u2,
    name: 'ads_inter_shown',
    properties: { placement: 'menu_return' },
  },
  { user: users.u3, name: 'booster_use', properties: { booster_id: 'hammer' } },
];

function buildEvents(projectId: string) {
  return FIXTURE_EVENTS.map((event, index) => ({
    id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`,
    project_id: projectId,
    profile_id: event.user,
    device_id: `dev-${event.user}`,
    name: event.name,
    session_id: `sess-${event.user}`,
    created_at: '2024-03-04 12:00:00',
    path: '/',
    origin: 'https://example.com',
    referrer: '',
    referrer_name: '',
    referrer_type: '',
    revenue: 0,
    duration: 0,
    properties: event.properties,
    groups: [],
    country: 'US',
    city: '',
    region: '',
    sdk_name: 'web',
    sdk_version: '1.0.0',
    os: '',
    os_version: '',
    browser: 'Chrome',
    browser_version: '',
    device: 'desktop',
    brand: '',
    model: '',
  }));
}

export async function setupEventAnalyticsFixtures(
  projectId: string
): Promise<void> {
  await teardownEventAnalyticsFixtures(projectId);
  await ch.insert({
    table: TABLE_NAMES.events,
    values: buildEvents(projectId),
    format: 'JSONEachRow',
  });
}

export async function teardownEventAnalyticsFixtures(
  projectId: string
): Promise<void> {
  await ch.command({
    query: `DELETE FROM ${TABLE_NAMES.events} WHERE project_id = {projectId:String}`,
    query_params: { projectId },
    // Without this the lightweight delete is asynchronous and the next insert
    // can race the cleanup, leaving doubled rows behind.
    clickhouse_settings: { mutations_sync: '2' },
  });
}
