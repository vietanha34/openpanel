# T9 — Integration test across several periods

Spec: `docs/superpowers/specs/2026-09-18-event-analytics-phase3-design.md` §6 (prompt T9),
§4 (contract), §3 D1/D2, invariant I10.

## Scope

- `packages/db/src/services/event-analytics-fixtures.ts` — additive: new events on the
  two days BEFORE the existing range, so every T8/P8 number stays valid.
- `packages/db/src/services/event-analytics-periods.test.ts` — new file beside the P8
  suite, which stays untouched.

No product code.

## Fixture additions

Period A is the existing day `2024-03-04`. B is `2024-03-03`, C is `2024-03-02` —
one day each, so invariant I10 holds.

| event | A | B | C |
|---|---|---|---|
| `level_start` | 8 events / 4 users (u1,u2,u3,u4) | 4 / 3 (u1,u2,u5) | 1 / 1 (u4) |
| `level_finish` | 3 / 2 | — | — |
| `ads_inter_shown` | 2 / 2 | — | — |
| `booster_use` | 1 / 1 | — | — |
| `tutorial_step` | — | 1 / 1 (u3) | — |

u1, u2 and u4 fire in more than one period, and u5 fires `level_start` only in B
although it exists in A under other events.

## What the test pins

1. **Users never add across periods.** `level_start`: A has 4 users, B has 3, sum 7 —
   while one query over the union of both days reports 5. Same at the totals level:
   5 + 4 = 9 against a union of 5. This is invariant I2 on the time axis.
2. **Hand-computed numbers per period** for `events`, `users`, `epu`, and both
   `sum_param` / `avg_param` over `level_id` and `payload.lives_left`, read from
   `row.periods[k]` and `totals.periods[k]`. `avg_param` keeps the Phase 2 D4 rule:
   an event missing the parameter is a real zero in the denominator.
3. **Row set follows period A.** `level_finish` exists only in A, so `periods[1]` and
   `periods[2]` are all zeros — the row still appears. `tutorial_step` exists only in
   B, so per §3 D1 ("server chọn dòng theo period A") it must NOT add a row.
4. **Top-level fields repeat period A**, per §4.

`deltaPercent` is client-side and already has its own test; this suite only pins the
raw numbers it divides.

## Verification

1. `pnpm install && pnpm codegen`.
2. `pnpm vitest run packages/db/src/services/event-analytics-periods.test.ts`, then every
   `event-analytics*` suite in `packages/db`. Read `Test Files` and `Tests`, report skips.
3. `pnpm -F @openpanel/db typecheck`.
4. Fixture rows gone from `events` and `profiles` afterwards.

Raise this file's `hookTimeout` the way the P8 suite does; the local ClickHouse times the
default 10s hook out under a parallel run.
