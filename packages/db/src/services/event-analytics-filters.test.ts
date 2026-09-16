import type { IChartEventFilter, IFilterGroup } from '@openpanel/validation';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { TABLE_NAMES, ch } from '../clickhouse/client';
import {
  EVENT_ANALYTICS_BLUEPRINT,
  EVENT_ANALYTICS_FIXTURE,
  setupEventAnalyticsFixtures,
  teardownEventAnalyticsFixtures,
} from './event-analytics-fixtures';
import {
  buildEventAnalyticsListQuery,
  buildEventAnalyticsQuery,
  buildEventAnalyticsTotalsQuery,
  buildEventPropertyKeysQuery,
  buildEventPropertyValuesQuery,
  overviewService,
} from './overview.service';

const range = {
  projectId: 'test-event-analytics-filters',
  startDate: '2026-09-01 00:00:00',
  endDate: '2026-09-02 00:00:00',
  timezone: 'UTC',
};

const propertyFilter: IChartEventFilter[] = [
  {
    id: 'properties.level_mode',
    name: 'properties.level_mode',
    operator: 'is' as const,
    value: ['hard'],
  },
];

const utmFilter: IChartEventFilter[] = [
  {
    id: 'utm_source',
    name: 'utm_source',
    operator: 'is' as const,
    value: ['newsletter'],
  },
];

const cohortFilter: IChartEventFilter[] = [
  {
    id: 'cohort',
    name: 'cohort',
    operator: 'inCohort' as const,
    value: [],
    cohortIds: ['cohort-1'],
  },
];

const profileFilter: IChartEventFilter[] = [
  {
    id: 'profile.properties.plan',
    name: 'profile.properties.plan',
    operator: 'is' as const,
    value: ['pro'],
  },
];

// One profile filter per operator family the compiler branches on: equality,
// presence, numeric comparison (the branch that guards events maps with
// mapContains), null checks.
const profileOperatorFilters: IChartEventFilter[] = [
  ...profileFilter,
  { name: 'profile.properties.plan', operator: 'hasProperty', value: [] },
  { name: 'profile.properties.plan', operator: 'missingProperty', value: [] },
  { name: 'profile.properties.seats', operator: 'gt', value: ['5'] },
  { name: 'profile.properties.seats', operator: 'lte', value: ['50'] },
  { name: 'profile.properties.plan', operator: 'isNull', value: [] },
];

const profileCondition = (plan: string) => ({
  kind: 'condition' as const,
  filter: {
    name: 'profile.properties.plan',
    operator: 'is' as const,
    value: [plan],
  },
});

// The profile category also offers the profiles table's own columns. One per
// operator family, including a date comparison on a DateTime64 column.
const profileColumnFilters: IChartEventFilter[] = [
  { name: 'profile.email', operator: 'is', value: ['u5@example.com'] },
  { name: 'profile.first_name', operator: 'contains', value: ['An'] },
  { name: 'profile.last_name', operator: 'isNull', value: [] },
  { name: 'profile.id', operator: 'isNot', value: ['ea-u1'] },
  { name: 'profile.created_at', operator: 'gt', value: ['2024-01-01'] },
  { name: 'profile.last_seen_at', operator: 'hasProperty', value: [] },
];

/** AND root holding one OR group made only of profile conditions. */
const profileOrGroup: IFilterGroup = {
  kind: 'group',
  op: 'and',
  children: [
    {
      kind: 'group',
      op: 'or',
      children: [profileCondition('pro'), profileCondition('team')],
    },
  ],
};

const listExtras = { sort: 'events' as const, dir: 'desc' as const, limit: 10 };
const keysExtras = {
  event: 'level_complete',
  prefix: '',
  parentPath: [],
  limit: 10,
};
const valuesExtras = {
  event: 'level_complete',
  key: 'level_mode',
  type: 'str' as const,
  parentPath: [],
  sort: 'events' as const,
  dir: 'desc' as const,
  cursor: 0,
  limit: 10,
};

// Every event analytics SQL built from the same filter set — the property
// filter must survive into all of them.
const builders: Record<
  string,
  (filters: IChartEventFilter[], filterGroup?: IFilterGroup) => string
> = {
  analytics: (filters, filterGroup) =>
    buildEventAnalyticsQuery({ ...range, filters, filterGroup }).toSQL(),
  list: (filters, filterGroup) =>
    buildEventAnalyticsListQuery({ ...range, ...listExtras, filters, filterGroup }).toSQL(),
  totals: (filters, filterGroup) =>
    buildEventAnalyticsTotalsQuery({ ...range, filters, filterGroup }).toSQL(),
  propertyKeys: (filters, filterGroup) =>
    // The keys/values input types do not declare `filterGroup`, but both
    // builders forward the whole range to the shared base query.
    buildEventPropertyKeysQuery({
      ...range,
      ...keysExtras,
      filters,
      ...{ filterGroup },
    }).toSQL(),
  propertyValues: (filters, filterGroup) =>
    buildEventPropertyValuesQuery({
      ...range,
      ...valuesExtras,
      filters,
      ...{ filterGroup },
    }).toSQL(),
};

let chReachable = false;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

beforeAll(async () => {
  try {
    await ch.command({ query: 'SELECT 1' });
    chReachable = true;
  } catch {
    chReachable = false;
  }
});

afterEach(() => vi.restoreAllMocks());

describe.each(Object.entries(builders))('%s property filters', (_name, build) => {
  it('keeps a properties.* filter instead of dropping it silently', () => {
    expect(build(propertyFilter)).toContain(
      "properties['level_mode'] = 'hard'"
    );
  });

  it('reads utm_source out of the properties map, not a top-level column', () => {
    const sql = build(utmFilter);

    expect(sql).toContain("properties['__query.utm_source'] = 'newsletter'");
    expect(sql).not.toMatch(/(?<!\.)\butm_source\s*=/);
  });

  it('resolves a profile property filter through a self-contained subselect', () => {
    const sql = build(profileFilter);

    expect(sql).toContain(
      `profile_id IN (SELECT id FROM profiles AS profile FINAL WHERE project_id = '${range.projectId}' AND profile.properties['plan'] = 'pro')`
    );
  });

  // Phase 1 spec §5.4, kept by the Phase 2 spec §3 D1: presence is a map
  // lookup compared with '', never mapContains — for every operator. Counted
  // against the unfiltered SQL because the property values builder carries
  // its own mapContains on the events map it drills into.
  it('never emits mapContains for a profile property filter', () => {
    const count = (sql: string) => sql.split('mapContains').length - 1;
    const baseline = count(build([]));

    for (const filter of profileOperatorFilters) {
      expect(count(build([filter]))).toBe(baseline);
    }
    expect(build(profileOperatorFilters)).toContain(
      "profile.properties['plan'] != ''"
    );
  });

  it('keeps a profile filter inside an OR group instead of dropping the group', () => {
    const sql = build([], profileOrGroup);

    expect(sql).toContain(
      "((profile_id IN (SELECT id FROM profiles AS profile FINAL WHERE project_id = 'test-event-analytics-filters' AND profile.properties['plan'] = 'pro')) OR (profile_id IN (SELECT id FROM profiles AS profile FINAL WHERE project_id = 'test-event-analytics-filters' AND profile.properties['plan'] = 'team'))"
    );
  });

  it('resolves a profile column filter through the same subselect', () => {
    expect(build([profileColumnFilters[0]!])).toContain(
      `profile_id IN (SELECT id FROM profiles AS profile FINAL WHERE project_id = '${range.projectId}' AND profile.email = 'u5@example.com')`
    );
  });

  // B1 dropped these while the compiler kept the `profile.properties.` prefix
  // in the key pattern and left a trailing `.*` literal (B5 fixed both).
  it('resolves a wildcard profile property filter through the subselect', () => {
    expect(
      build([
        { name: 'profile.properties.items.*', operator: 'is', value: ['x'] },
      ])
    ).toContain(
      `profile_id IN (SELECT id FROM profiles AS profile FINAL WHERE project_id = '${range.projectId}' AND arrayExists(x -> x = 'x', arrayMap(x -> trim(x), mapValues(mapExtractKeyLike(profile.properties, 'items.%')))))`
    );
  });

  it('drops a profile field that is not a profiles column', () => {
    expect(
      build([{ name: 'profile.nickname', operator: 'is', value: ['x'] }])
    ).toBe(build([]));
  });

  it('resolves a cohort filter through a self-contained subselect', () => {
    const sql = build(cohortFilter);

    expect(sql).toContain('profile_id IN (SELECT profile_id FROM');
    expect(sql).toContain("'cohort-1'");
  });

  it('parses in ClickHouse when available', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    await ch.command({ query: `EXPLAIN ${build(propertyFilter)}` });
    await ch.command({ query: `EXPLAIN ${build(utmFilter)}` });
    await ch.command({ query: `EXPLAIN ${build(cohortFilter)}` });
    await ch.command({ query: `EXPLAIN ${build(profileOperatorFilters)}` });
    await ch.command({ query: `EXPLAIN ${build(profileColumnFilters)}` });
    await ch.command({
      query: `EXPLAIN ${build([
        ...profileFilter,
        { name: 'profile.properties.items.*', operator: 'is', value: ['x'] },
      ])}`,
    });
    await ch.command({
      query: `EXPLAIN ${build([], profileOrGroup)}`,
    });
  });
});

// Real data, not SQL text: the Phase 1 failure mode was a dropped branch
// silently turning an OR group into "no restriction". Only u1 is on `pro` and
// only u5 on `team`, so the group must shrink the totals to those two users.
const MUTATION_HOOK_TIMEOUT_MS = 60_000;

describe('profile filter inside an OR group against ClickHouse', () => {
  const projectId = 'test-event-analytics-profile-or';
  const { users } = EVENT_ANALYTICS_FIXTURE;
  const input = { projectId, ...EVENT_ANALYTICS_FIXTURE.range };

  const deleteProfiles = () =>
    ch.command({
      query: `DELETE FROM ${TABLE_NAMES.profiles} WHERE project_id = {projectId:String}`,
      query_params: { projectId },
      clickhouse_settings: { mutations_sync: '2' },
    });

  beforeAll(async () => {
    if (!chReachable) return;
    await setupEventAnalyticsFixtures(projectId);
    await deleteProfiles();
    await ch.insert({
      table: TABLE_NAMES.profiles,
      format: 'JSONEachRow',
      values: [
        [users.u1, 'pro'],
        [users.u2, 'free'],
        [users.u5, 'team'],
      ].map(([id, plan]) => ({
        id,
        email: `${id}@example.com`,
        project_id: projectId,
        // Only u5 carries a nested key, for the wildcard filter below.
        properties:
          id === users.u5 ? { plan, 'items.0.name': 'sword' } : { plan },
        created_at: '2024-03-01 00:00:00',
        last_seen_at: '2024-03-04 00:00:00',
      })),
    });
    // Lightweight deletes queue behind other suites' mutations on a shared
    // ClickHouse; the default 10s hook timeout is not enough under load.
  }, MUTATION_HOOK_TIMEOUT_MS);

  afterAll(async () => {
    if (!chReachable) return;
    await teardownEventAnalyticsFixtures(projectId);
    await deleteProfiles();
  }, MUTATION_HOOK_TIMEOUT_MS);

  it('narrows the totals to the matching profiles instead of widening them', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const unfiltered = await overviewService.getEventAnalyticsTotals({
      ...input,
      filters: [],
    });
    const filtered = await overviewService.getEventAnalyticsTotals({
      ...input,
      filters: [],
      filterGroup: profileOrGroup,
    });

    expect(unfiltered).toEqual(EVENT_ANALYTICS_BLUEPRINT.totals);
    // u1: 3 level_start + 1 level_finish; u5: 2 level_finish + 1 ads_inter_shown
    expect(filtered).toEqual({ events: 7, users: 2 });
  });

  it('matches a wildcard profile key against the nested keys', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const totals = await overviewService.getEventAnalyticsTotals({
      ...input,
      filters: [
        {
          name: 'profile.properties.items.*.name',
          operator: 'is',
          value: ['sword'],
        },
      ],
    });

    // u5 only: 2 level_finish + 1 ads_inter_shown.
    expect(totals).toEqual({ events: 3, users: 1 });
  });

  it('matches a trailing events wildcard against the nested keys', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const totals = await overviewService.getEventAnalyticsTotals({
      ...input,
      filters: [
        { name: 'properties.payload.*', operator: 'is', value: ['replay'] },
      ],
    });

    // level_start rows 3 (u2) and 7 (u4) carry payload.source = replay.
    expect(totals).toEqual({ events: 2, users: 2 });
  });

  it('narrows the totals by a profile column inside an OR group', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const totals = await overviewService.getEventAnalyticsTotals({
      ...input,
      filters: [],
      filterGroup: {
        kind: 'group',
        op: 'or',
        children: [
          profileCondition('pro'),
          {
            kind: 'condition',
            filter: {
              name: 'profile.email',
              operator: 'is',
              value: [`${users.u5}@example.com`],
            },
          },
        ],
      },
    });

    // u1 (plan pro) and u5 (by email): the same two users as pro OR team.
    expect(totals).toEqual({ events: 7, users: 2 });
  });

  it('ORs a profile branch with an event property branch', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const totals = await overviewService.getEventAnalyticsTotals({
      ...input,
      filters: [],
      filterGroup: {
        kind: 'group',
        op: 'or',
        children: [
          profileCondition('pro'),
          {
            kind: 'condition',
            filter: {
              name: 'properties.level_mode',
              operator: 'is',
              value: ['hard'],
            },
          },
        ],
      },
    });

    // hard rows 2, 3, 5, 7 (u1, u2, u3, u4) plus every u1 event (rows 1, 2,
    // 8 and one level_finish): rows 1, 2, 3, 5, 7, 8 + level_finish = 7.
    expect(totals).toEqual({ events: 7, users: 4 });
  });
});
