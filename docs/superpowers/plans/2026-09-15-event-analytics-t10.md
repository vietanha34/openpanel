# T10 — Event analytics must honour property filters

## Problem

All four event analytics query builders filter through
`OverviewService.getRawWhereClause('events', filters)`. That function starts by
dropping every filter whose name is not in `WHITELISTED_FILTERS` — 21 fixed
columns, with no `properties.*` and no `profile.*`. A property filter set on the
toolbar is therefore discarded silently: the table shows unfiltered data with no
error and no warning.

## Approach

Add a new `getEventAnalyticsWhereClause(filters, projectId?)` helper next to
`getRawWhereClause` and route the event analytics builders through it.
`getRawWhereClause` itself is left untouched so the overview widgets
(`getTopPages`, `getTopSources`, sessions metrics, …) keep their exact behaviour.

The new helper:

- calls `getEventFiltersWhereClause(..., tableScope: 'events')` with no
  whitelist pre-pass, so `properties.*` filters reach the SQL;
- keeps the UTM remap (`utm_source` → `properties.__query.utm_source`) — the
  events table has no top-level `utm_*` columns;
- drops `profile.properties.*`, which would emit `profile.properties['k']`
  against a query that has no profile join (invalid SQL, not a wrong number);
- returns a joined string, same shape as `getRawWhereClause`, so call sites do
  not change shape.

Bare unknown columns (`profile.email`, `group.*`, unknown names) are already
dropped inside `getEventFiltersWhereClause` by the `EVENT_TOP_LEVEL_COLUMNS`
guard, so no extra whitelist is needed.

Call sites to change (two — the property key/value builders inherit from the
base query):

1. `buildEventAnalyticsQuery`
2. `buildEventAnalyticsBaseQuery` (feeds `buildEventPropertyKeysQuery` and
   `buildEventPropertyValuesQuery`)

## Verification

New test file `event-analytics-filters.test.ts`:

- `properties.level_mode = 'hard'` appears in the SQL of all four builders
  (regression test for the silent drop);
- `utm_source` still emits `properties['__query.utm_source']` and never a bare
  `utm_source` column;
- `profile.properties.*` is dropped rather than emitted;
- every generated SQL `EXPLAIN`s on ClickHouse when reachable.

Plus: existing T1/T2/T3 suites and `chart-sql.test.ts` stay green;
`@openpanel/db` and `@openpanel/trpc` typecheck clean.
