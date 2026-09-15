# T3 — Backend property values (eventPropertyValues)

Date: 2026-09-15
Spec: `docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md` §3, §4 (binding)
Contract: `packages/validation/src/event-analytics.ts`

## Goal

Replace the Wave 0 mock behind `overview.eventPropertyValues` with a real
ClickHouse query: distinct values of one property key under one event,
optionally narrowed by a `parentPath` pair, with `events` / `users` metrics,
paging and a `remaining` counter.

## Files

- `packages/db/src/services/overview.service.ts` — new `buildEventPropertyValuesQuery` + `OverviewService.getEventPropertyValues`
- `packages/trpc/src/routers/overview.ts` — wire the procedure to the service
- `packages/db/src/services/event-property-values-sql.test.ts` — new test file

## Query shape

Base: `TABLE_NAMES.events` filtered by `project_id`, `created_at BETWEEN`,
`getRawWhereClause('events', filters)`, `name = event`,
`mapContains(properties, key)` and one `properties[pk] = pv` per `parentPath`
entry (`EVENT_ANALYTICS_MAX_PARENT_PATH = 1`, so at most one).

```
SELECT properties['<key>'] AS value, count() AS events,
       uniqExact(profile_id) AS users, total_distinct
FROM base_values CROSS JOIN value_totals
GROUP BY value
ORDER BY <metric> <dir>, <value expr> ASC
LIMIT limit + 1 OFFSET cursor
```

- `<metric>`: `events` | `users` | `events / users` (epu).
- `<value expr>`: `toFloat64OrNull(value)` when `type = 'num'`, else `value`.
  This is the tie-breaker, so numeric keys order 2 < 10 instead of "10" < "2".
- `total_distinct = uniq(properties['<key>'])` over the same filtered base,
  cross joined so one round trip serves both rows and `remaining`.

## Paging (must stay self-consistent)

Fetch `limit + 1`. `hasMore = fetched.length > limit`, `rows = fetched.slice(0, limit)`.

- `hasMore === false` -> `nextCursor = null`, `remaining = 0`.
- `hasMore === true`  -> `nextCursor = cursor + rows.length`,
  `remaining = max(1, total_distinct - (cursor + rows.length))`.

Deriving both from the same `hasMore` flag is what keeps "Load more" working:
`remaining > 0` can never come back with a `null` cursor.

## Steps

1. Red: test asserting the SQL shape (metrics, `mapContains`, parentPath
   narrowing, numeric vs string tie-break, limit/offset). -> verify: test fails.
2. Green: implement `buildEventPropertyValuesQuery`. -> verify: test passes.
3. Red: test for the paging math on the service (`remaining` / `nextCursor`
   consistency) against a stubbed query result. -> verify: fails.
4. Green: implement `getEventPropertyValues`. -> verify: passes.
5. Wire the tRPC procedure (timezone via `getSettingsForProject`, dates via
   `getCurrentAndPrevious`, same as the existing `eventAnalytics` procedure).
   -> verify: `pnpm typecheck`.

## Out of scope

`eventAnalyticsList`, `eventAnalyticsTotals` (T1), `eventPropertyKeys` (T2).
The mock module stays until those land.

## Known contract note

`SortKey` is `events | users | epu` only — there is no `value` sort in the
contract, so the spec's "sort by value" is implemented as the deterministic
tie-breaker described above rather than a new sort key.
