# T1 — Backend event analytics list + totals (R1, R5)

Spec: `docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md` §3, §4.
Contract: `packages/validation/src/event-analytics.ts`.

## Scope

Replace the Wave 0 mocks behind `overview.eventAnalyticsList` and
`overview.eventAnalyticsTotals` with real ClickHouse queries.

Files:
- `packages/db/src/services/overview.service.ts`
- `packages/trpc/src/routers/overview.ts`
- `packages/db/src/services/event-analytics-sql.test.ts` (test)

Out of scope: the legacy `overview.eventAnalytics` procedure and
`buildEventAnalyticsQuery` stay untouched — T4 still consumes them.

## Design

A shared private helper builds the filtered base event selection
(`project_id`, `created_at BETWEEN`, chart filters) so the list and the totals
read the exact same rows.

`buildEventAnalyticsListQuery(input)`
- `GROUP BY name`, `count() AS events`, `uniqExact(profile_id) AS users`
- optional `search`: `name ILIKE '%…%'` (escaped through `sqlstring`)
- `ORDER BY <sort> <dir>, name ASC`, where `epu` orders on `events / users`
- `LIMIT limit + 1 OFFSET cursor`; the extra row only decides `nextCursor`

`buildEventAnalyticsTotalsQuery(input)`
- `count() AS events`, `uniqExact(profile_id) AS users` over the same base,
  no `GROUP BY` — deduplicated, never the sum of the branches.

Service methods `getEventAnalyticsList` / `getEventAnalyticsTotals` coerce the
ClickHouse strings to finite numbers (`0` fallback) so a zero-user range can
never reach the UI as `NaN` / `Infinity`, then trim the overflow row and return
`nextCursor`.

Router: both procedures resolve dates like the existing `eventAnalytics`
procedure — `getSettingsForProject` for the timezone, then
`getCurrentAndPrevious(..., false, timezone)` — and drop the mock import usage.

## Steps

1. Test: list SQL shape (group by, order by + tiebreak, limit+1/offset, ILIKE
   search) → verify: red, then green.
2. Test: totals SQL shape (no `GROUP BY name`, `uniqExact`) → red, then green.
3. Test: `nextCursor` paging math and the zero-total guard against a stubbed
   client → red, then green.
4. Wire both procedures in the router → verify: `pnpm typecheck`.
5. ClickHouse-gated `EXPLAIN` for both queries (existing `chReachable`
   pattern) → verify: `pnpm vitest run packages/db/src/services/event-analytics-sql.test.ts`.

## Verification

- `pnpm vitest run packages/db/src/services/event-analytics-sql.test.ts`
- `pnpm codegen && pnpm typecheck`
