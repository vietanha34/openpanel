# B5 — Fix wildcard property keys at the root, remove the B1 guard

Decision: orchestrator approved fixing both bugs in `transformPropertyKey`
(`packages/db/src/services/chart.service.ts`), including the events branch.

## Reproduction (getChartSql + EXPLAIN on ClickHouse)

| key form | events `properties.` | profile `profile.properties.` |
|---|---|---|
| `a.*.b` (middle) | OK | valid SQL, **never matches**: pattern keeps the `profile.properties.` prefix |
| `a[*]` | OK | valid SQL, **never matches** (same) |
| `a.*` (trailing) | **crash** on `is`/`gt`; `hasProperty` never matches (`*` is literal in LIKE) | same crash + prefix bug |

Root cause, both in `transformPropertyKey`'s wildcard branch:
1. Only `.*.` and `[*]` become `%`; a trailing `.*` is left as a literal `*`,
   so the key is not recognised as a wildcard (`includes('%')`) and an Array
   is compared to a scalar.
2. Only `^properties.` is stripped, so a profile pattern starts with
   `profile.properties.` and matches no key of the profile map.

Not affected: the §5.4 CTE trap — `collectProfilePropertyKeys` already sets
`needsFullMap` for every profile ref containing `*`.

## Fix

- Strip the matched prefix (`properties` or `profile.properties`) by length,
  not by regex, so `properties.profile_type.*` stays `profile_type.%`.
- Also turn a trailing `.*` into `.%`. Comment the three forms at the function.
- Non-wildcard keys never reach this branch: byte-identical.

## Tests

- New `wildcard-property-key.test.ts`: `transformPropertyKey` per form; matrix
  (events, profile) x (`is`, `gt`, `hasProperty`) x (middle, trailing, `[*]`)
  through `getChartSql` with EXPLAIN; a profile wildcard breakdown; a real
  ClickHouse evaluation that each compiled clause matches the intended map.
- `event-analytics-filters.test.ts`: the B1 drop pin becomes "wildcard profile
  filter compiles and runs"; real fixture data for a trailing events wildcard
  and a middle profile wildcard.
- Unchanged and green: `filter-where`, `chart-sql`, `numeric-filter-sql`,
  `event-analytics-filters` (except the B1 pin), `event-analytics-group-sql`.
