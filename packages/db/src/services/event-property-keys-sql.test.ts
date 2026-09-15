import {
  EVENT_ANALYTICS_MAX_DEPTH,
  EVENT_ANALYTICS_MAX_PARENT_PATH,
} from '@openpanel/validation';
import sqlstring from 'sqlstring';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ch } from '../clickhouse/client';
import {
  buildEventPropertyKeysQuery,
  overviewService,
  toEventPropertyKeyRows,
} from './overview.service';

const base = {
  projectId: 'test-event-property-keys',
  filters: [],
  startDate: '2026-09-01 00:00:00',
  endDate: '2026-09-02 00:00:00',
  timezone: 'UTC',
  event: 'level_finish',
  prefix: '',
  parentPath: [],
  limit: 20,
};

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

afterAll(() => vi.restoreAllMocks());

describe('buildEventPropertyKeysQuery', () => {
  it('splits map keys into one segment per event, counting an event once per segment', () => {
    const sql = buildEventPropertyKeysQuery(base).toSQL();

    // arrayDistinct is what makes an event carrying several keys under the
    // same object contribute a single row for that object.
    expect(sql).toContain('arrayJoin(arrayDistinct(arrayMap(');
    expect(sql).toContain("splitByChar('.', substring(");
    expect(sql).toContain('count() AS events');
    expect(sql).toContain('uniqExact(profile_id) AS users');
    expect(sql).toContain('GROUP BY segment');
  });

  it('narrows to the event and to every parentPath pair', () => {
    const sql = buildEventPropertyKeysQuery({
      ...base,
      parentPath: [{ key: 'level_mode', value: "ha'rd" }],
    }).toSQL();

    expect(sql).toContain("name = 'level_finish'");
    expect(sql).toContain("properties['level_mode'] = 'ha\\'rd'");
  });

  it('filters by a nested prefix and strips it from the segment', () => {
    const sql = buildEventPropertyKeysQuery({
      ...base,
      prefix: 'payload.',
    }).toSQL();

    expect(sql).toContain("startsWith(k, 'payload.')");
    expect(sql).toContain("length('payload.') + 1");
  });

  it('probes nesting and numeric-ness per segment', () => {
    const sql = buildEventPropertyKeysQuery(base).toSQL();

    expect(sql).toContain('has_nested');
    expect(sql).toContain('non_numeric');
    expect(sql).toContain('toFloat64OrNull');
  });

  it('pages by events desc, fetching one extra row to detect the next cursor', () => {
    const sql = buildEventPropertyKeysQuery({
      ...base,
      limit: 20,
      cursor: 40,
    }).toSQL();

    expect(sql).toContain('ORDER BY events DESC');
    expect(sql).toContain('LIMIT 21');
    expect(sql).toContain('OFFSET 40');
  });

  it('rejects a parentPath deeper than the tree allows', () => {
    const parentPath = Array.from(
      { length: EVENT_ANALYTICS_MAX_PARENT_PATH + 1 },
      (_, i) => ({ key: `k${i}`, value: `v${i}` })
    );

    expect(() => buildEventPropertyKeysQuery({ ...base, parentPath })).toThrow(
      new RegExp(String(EVENT_ANALYTICS_MAX_DEPTH))
    );
  });

  it('parses in ClickHouse when available', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');
    await ch.command({
      query: `EXPLAIN ${buildEventPropertyKeysQuery({ ...base, prefix: 'payload.', parentPath: [{ key: 'level_mode', value: 'hard' }] }).toSQL()}`,
    });
  });
});

describe('toEventPropertyKeyRows', () => {
  const row = (over: Record<string, unknown>) => ({
    key: 'k',
    events: '3',
    users: '2',
    has_nested: 0,
    non_numeric: '0',
    ...over,
  });

  it('marks a segment with deeper keys as an object of unknown type', () => {
    const { rows } = toEventPropertyKeyRows(
      [row({ key: 'payload', has_nested: 1, non_numeric: '3' })],
      { cursor: 0, limit: 20 }
    );

    expect(rows).toEqual([
      { key: 'payload', events: 3, users: 2, kind: 'obj', type: 'unknown' },
    ]);
  });

  it('infers num only when every value parses as a number', () => {
    const { rows } = toEventPropertyKeyRows(
      [
        row({ key: 'score', non_numeric: '0' }),
        row({ key: 'level', non_numeric: '1' }),
      ],
      { cursor: 0, limit: 20 }
    );

    expect(rows.map((r) => [r.key, r.kind, r.type])).toEqual([
      ['score', 'key', 'num'],
      ['level', 'key', 'str'],
    ]);
  });

  it('drops the probe row and returns the next cursor', () => {
    const { rows, nextCursor } = toEventPropertyKeyRows(
      [row({ key: 'a' }), row({ key: 'b' }), row({ key: 'c' })],
      { cursor: 10, limit: 2 }
    );

    expect(rows.map((r) => r.key)).toEqual(['a', 'b']);
    expect(nextCursor).toBe(12);
  });

  it('has no next cursor on the last page', () => {
    const { nextCursor } = toEventPropertyKeyRows([row({ key: 'a' })], {
      cursor: 0,
      limit: 2,
    });

    expect(nextCursor).toBeNull();
  });
});

// Numbers, not SQL shape: the dedup and type rules only hold end to end.
describe('getEventPropertyKeys against ClickHouse', () => {
  const projectId = 'test-event-property-keys-exec';
  const fixture = [
    // One event carrying three keys under `payload` -- it must count once.
    { profile_id: 'u1', properties: { 'payload.a': '1', 'payload.b': '2', score: '10' } },
    { profile_id: 'u2', properties: { 'payload.a': '3', score: '20' } },
    // `score` also arrives as text, which flips its inferred type to `str`.
    { profile_id: 'u2', properties: { score: 'ten' } },
  ];

  beforeAll(async () => {
    if (!chReachable) return;
    await ch.insert({
      table: 'events',
      format: 'JSONEachRow',
      values: fixture.map((row, i) => ({
        id: `00000000-0000-4000-8000-00000000000${i}`,
        name: 'level_finish',
        project_id: projectId,
        profile_id: row.profile_id,
        properties: row.properties,
        created_at: '2026-09-01 12:00:00.000',
      })),
    });
  });

  afterAll(async () => {
    if (!chReachable) return;
    await ch.command({
      query: `ALTER TABLE events DELETE WHERE project_id = ${sqlstring.escape(projectId)}`,
      // Wait for the mutation so a rerun never sees the previous fixture.
      clickhouse_settings: { mutations_sync: 2 },
    });
  });

  it('counts an event once per object and infers the type from every value', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventPropertyKeys({
      ...base,
      projectId,
    });

    expect(rows).toEqual([
      // 3 events carry `score`, 2 carry something under `payload`.
      { key: 'score', events: 3, users: 2, kind: 'key', type: 'str' },
      { key: 'payload', events: 2, users: 2, kind: 'obj', type: 'unknown' },
    ]);
  });

  it('lists the keys inside an object and types them on their own values', async (ctx) => {
    if (!chReachable) ctx.skip('ClickHouse not reachable at CLICKHOUSE_URL');

    const { rows } = await overviewService.getEventPropertyKeys({
      ...base,
      projectId,
      prefix: 'payload.',
    });

    expect(rows).toEqual([
      { key: 'a', events: 2, users: 2, kind: 'key', type: 'num' },
      { key: 'b', events: 1, users: 1, kind: 'key', type: 'num' },
    ]);
  });
});
