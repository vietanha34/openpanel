# T6 — Fix numeric property filters (R10)

## Problem

`packages/db/src/services/chart.service.ts` builds `gt` / `lt` / `gte` / `lte`
property filters with `toFloat64OrZero`. ClickHouse `Map` access returns the
type default (`''`) for an absent key, and `toFloat64OrZero('')` is `0`.
Result: an event that never set `properties.age` satisfies `age < 1`, and an
event with `properties.age = 'abc'` satisfies `age > -1`. Spec §5.2 requires a
missing or non-numeric value to never match a numeric comparison.

## Fix

Replace `toFloat64OrZero` with `toFloat64OrNull` in the four comparison
operators (both the wildcard `arrayExists` branch and the scalar branch).
`toFloat64OrNull` yields `NULL` for `''` and for non-numeric text, and every
comparison against `NULL` is `NULL`, which ClickHouse's `WHERE` treats as not
matching.

Additionally, for the events `properties` map, guard the scalar branch with
`mapContains(properties, '<key>')` so an absent key is rejected explicitly.

### Constraint on `mapContains`

`profile.properties['<key>']` must NOT get a `mapContains` guard.
`rewriteProfilePropertyRefs` narrows those refs to scalar CTE columns and the
CTE then drops the full `profile.properties` map; a `mapContains(profile.properties, ...)`
reference would survive the rewrite untouched and reference a dropped column.
Guard only `properties[...]` / `<alias>.properties[...]`.

## Steps

1. Test (red): `packages/db/src/services/numeric-filter-sql.test.ts` — pure
   string assertions on `getChartSql`, no ClickHouse needed.
   - missing key does not satisfy `< 1` → SQL uses `toFloat64OrNull`, not
     `toFloat64OrZero`, and carries `mapContains`.
   - non-numeric value does not satisfy `> -1` → same.
   - wildcard (`properties.a.*`) branch uses `toFloat64OrNull`.
   - `profile.properties.age` gets no `mapContains`.
   - verify: `pnpm vitest run packages/db/src/services/numeric-filter-sql.test.ts`
2. Implement (green): edit the four operator cases in `chart.service.ts`.
   - verify: same command passes.
3. Update the one stale assertion in `chart-sql.test.ts:288`
   (`expect(sql).toContain('toFloat64OrZero')`) to `toFloat64OrNull`.
   - verify: `pnpm vitest run packages/db/src/services/chart-sql.test.ts`
4. `pnpm typecheck`.

## Out of scope

Grep found no `toFloat64OrZero` call sites outside `chart.service.ts` (plus the
spec doc and the one test assertion above). Nothing else to change.
