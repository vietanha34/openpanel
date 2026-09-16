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
 *
 * ---------------------------------------------------------------------------
 * Phase 2 additions (P8) -- additive, so every T8 number above still holds
 * ---------------------------------------------------------------------------
 *
 * - `app_version` (`'1.2.3'`, never parses as a number) on one of the two
 *   `ads_inter_shown` rows and on the `booster_use` row. The other
 *   `ads_inter_shown` row has no `app_version` at all, so one node holds both
 *   an unparseable value and an absent one -- which a metric must read the same
 *   way, as 0.
 * - A `profiles` seed, so a `profile.properties.*` filter has something to
 *   resolve against: u1 and u2 are on `plan = pro`, the rest on `free`.
 *
 * The missing-parameter case needs no new row: `payload.lives_left` already
 * sits on 4 of the 8 `level_start` events.
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

  /**
   * Phase 2 metrics (spec 2026-09-16 §5) over `level_start`, parameter
   * `payload.lives_left`. Four of the eight events do not carry it, and §3 D4
   * says a metric reads that as 0 -- the opposite of what a filter does.
   *
   * Coalesced value set: [5, 0, 3, 0, 5, 0, 5, 0]
   */
  livesLeftOnLevelStart: {
    events: 8,
    users: 4,
    sum_param: 18, // 5 + 3 + 5 + 5
    // 18/8, NOT 18/4: the denominator is every event in the node.
    avg_param: 2.25,
    // quantileExact over [0,0,0,0,3,5,5,5]. ClickHouse takes the element at
    // floor(n/2), so an even-sized set resolves to the upper middle value.
    median_param: 3,
    // {0, 3, 5}: without the four missing events this would be 2.
    uniq_param: 3,
    sum_param_user: 4.5, // 18/4
    uniq_param_user: 0.75, // 3/4
  },

  /**
   * The same parameter narrowed to `level_mode = hard`, where every event does
   * carry it. `uniq_param` drops from 3 to 2 because no zero joins the set.
   */
  livesLeftUnderHard: {
    events: 4,
    users: 4,
    sum_param: 18,
    avg_param: 4.5,
    median_param: 5,
    uniq_param: 2, // {3, 5}
    sum_param_user: 4.5,
    uniq_param_user: 0.5,
  },

  /**
   * `level_id` summed per event. Only `level_start` carries the parameter, so
   * sorting by `sum_param:level_id` is a different order from `events desc`.
   */
  levelIdSumByEvent: {
    level_start: 48, // 10+2+2+10+9+10+2+3
    level_finish: 0,
    ads_inter_shown: 0,
    booster_use: 0,
  },

  /** `level_id` across all 14 events, for the totals row. */
  levelIdTotals: {
    sum_param: 48,
    avg_param: 48 / 14,
    // [0,0,0,0,0,0,2,2,2,3,9,10,10,10] -> element at index 7
    median_param: 2,
    uniq_param: 5, // {0, 2, 3, 9, 10}
    sum_param_user: 9.6, // 48/5
    uniq_param_user: 1, // 5/5
  },
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
    // `app_version` never parses as a number, so every metric over it sees 0.
    properties: { placement: 'level_end', app_version: '1.2.3' },
  },
  {
    user: users.u2,
    name: 'ads_inter_shown',
    // Deliberately missing `app_version`: a metric reads that as 0 too, which
    // is how a non-numeric parameter and an absent one become indistinguishable.
    properties: { placement: 'menu_return' },
  },
  {
    user: users.u3,
    name: 'booster_use',
    properties: { booster_id: 'hammer', app_version: '1.2.3' },
  },
];

/**
 * Profiles backing the `profile.properties.*` filter subselect (Phase 2 D1).
 * u1 and u2 are on `pro`, everyone else on `free`.
 */
const FIXTURE_PROFILES: { user: string; plan: string }[] = [
  { user: users.u1, plan: 'pro' },
  { user: users.u2, plan: 'pro' },
  { user: users.u3, plan: 'free' },
  { user: users.u4, plan: 'free' },
  { user: users.u5, plan: 'free' },
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

function buildProfiles(projectId: string) {
  return FIXTURE_PROFILES.map(({ user, plan }) => ({
    id: user,
    is_external: true,
    first_name: '',
    last_name: '',
    email: '',
    avatar: '',
    properties: { plan },
    project_id: projectId,
    groups: [],
    created_at: '2024-03-04 00:00:00.000',
    last_seen_at: '2024-03-04 12:00:00.000',
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
  await ch.insert({
    table: TABLE_NAMES.profiles,
    values: buildProfiles(projectId),
    format: 'JSONEachRow',
  });
}

export async function teardownEventAnalyticsFixtures(
  projectId: string
): Promise<void> {
  for (const table of [TABLE_NAMES.events, TABLE_NAMES.profiles]) {
    await ch.command({
      query: `DELETE FROM ${table} WHERE project_id = {projectId:String}`,
      query_params: { projectId },
      // Without this the lightweight delete is asynchronous and the next insert
      // can race the cleanup, leaving doubled rows behind.
      clickhouse_settings: { mutations_sync: '2' },
    });
  }
}
