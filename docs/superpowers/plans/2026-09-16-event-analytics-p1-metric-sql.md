# Event Analytics P1 — Metric SQL

Spec: `docs/superpowers/specs/2026-09-16-event-analytics-phase2-design.md` §3 D4, §4, §5, §8 P1.

Files: `packages/db/src/services/overview.service.ts`,
`packages/db/src/services/event-analytics-metrics-sql.test.ts` (new).

## Steps

1. **Byte-identical guard (test first).** Snapshot the SQL of the four builders
   (list, totals, property keys, property values) with `metrics` absent, as
   literal strings captured from the base branch. Must pass before and after.
2. **Metric expressions.** `eventAnalyticsMetricExpression(metric)` returns the
   §5 aggregate for the five parameter metrics plus `uniq_param_user` /
   `sum_param_user`, and `null` for `events`, `users`, `epu`, `pctu`, `epau`
   (already selected, or derived in the renderer). Parameter keys go through
   `sqlstring.escape`. Tests: each expression, `epau` emits nothing, no bare
   `toFloat64OrZero`, filter SQL gained no `coalesce`.
3. **SELECT + output.** The four builders append the expressions under
   positional aliases (`metric_0`, …) — a metric key such as `sum_param:day`
   is not a safe identifier. The service methods map them back to
   `metrics[metricKey]` via `toFiniteCount` (guards the totals row's division
   by zero users on an empty range). `metrics` is present iff requested.
4. **Sort.** Replace `EVENT_ANALYTICS_SORT_COLUMN` + `eventAnalyticsSortColumn`
   with a function mapping a metric key to its SQL: `pctu` -> `users`,
   `epau` -> `events` (constant denominators), parameter metrics -> their alias.
5. **D4 semantics against ClickHouse** (gated on reachability, like the
   existing `parses in ClickHouse` tests): run the expressions over a
   `values(...)` table with one event missing the parameter; assert `avg_param`
   is pulled down and `uniq_param` / `uniq_param_user` count the `0`.
6. Verify: `pnpm vitest run packages/db/src/services/event-analytics-*`,
   `pnpm -F @openpanel/db typecheck`, `pnpm -F @openpanel/trpc typecheck`.
