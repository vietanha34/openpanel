# T8 — Event analytics ClickHouse fixture + integration test

Spec: `docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md` §4 (contract), §5 T8.
Design sample: `EventAnalyticsScreen.dc.html` `tree` (events → key → value → nested key).

## Scope

New files only, both in `packages/db/src/services/`:

- `event-analytics-fixtures.ts` — deterministic ClickHouse seed + teardown, pattern from
  `test/retention-fixtures.ts` on `main`.
- `event-analytics-integration.test.ts` — ClickHouse-gated assertions on the four
  service methods with hand-computed numbers.

No product code is touched. If an assertion fails, report the numbers; do not fix
`overview.service.ts` in this task.

## Fixture dataset (project `test-event-analytics-t8`, all on 2024-03-04)

14 events, 5 users, users deliberately overlapping between events.

| event | rows | users | per-event users |
|---|---|---|---|
| `level_start` | 8 | u1,u2,u3,u4 | 4 |
| `level_finish` | 3 | u1,u5 | 2 |
| `ads_inter_shown` | 2 | u2,u5 | 2 |
| `booster_use` | 1 | u3 | 1 |

Sum of per-event users = 9, deduplicated total = 5 → the totals assertion has teeth.

`level_start` properties carry `level_id` (num), `level_mode` (str),
`payload.source`, `payload.session_index`, `payload.lives_left` and the 4-segment
`payload.meta.ab.group`, so one event holds several keys under the same `payload`
object.

## Verification steps

1. `pnpm install && pnpm codegen` before any typecheck.
2. Write the fixture, then the test (TDD: test first where possible, fixture is data).
3. `pnpm vitest run packages/db/src/services/event-analytics-integration.test.ts`
   — read both the `Test Files` and `Tests` lines, and report skipped tests.
4. `pnpm typecheck`.
5. Confirm ClickHouse holds no rows for the fixture project after the run.
