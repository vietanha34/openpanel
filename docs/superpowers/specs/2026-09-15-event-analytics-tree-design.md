# Event Analytics Tree — Design & Task Plan

Date: 2026-09-15
Branch/worktree: `feature/event-analytics` at `.worktrees/event-analytics`
Design source: Claude Design project `cde63790-13aa-464a-851a-edf3a279a8e3`, file `EventAnalyticsScreen.dc.html` (imports `ds-bundle.js`, `support.js`)
Requirements: `/Users/vietanha34/Documents/project/AppMetrica/outputs/de-xuat-2026-09-07/01_Pham_vi_Du_an_v1.4.md` §5.2–5.3, `/Users/vietanha34/Documents/project/AppMetrica/01_Phan-tich-va-Yeu-cau_v0.1.md` FR-04

## 1. Goal

AppMetrica-style Events report: chart + table that drills from event → property → value → nested key (up to 4 levels), loading each level lazily and paging large lists. Totals are recomputed on the deduplicated event/user union, never summed from branches.

## 2. Current state (review of commits 6d80d3cd..2d9ec9e2)

Implemented: `Analytics` tab, `buildEventAnalyticsQuery` (events, users, events/user, % users, deduplicated totals via CTE), tRPC `overview.eventAnalytics`, flat table, top-5 line chart, SQL string tests.

| # | Severity | Finding |
|---|---|---|
| R1 | High | Query has no `LIMIT`; every event name is loaded. |
| R2 | High | No tree: property, value, nested key levels are missing. |
| R3 | Medium | Chart plots fixed top 5; design plots rows selected by checkbox (depth ≤ 1) with color swatches. |
| R4 | Medium | `ReportChartShortcut` receives only `range`; custom `startDate/endDate` ignored. |
| R5 | Medium | Totals read from `data[0]`; breaks with paging/sorting. No guard for `total_users = 0`. |
| R6 | Low | `% Users` column duplicates the sub-percent under Users; no `pct` toggle. |
| R7 | Low | Missing metric select, granularity (hour/day/week), line/bar toggle, sortable headers, search, "No events match" state. |
| R8 | Low | Tests only assert SQL substrings; no fixture comparing numbers and totals. |
| R9 | Risk | Properties are `Map(String,String)` flattened by `toDots` (`packages/db/src/services/event.service.ts:386`); original types are lost. |
| R10 | Bug | Numeric property filters use `toFloat64OrZero` (`packages/db/src/services/chart.service.ts:1499` and siblings): missing/non-numeric values count as 0, violating spec §5.2. |

## 3. Decisions

- **Approach A:** one paginated endpoint per tree level, fetched only when a node is expanded. Rejected: single deep-tree endpoint (cardinality explosion), materialized views (defer until measured slow).
- **R9 → PA1 (infer type on read).** When a key is expanded, SQL marks it `num` if every non-empty value parses as a number, else `str`. `num` values sort numerically. No ingestion or migration change. Known ceiling: `"5"` vs `5` are indistinguishable; mixed-type keys may flip type with the date range. Upgrade path (PA2: `property_types` column at ingest) is a separate future plan; the contract below already carries `type` so the UI will not change.
- **R10 is fixed in Phase 1** regardless: use `toFloat64OrNull` plus `mapContains` so missing keys never match numeric comparisons.
- **Nesting:** tree levels are derived by splitting map keys on `.`. A key segment followed by more segments is `kind: 'obj'`. Array indices (`items.0`) are shown as object children. Known ambiguity: a literal key containing `.` is indistinguishable from nesting.
- **Open question for partner:** does any game send the same key as both string and number, and does the acceptance dataset distinguish `"5"` from `5`? If yes, schedule PA2.

## 4. Shared contract (Wave 0 output — all other tasks depend only on this)

Location: `packages/validation/src/event-analytics.ts` (zod inputs + TS types), exported from the package entry that other validation schemas use.

```ts
type Range = { projectId: string; range: IRange; startDate?: string | null; endDate?: string | null; filters: IChartEventFilter[] };
type MetricRow = { events: number; users: number };            // UI derives events/user and % from totals
type SortKey = 'events' | 'users' | 'epu';
type SortDir = 'asc' | 'desc';

// overview.eventAnalyticsList
input:  Range & { search?: string; sort: SortKey; dir: SortDir; cursor?: number; limit?: number /* default 10 */ }
output: { rows: (MetricRow & { name: string })[]; nextCursor: number | null }

// overview.eventAnalyticsTotals
input:  Range
output: MetricRow                                              // deduplicated across all events

// overview.eventPropertyKeys
input:  Range & { event: string; prefix: string /* '' or 'payload.' */; parentPath: { key: string; value: string }[]; cursor?: number; limit?: number /* default 20 */ }
output: { rows: (MetricRow & { key: string; kind: 'key' | 'obj'; type: 'num' | 'str' | 'unknown' })[]; nextCursor: number | null }

// overview.eventPropertyValues
input:  Range & { event: string; key: string; type: 'num' | 'str' | 'unknown'; parentPath: { key: string; value: string }[]; sort: SortKey; dir: SortDir; cursor?: number; limit?: number /* default 5 */ }
output: { rows: (MetricRow & { value: string })[]; remaining: number; nextCursor: number | null }
```

`parentPath` narrows rows to events where each listed key equals its value (drill under a value node, e.g. `level_mode = hard` → nested keys). Depth limit: 4 levels below the event.

Wave 0 also adds router stubs in `packages/trpc/src/routers/overview.ts` returning deterministic mock data matching the design's `tree` sample, so frontend tasks run before backend lands.

## 5. Tasks

### Wave 0 (sequential, small)

**T0 — Contract + router stubs.** Section 4. Done when `pnpm typecheck` passes and stubs return mock data.

### Wave 1 (independent, run in parallel after T0)

| Task | Scope | Files |
|---|---|---|
| T1 | Backend list + totals: paging, sort, search, separate totals query, zero guard (R1, R5) | `packages/db/src/services/overview.service.ts`, `packages/trpc/src/routers/overview.ts`, test file |
| T2 | Backend property keys: lazy keys by prefix, `obj` grouping, PA1 type inference | same service/router, new test |
| T3 | Backend property values: values under key + `parentPath`, numeric sort for `num`, `remaining` | same service/router, new test |
| T4 | Frontend tree table + toolbar: lazy expand, load-more rows, icons/badges, sort headers, search, `pct` toggle, empty state, totals row + dedup note (R2, R6, R7 table part) | `apps/start/src/components/event-analytics/*`, route file |
| T5 | Frontend chart panel: metric select, granularity, line/bar, series from selected rows, custom dates (R3, R4, R7 chart part) | `apps/start/src/components/event-analytics/chart.tsx`, route file (mount only) |
| T6 | R10 numeric filter fix | `packages/db/src/services/chart.service.ts` + test |
| T7 | Advanced filters AND/OR, max 2 nesting levels (separate plan — largest item) | `packages/validation`, filter SQL builder, filter UI |

Conflict notes: T1–T3 all edit `overview.service.ts` and `overview.ts`. Each adds its own function/procedure in a separate block; rebase before merge. T4 and T5 share only the route file; T5 adds one mount line.

### Wave 2 (after Wave 1)

**T8 — Fixture + integration test.** Seed ClickHouse with a small dataset shaped like the design sample; assert list, totals, keys, values at 4 levels match hand-computed numbers; assert totals ≠ sum of branches when users overlap (R8).

**T9 — Visual verification.** Compare running dashboard with `render_preview` of the design; fix spacing/labels; check narrow width.

## 6. Error handling

- Empty range or `total_users = 0`: UI shows `0` / `—`, never `NaN`/`Infinity`.
- Node query failure: error text inline on that node with retry; the rest of the tree stays usable.
- Depth > 4: chevron hidden.

## 7. Testing

- Backend: SQL build tests plus ClickHouse-gated execution tests (existing `chReachable` pattern in `event-analytics-sql.test.ts`).
- Frontend: component test for row flattening/expand/load-more against stub data where the app has a test setup; otherwise manual verification in T9.
- Commands: `pnpm vitest run <path>`, `pnpm typecheck`. Never run `pnpm format` (project rule).

## 8. Sub-agent prompts

Common preamble for every prompt:

> Work in `/Users/vietanha34/Documents/workspace/personal-projects/openpanel/.worktrees/event-analytics` (branch `feature/event-analytics`). Read `docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md` first; sections 3 and 4 are binding. Design: Claude Design project `cde63790-13aa-464a-851a-edf3a279a8e3`, file `EventAnalyticsScreen.dc.html` (read with the claude_design MCP). Use `superpowers:test-driven-development`. Follow `.claude/CLAUDE.md`; NEVER run format. Verify with `pnpm vitest run <your test>` and `pnpm typecheck` before reporting. Commit only your task's files with a conventional commit message. Report: files changed, test output, any contract deviation (do not deviate silently — stop and report).

**T0:**
> Implement section 4 exactly: zod inputs and types in `packages/validation/src/event-analytics.ts`, exported like sibling schemas; four tRPC procedures in `packages/trpc/src/routers/overview.ts` using `overviewProcedure` returning deterministic mock data built from the design file's `tree` sample (respect cursor/limit so paging is testable). Keep existing `overview.eventAnalytics` untouched for now.

**T1:**
> Replace the mock for `eventAnalyticsList` and `eventAnalyticsTotals`. Refactor `buildEventAnalyticsQuery` in `packages/db/src/services/overview.service.ts`: list query with `ORDER BY <sort> <dir>, name`, `LIMIT limit + 1 OFFSET cursor` to compute `nextCursor`, optional `name ILIKE` search; totals query `count()` / `uniqExact(profile_id)` over the same filtered base. Resolve range dates the same way the existing procedure does (`getSettingsForProject`, `getCurrentAndPrevious`). Remove the old `eventAnalytics` procedure once the route no longer uses it (coordinate: leave it if T4 hasn't merged). Tests: SQL shape + ClickHouse-gated execution.

**T2:**
> Replace the mock for `eventPropertyKeys`. Query: from filtered events where `name = event` and every `parentPath` pair matches `properties[key] = value`, `arrayJoin(mapKeys(properties)) AS k` filtered by `startsWith(k, prefix)`; segment = part of `k` after `prefix` up to the next `.`; `kind = 'obj'` when any `k` has more segments after it. Metrics per segment: `count()` (events carrying that key; for obj, events carrying any key under it — count each event once) and `uniqExact(profile_id)`. Type (PA1): for `kind='key'`, `num` when `countIf(toFloat64OrNull(properties[k]) IS NULL) = 0`, else `str`; `obj` → `unknown`. Paginate by events desc. Reject depth > 4. Tests cover nested prefix, obj detection, type inference on mixed values.

**T3:**
> Replace the mock for `eventPropertyValues`. Group `properties[key]` for events matching `event` + `parentPath` + `mapContains(properties, key)`; metrics `count()`, `uniqExact(profile_id)`. Sort by requested metric; when sorting by value for `type='num'` use `toFloat64OrNull`. Return `remaining = totalDistinct - (cursor + rows.length)`. Tests: paging math, parentPath narrowing, numeric vs string ordering.

**T4:**
> Build the tree table in `apps/start/src/components/event-analytics/` and mount it in `apps/start/src/routes/_app.$organizationId.$projectId.events._tabs.analytics.tsx`, replacing the flat table. Match the design's `flatten()` behaviour: path keys `/event/key/value…`, indent 22px per depth, icons E/K/{}/V/·, badge (category not available → omit for events; `num`/`str`/`object` for keys), checkbox only depth ≤ 1 (expose selected paths + colors via props/state for T5), chevron only when node can have children. Each expanded node uses `useInfiniteQuery` with `enabled: expanded`; "Load 10 more events" at root, "Load more" under paged value lists showing `remaining`. Totals row from `eventAnalyticsTotals` with the DEDUPLICATED badge and overlap note. Sortable headers (events/users/epu), search input (debounced) → list input, `pct` toggle for sub-percentages, "No events match" empty state. Use existing UI primitives (`@/components/ui/*`); no new dependencies. Works against T0 stubs.

**T5:**
> Build the chart panel in `apps/start/src/components/event-analytics/chart.tsx` using existing report chart components. Controls: metric (events/users/events per user), granularity (hour/day/week → existing interval option), line/bar. Series come from selected paths (depth ≤ 1): event → event series; event/key → event series broken down by that property. Pass `startDate`/`endDate` along with `range` (R4). Empty selection shows "Select rows in the table to plot them". Coordinate selection state shape with T4: `{ path: string; color: string }[]` lifted to the route component.

**T6:**
> In `packages/db/src/services/chart.service.ts`, replace every `toFloat64OrZero` used in property comparison filters (gt/lt/gte/lte and siblings around line 1499) with `toFloat64OrNull` so missing or non-numeric values never match; for map-backed property keys add `mapContains` where the key may be absent. Add tests proving a missing key does not satisfy `< 1` and a non-numeric value does not satisfy `> -1`. Check other call sites with grep and report them.

**T7 (write its own spec first):**
> Use `superpowers:brainstorming` to design advanced filters matching the design's "Advanced filters" panel: groups with AND/OR, max 2 nesting levels, "has / missing property", applies to chart and table. Existing filters are flat (`IChartEventFilter[]`). Produce a spec + plan; do not implement until approved.

**T8:**
> After Wave 1 merges: create a ClickHouse fixture (pattern: `test/retention-fixtures.ts` on main) shaped like the design sample, including overlapping users across events and a 4-level nested payload. Integration tests assert list, totals, keys, values and that totals users < sum of event users.

**T9:**
> Run the dashboard (`pnpm dev`), open the Events › Analytics tab, and compare against `render_preview` of `EventAnalyticsScreen.dc.html`. Fix visual gaps within `apps/start/src/components/event-analytics/`. Verify at ~400px width. Report screenshots.
