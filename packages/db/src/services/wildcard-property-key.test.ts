/**
 * Wildcard property keys (B5). A wildcard key names every nested key under a
 * prefix and has three forms, all of which must become a LIKE pattern over
 * the map's keys:
 *
 *   properties.items.*.name   middle  -> items.%.name
 *   properties.tags[*]        array   -> tags.%
 *   properties.items.*        trailing-> items.%
 *
 * The same holds for `profile.properties.*` against the profile map. Before
 * B5 the trailing form stayed a literal `*` (the query crashed or never
 * matched), and profile patterns kept their `profile.properties.` prefix (they
 * never matched).
 */

import type { IChartEventFilter } from '@openpanel/validation';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ch } from '../clickhouse/client';
import {
  compileEventFilter,
  getChartSql as _getChartSql,
  getSelectPropertyKey,
  transformPropertyKey,
} from './chart.service';

// The SQL builder ignores the display-only fields of its input type.
const getChartSql: (input: any) => Promise<string> = _getChartSql as any;

let chReachable = false;

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await ch.command({ query: 'SELECT 1' });
    chReachable = true;
  } catch {
    chReachable = false;
  }
});

const chartSql = (filters: IChartEventFilter[], breakdowns: string[] = []) =>
  getChartSql({
    event: { id: 'A', name: 'screen_view', segment: 'event', filters },
    breakdowns: breakdowns.map((name) => ({ id: name, name })),
    interval: 'day',
    startDate: '2026-04-14 00:00:00',
    endDate: '2026-05-15 00:00:00',
    projectId: 'test-wildcard-property-key',
    timezone: 'UTC',
  });

describe('transformPropertyKey', () => {
  it.each([
    ['properties.items.*.name', 'items.%.name'],
    ['properties.tags[*]', 'tags.%'],
    ['properties.items.*', 'items.%'],
    ['properties.items.*.variants.*', 'items.%.variants.%'],
    ['profile.properties.items.*.name', 'items.%.name'],
    ['profile.properties.tags[*]', 'tags.%'],
    ['profile.properties.items.*', 'items.%'],
    // An events key that merely starts with "profile" keeps its name.
    ['properties.profile_type.*', 'profile_type.%'],
    // Several wildcards: every one becomes `%`, not only the first.
    ['properties.a.*.b.*.c', 'a.%.b.%.c'],
    // Adjacent wildcards share their dot, so a non-overlapping match would
    // skip the second one.
    ['properties.a.*.*.c', 'a.%.%.c'],
    // What the `chart.properties` router actually emits for nested array
    // indexes: `a.0.1.c`, `a.0.1.2.3`, `a.0.1.b.2.3.c`.
    ['properties.a.*[*].c', 'a.%.%.c'],
    ['properties.a.*[*].*[*]', 'a.%.%.%.%'],
    ['properties.a.*[*].b.*[*].c', 'a.%.%.b.%.%.c'],
    ['profile.properties.a.*.b.*.c', 'a.%.b.%.c'],
  ])('%s -> %s', (key, pattern) => {
    expect(transformPropertyKey(key)).toBe(pattern);
  });
});

// Captured from the code before B5. Nothing without a `*`, and neither events
// wildcard form that already worked, may change by a single byte.
describe('unchanged SQL', () => {
  it.each([
    [
      { name: 'properties.level', operator: 'is', value: ['5'] },
      "properties['level'] = '5'",
    ],
    [
      { name: 'properties.level', operator: 'gt', value: ['5'] },
      "(mapContains(properties, 'level') AND (toFloat64OrNull(properties['level']) > toFloat64('5')))",
    ],
    [
      { name: 'properties.level', operator: 'hasProperty', value: [] },
      "properties['level'] != ''",
    ],
    [
      { name: 'properties.profile_type', operator: 'is', value: ['a'] },
      "properties['profile_type'] = 'a'",
    ],
    [
      { name: 'profile.properties.plan', operator: 'is', value: ['pro'] },
      "profile.properties['plan'] = 'pro'",
    ],
    [
      { name: 'profile.properties.seats', operator: 'lte', value: ['50'] },
      "(toFloat64OrNull(profile.properties['seats']) <= toFloat64('50'))",
    ],
    [
      { name: 'profile.properties.plan', operator: 'missingProperty', value: [] },
      "profile.properties['plan'] = ''",
    ],
    [{ name: 'country', operator: 'is', value: ['SE'] }, "country = 'SE'"],
    [
      { name: 'properties.items.*.name', operator: 'is', value: ['x'] },
      "arrayExists(x -> x = 'x', arrayMap(x -> trim(x), mapValues(mapExtractKeyLike(properties, 'items.%.name'))))",
    ],
    [
      { name: 'properties.tags[*]', operator: 'contains', value: ['x'] },
      "arrayExists(x -> x LIKE '%x%', arrayMap(x -> trim(x), mapValues(mapExtractKeyLike(properties, 'tags.%'))))",
    ],
    [
      { name: 'properties.items.*.qty', operator: 'gte', value: ['2'] },
      "arrayExists(x -> toFloat64OrNull(x) >= toFloat64('2'), arrayMap(x -> trim(x), mapValues(mapExtractKeyLike(properties, 'items.%.qty'))))",
    ],
  ] as [IChartEventFilter, string][])('%o', (filter, sql) => {
    expect(compileEventFilter(filter, 'p', undefined, 'events')).toBe(sql);
  });

  it.each([
    ['properties.level', "properties['level']"],
    ['profile.properties.plan', "profile.properties['plan']"],
    ['country', 'country'],
  ])('select key %s', (key, sql) => {
    expect(getSelectPropertyKey(key)).toBe(sql);
  });
});

const FORMS = {
  middle: 'items.*.name',
  trailing: 'items.*',
  array: 'tags[*]',
  multiple: 'a.*.b.*.c',
} as const;
const OPERATORS = [
  { operator: 'is', value: ['5'] },
  { operator: 'gt', value: ['5'] },
  { operator: 'hasProperty', value: [] },
] as const;
const MAPS = { events: 'properties', profile: 'profile.properties' } as const;

const matrix = Object.entries(MAPS).flatMap(([scope, map]) =>
  Object.entries(FORMS).flatMap(([form, key]) =>
    OPERATORS.map(({ operator, value }) => ({
      label: `${scope} ${form} ${operator}`,
      filter: {
        name: `${map}.${key}`,
        operator,
        value: [...value],
      } as IChartEventFilter,
    }))
  )
);

describe('wildcard filter matrix through getChartSql', () => {
  it.for(matrix)('$label compiles to a key pattern and runs', async ({
    filter,
  }, ctx) => {
    const clause = compileEventFilter(filter, 'p', undefined, 'events');

    expect(clause).toMatch(/^(NOT )?arrayExists\(/);
    expect(clause).toContain("mapExtractKeyLike(");
    expect(clause).not.toContain("'profile.properties.");
    expect(clause).not.toMatch(/'[^']*\*[^']*'\)/);

    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    await ch.command({ query: `EXPLAIN ${await chartSql([filter])}` });
  });

  it('breaks down by a profile wildcard key without its prefix', async (ctx) => {
    expect(getSelectPropertyKey('profile.properties.items.*.name')).toBe(
      "arrayMap(x -> trim(x), mapValues(mapExtractKeyLike(profile.properties, 'items.%.name')))"
    );

    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    await ch.command({
      query: `EXPLAIN ${await chartSql([], ['profile.properties.items.*.name'])}`,
    });
  });
});

// ClickHouse evaluates the compiled clause against a literal map, so this
// proves the pattern selects the intended keys, not merely that it parses.
describe('wildcard clauses match the intended keys', () => {
  const evaluate = async (filter: IChartEventFilter, map: string) => {
    const clause = compileEventFilter(filter, 'p', undefined, 'events');
    const [alias, column] = filter.name.startsWith('profile.')
      ? ['profile', 'properties']
      : ['e', 'properties'];
    const result = await ch.query({
      query: `SELECT ${clause} AS matched FROM (SELECT ${map} AS ${column}) AS ${alias}`,
      format: 'JSONEachRow',
    });
    const [row] = await result.json<{ matched: number }>();
    return row?.matched;
  };

  it('trailing events wildcard (bug 1)', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    const map = "map('items.0', '7', 'other', '9')";

    expect(
      await evaluate({ name: 'properties.items.*', operator: 'gt', value: ['5'] }, map)
    ).toBe(1);
    expect(
      await evaluate({ name: 'properties.items.*', operator: 'gt', value: ['8'] }, map)
    ).toBe(0);
  });

  // The only one of the three the filter picker produces: the router turns
  // `a.0.b.1.c` into `a.*.b.*.c`, which used to match nothing anywhere.
  it('two middle events wildcards (bug 3)', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    const map = "map('a.0.b.1.c', 'x', 'a.0.c', 'y')";
    const filter = (value: string): IChartEventFilter => ({
      name: 'properties.a.*.b.*.c',
      operator: 'is',
      value: [value],
    });

    expect(await evaluate(filter('x'), map)).toBe(1);
    expect(await evaluate(filter('y'), map)).toBe(0);
  });

  it('middle profile wildcard (bug 2)', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    const map = "map('items.0.name', 'x', 'name', 'y')";

    expect(
      await evaluate(
        { name: 'profile.properties.items.*.name', operator: 'is', value: ['x'] },
        map
      )
    ).toBe(1);
    expect(
      await evaluate(
        { name: 'profile.properties.items.*.name', operator: 'is', value: ['y'] },
        map
      )
    ).toBe(0);
  });
});
