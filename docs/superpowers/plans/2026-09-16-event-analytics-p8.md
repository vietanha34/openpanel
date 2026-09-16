# P8 — Integration test for the 11 metrics

Spec: `docs/superpowers/specs/2026-09-16-event-analytics-phase2-design.md` §5 (SQL),
§3 D4 (missing parameter is 0 in a metric, nothing in a filter), §8 prompt P8.

## Scope

Extend the two T8 files, no product code:

- `packages/db/src/services/event-analytics-fixtures.ts`
- `packages/db/src/services/event-analytics-integration.test.ts`

## Fixture changes (additive, T8 numbers stay valid)

The 14 events and 5 users stay exactly as they are, so every T8 assertion keeps
holding. Two additions:

- `app_version` (`'1.2.3'`, never parses as a number) on the `ads_inter_shown`
  and `booster_use` rows only — the two events whose property keys T8 does not
  pin. One `ads_inter_shown` row deliberately omits it.
- A `profiles` table seed (`plan = pro` for u1 and u2, `free` for the rest) so
  the P2 profile-filter subselect can be exercised together with metrics.

The missing-parameter cases need no new rows: `payload.lives_left` already sits
on 4 of the 8 `level_start` events, which is exactly the D4 scenario.

## Hand-computed metric blueprint

`level_start`, parameter `payload.lives_left`. Coalesced values across the 8
events: `[5, 0, 3, 0, 5, 0, 5, 0]`.

| metric | value | why |
|---|---|---|
| `events` / `users` | 8 / 4 | unchanged from T8 |
| `sum_param` | 18 | 5+3+5+5 |
| `avg_param` | 2.25 | 18/8, not 18/4 — the four missing events are real zeros |
| `median_param` | 3 | `quantileExact(0.5)` over `[0,0,0,0,3,5,5,5]` |
| `uniq_param` | 3 | `{0, 3, 5}` — the missing events contribute the `0` |
| `sum_param_user` | 4.5 | 18/4 |
| `uniq_param_user` | 0.75 | 3/4 |
| `epu` vs `epau` | 2 vs 1.6 | 8/4 (node users) vs 8/5 (all tracked users) |

Under `level_mode = hard` no row is missing the parameter, so `uniq_param` drops
to 2 while the event-level value is 3 — the sharpest evidence for D4.

Non-numeric parameters (`level_mode` on `level_start`, `app_version` on
`ads_inter_shown`) collapse every value to 0: `sum` 0, `avg` 0, `median` 0,
`uniq_param` 1.

Sorting is driven end-to-end by `sum_param:level_id`: `level_start` has 48
(10+2+2+10+9+10+2+3) and every other event has 0, which is a different order
from the default `events desc`.

## Verification steps

1. `pnpm install && pnpm codegen`.
2. `pnpm vitest run packages/db/src/services/event-analytics-integration.test.ts`
   — read both the `Test Files` and the `Tests` line, report skips. Use
   `rtk proxy` if the wrapper hides a failing line.
3. `pnpm -F @openpanel/db typecheck`.
4. Time `median_param` on the fixture and report the number (§5 escape hatch).
5. Confirm ClickHouse holds no fixture rows in `events` or `profiles` afterwards.
