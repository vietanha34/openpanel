# T2 — Backend property keys (`overview.eventPropertyKeys`)

Spec: `docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md` §3, §4.

## Goal

Replace the Wave 0 mock for `eventPropertyKeys` with a real ClickHouse query.

## Query shape

`buildEventPropertyKeysQuery({ projectId, filters, startDate, endDate, timezone, event, prefix, parentPath, cursor, limit })`

```
WITH base_events AS (
  SELECT profile_id, properties FROM events
  WHERE project_id = ? AND created_at BETWEEN ? AND ?
    AND name = ?                                  -- event
    AND properties['<k>'] = '<v>'                 -- one per parentPath pair
    <filters raw where>
),
matched_keys AS (
  SELECT profile_id, properties,
         arrayFilter(k -> startsWith(k, P), mapKeys(properties)) AS matched
  FROM base_events
),
segments AS (
  SELECT profile_id, properties, matched,
         arrayJoin(arrayDistinct(arrayMap(
           k -> splitByChar('.', substring(k, length(P) + 1))[1], matched))) AS segment
  FROM matched_keys
)
SELECT segment AS key,
       count() AS events,                          -- one row per (event, segment) => counted once
       uniqExact(profile_id) AS users,
       max(arrayExists(k -> startsWith(k, concat(P, segment, '.')), matched)) AS has_nested,
       countIf(toFloat64OrNull(properties[concat(P, segment)]) IS NULL) AS non_numeric
FROM segments
GROUP BY segment
ORDER BY events DESC, key ASC
LIMIT limit + 1 OFFSET cursor
```

`arrayDistinct` is what makes an event carrying several keys under one `obj` count once.

Mapping to the contract row:
- `kind = has_nested ? 'obj' : 'key'`
- `type = has_nested ? 'unknown' : (non_numeric === 0 ? 'num' : 'str')` (PA1)
- `nextCursor = rows.length > limit ? cursor + limit : null`

## Depth

Reject when `parentPath.length > EVENT_ANALYTICS_MAX_PARENT_PATH` or when the requested
level `parentPath.length * 2 + 1 > EVENT_ANALYTICS_MAX_DEPTH`. Constants only, no literals.

## Steps

1. RED: `packages/db/src/services/event-property-keys-sql.test.ts` — SQL shape (nested prefix,
   dedup via `arrayDistinct`, `toFloat64OrNull` type probe, paging), depth rejection, and the
   row-mapping helper (obj detection, mixed values => `str`, one event with several keys under
   the same obj counted once). ClickHouse-gated `EXPLAIN` like `event-analytics-sql.test.ts`.
2. GREEN: add `buildEventPropertyKeysQuery` + `OverviewService.getEventPropertyKeys` in
   `packages/db/src/services/overview.service.ts`; wire the procedure in
   `packages/trpc/src/routers/overview.ts` (drop only the `eventPropertyKeys` mock import).
3. Verify: `pnpm vitest run <test>`, `pnpm typecheck`.
