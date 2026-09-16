# Event Analytics Phase 2 — Design & Task Plan

Date: 2026-09-16
Base: `feature/event-analytics` @ `9f0dcf5b` (Phase 1 + T9/T11 merged)
Design source: Claude Design project `233791a0-310f-443c-8118-b345c9f77b7d`
- `Event Analytics Metrics.dc.html` (5,109 bytes) — canvas index, states `2a` column picker, `2b` parameter step, `2c` applied parameter columns, `2d` chart collapsed. Read in full.
- `EventAnalyticsScreen.dc.html` (76,646 bytes, 1,095 lines) — the component. New props `metricsStage: 'closed' | 'picker' | 'parameter'`, `paramColumns: boolean`, `chartCollapsed: boolean`. Read: props block, `metricDefs` / `metricGroups` / `paramList`, the metrics modal markup, the chart head and collapse pill, the tree row markup and `flatten()`.
- Not read in full: the chart SVG plotting block and the left navigation, neither of which this spec touches.

Predecessor: `docs/superpowers/specs/2026-09-15-event-analytics-advanced-filters-design.md` (Phase 1). Its §5.4 rule is binding here.

> Spec only. No implementation until approved.

## 1. Goal

Five user requirements, R1–R5:

- **R1** — the chart is never empty on first visit, and can be collapsed.
- **R2** — Event Analytics can filter on user (profile) properties, which it silently drops today.
- **R3** — verify the tree table against the *current* design rather than re-applying a fix that already shipped.
- **R4** — a Metrics dialog that chooses which metric columns the table shows, including metrics computed over an event parameter.
- **R5** — the user's choices survive a reload, per project.

R4 is by far the largest and is the only one that changes the shared contract.

## 2. Current state

| Area | Today | Source |
|---|---|---|
| Metrics | Fixed four columns: `EVENTS`, `USERS`, `EVENTS PER USER`, `% OF ALL USERS` | `event-tree-table.tsx:40-46` |
| Metric row | `IEventAnalyticsMetricRow = { events: number; users: number }`; the UI derives `epu` and `pctu` | `packages/validation/src/event-analytics.ts` |
| Sort | `zEventAnalyticsSortKey = z.enum(['events','users','epu'])`, mapped to SQL in `EVENT_ANALYTICS_SORT_COLUMN` | `overview.service.ts:326` |
| SQL | `count() AS events`, `uniqExact(profile_id) AS users` in four builders | `overview.service.ts:246,343,466,580` |
| Profile filters | `getEventAnalyticsWhereClause` returns `null` for any `profile.properties.*` condition — deliberately, since these queries have no profile join | `overview.service.ts`, pinned by `event-analytics-filters.test.ts` |
| Filter picker | Phase 1 decision D1 removed the `profile` category from both the panel (`PANEL_CATEGORIES`) and the route toolbar (`categories` prop) | `advanced-filters-panel.tsx`, analytics route |
| Chart | Always visible; series come from checkbox selection, which starts empty | `chart.tsx`, analytics route |
| Persistence | None. Filters and event names live in the URL (`f`, `fg`, `events`); sort, `pct`, metric, granularity, chart type are component state | `use-event-query-filters.ts` |

### 2.1 R3 — verification result: nothing to do

The user reported two defects. Both were checked against the **new** 76KB design and the code on `9f0dcf5b`. Both are already correct; PR #16 (T9) fixed them for real.

| Claim | Design (new) | Code | Verdict |
|---|---|---|---|
| Chevron should come before the checkbox | lines 336-341: `chevron-right` span, then the checkbox span, then the type icon | `tree-nodes.tsx:141-163` — chevron button, then checkbox, with a comment naming the design | **Already correct** |
| Row padding too tight | container `padding-left:14px` plus a spacer of `depth * 22px` | `ROW_PADDING_PX = 14`, `INDENT_PX = 22`, `paddingLeft = 14 + depth * 22` | **Already correct, exact match** |
| (checked additionally) load-more indent | `(depth + 1) * 22 + 25` where children sit at `depth + 1` | `loadMoreIndentStyle(depth) = 14 + depth * 22 + 25`, and `LoadMoreRow` receives the same `depth` as the rows it extends | **Match** — the two differ only in how depth is numbered |

**R3 produces no task.** Re-applying it would be a no-op diff. One genuine gap the new design *does* introduce is column width (§4.4), which belongs to R4.

## 3. Decisions

### D1 — Profile filters use a subselect, not a profile CTE join

R2's obvious reading is "do what `chart.service.ts` does": `collectProfilePropertyKeys` → `profilePropertiesCteSelect` → `rewriteProfilePropertyRefs`. **Rejected.** That machinery exists because the chart *selects and breaks down by* profile properties and must keep the join hash small. Event Analytics only ever *filters* by them — it never puts a profile property in a SELECT, a GROUP BY or a breakdown.

So the whole narrowing apparatus, and with it the entire §5.4 trap, is unnecessary. Use the shape `filter-where.service.ts` already uses for profile conditions on non-profile tables (`buildProfileClause`):

```sql
profile_id IN (
  SELECT id FROM profiles FINAL
  WHERE project_id = 'p' AND properties['plan'] = 'pro'
)
```

Consequences, all of them good:

- No CTE, no `rewriteProfilePropertyRefs`, no way to reintroduce the PR #7 bug — there is no narrowed column to miss.
- `chart.service.ts` is not touched, so Phase 1's "every other surface byte for byte" guarantee survives another phase.
- The clause is self-contained, so it composes inside an `OR` group with no extra wiring — which matters, because Phase 1 established that a dropped branch inside an `OR` widens the result.
- Cost: one extra scan of `profiles` per query. `profiles` is small next to `events`, and the subselect is uncorrelated so ClickHouse evaluates it once.

The §5.4 rule still binds the clause *inside* the subselect: presence is `properties['k'] != ''` / `= ''`, never `mapContains`. Inside the subselect a bare map would actually work, but keeping one rule everywhere is cheaper than keeping two and remembering which applies where.

### D2 — Metric rows carry a `metrics` map alongside `events` and `users`

`IEventAnalyticsMetricRow` is `{ events, users }` and is consumed by the list, totals, property-keys and property-values endpoints plus every tree node component. Turning it into a bag of arbitrary metrics would touch all of them at once.

Instead it becomes:

```ts
type IEventAnalyticsMetricRow = {
  events: number;
  users: number;
  /** Keyed by metric key (§4.2). Present only for the requested metrics. */
  metrics?: Record<string, number>;
};
```

`events` and `users` stay mandatory because `Events` is locked in the picker and `users` backs both the `% of all users` denominator and the deduplication note. Every existing reader keeps working untouched; only new code reads `metrics`.

Rejected alternatives: (a) `metrics: Record<string, number>` alone — breaks every current reader for no gain, since two of the keys are always present anyway; (b) a parallel endpoint returning only the extra metrics — doubles the ClickHouse scans for data that comes free in the same `GROUP BY`.

### D3 — Sort key becomes a metric key string

`zEventAnalyticsSortKey` is an enum of three. With ten possible metrics, sorting by column needs the key to be open. It becomes a `z.string()` validated against the *requested* metrics plus the three legacy values, so an old client sending `sort: 'epu'` still works and a hand-written payload asking to sort by a column it did not request is rejected rather than silently ignored.

### D4 — Parameter metrics read `properties[param]`, and non-numeric values never contribute

Every parameter metric names one event property. Numeric aggregations wrap it in `toFloat64OrNull`, which ClickHouse's aggregate functions skip over — so a row whose parameter is missing or non-numeric does not drag a `sum` or an `avg` toward zero. This is the same principle T6 established for comparison filters, and the reason `toFloat64OrZero` was removed there.

`Unique parameter values` counts distinct non-empty raw strings, not numbers: a parameter like `app_version` is legitimately non-numeric and still has a meaningful cardinality.

### D5 — `% of all users` and every per-user metric are non-additive

The design's own totals row already says `unique · not a sum`. The spec carries this into the contract: each metric declares whether it is additive down the tree. `events` and the parameter sums are additive; `users`, `epu`, `pctu`, and both per-user parameter metrics are not. The table renders the non-additive ones in the totals row from the totals query, never by summing branches.

### D6 — Persistence is localStorage, keyed per project, versioned

Filters already live in the URL and stay there: a URL is shareable, and moving filters into localStorage would break sharing. Everything else (metrics, sort, `pct`, chart metric / granularity / type, chart collapsed) is a personal view preference and goes to localStorage. See §6.

## 4. Contract changes

Location: `packages/validation/src/event-analytics.ts`, next to the existing schemas.

### 4.1 Metric catalogue

```ts
export const EVENT_ANALYTICS_MAX_METRICS = 10;

export const zEventAnalyticsMetricId = z.enum([
  'events', 'uniq_param', 'sum_param', 'avg_param', 'median_param',
  'users', 'epu', 'pctu', 'uniq_param_user', 'sum_param_user',
]);

export const zEventAnalyticsMetric = z.object({
  id: zEventAnalyticsMetricId,
  /** Required for parameter metrics, absent otherwise. Validated in §4.3. */
  param: z.string().optional(),
});
```

Catalogue metadata, copied verbatim from the design's `metricDefs` / `metricGroups` and exported so the picker, the table header and the chart all read one source:

| id | Label | Group | Parameter | Additive | Locked |
|---|---|---|---|---|---|
| `events` | Events | events | no | yes | **yes** |
| `uniq_param` | Unique parameter values | events | yes | no | no |
| `sum_param` | Sum of parameter values | events | yes | yes | no |
| `avg_param` | Average parameter value | events | yes | no | no |
| `median_param` | Median value of the parameter | events | yes | no | no |
| `users` | Users | users | no | no | no |
| `epu` | Events per user | users | no | no | no |
| `pctu` | % of all users | users | no | no | no |
| `uniq_param_user` | Unique parameter values per user | users | yes | no | no |
| `sum_param_user` | Sum of parameter values per user | users | yes | no | no |

Group titles: `Metrics by events`, `Metrics by users`. The design has no sessions group; §9 A4 records that it is deliberately out of scope.

### 4.2 Metric key

One stable string identifies a column in the response map, in `sort`, and in the persisted preferences:

```ts
export function metricKey(metric: IEventAnalyticsMetric): string {
  return metric.param ? `${metric.id}:${metric.param}` : metric.id;
}
```

`sum_param` on `day` is `sum_param:day`. The same metric on two different parameters is two columns, which the design allows and the picker does not prevent.

### 4.3 Input and output

```ts
export const zEventAnalyticsRange = zEventAnalyticsRange.extend({
  metrics: z.array(zEventAnalyticsMetric).max(EVENT_ANALYTICS_MAX_METRICS).optional(),
});
```

Validation rules, enforced by a `superRefine` on the range schema:

- A metric whose catalogue entry has `param: true` must carry a non-empty `param`; one that does not must not carry it.
- `events` must be present when `metrics` is supplied (it is locked in the UI; the server does not trust the UI).
- Duplicate metric keys are rejected.
- `metrics` absent means the legacy four-column behaviour: the server computes `events` and `users` only.

Output:

```ts
export type IEventAnalyticsMetricRow = {
  events: number;
  users: number;
  metrics?: Record<string, number>;
};
```

`sort` (D3):

```ts
export const zEventAnalyticsSortKey = z.string();  // validated against the request's own metrics
```

The three legacy values stay valid. `pctu` sorts identically to `users` — the denominator is constant within a query — and the server maps it to the `users` column rather than computing a ratio in `ORDER BY`, exactly as the table already does today.

### 4.4 Column width

The design narrows metric columns from `158px` to `132px` once more than four metrics are shown (`colW: st.metrics.length > 4 ? '132px' : '158px'`), and the header text wraps. This is UI-only and rides with the table task.

## 5. SQL per metric

All of these are additional aggregate expressions in the **same** `GROUP BY` the four builders already run — no extra scan. `p` is the metric's parameter.

| id | Expression |
|---|---|
| `events` | `count()` |
| `users` | `uniqExact(profile_id)` |
| `epu` | derived client-side: `events / users`, `0` when `users = 0` |
| `pctu` | derived client-side: `users / totals.users`, `0` when `totals.users = 0` |
| `uniq_param` | `uniqExactIf(properties['p'], properties['p'] != '')` |
| `sum_param` | `sum(toFloat64OrNull(properties['p']))` |
| `avg_param` | `avg(toFloat64OrNull(properties['p']))` |
| `median_param` | `quantileExact(0.5)(toFloat64OrNull(properties['p']))` |
| `uniq_param_user` | `uniqExactIf(properties['p'], properties['p'] != '') / uniqExact(profile_id)` |
| `sum_param_user` | `sum(toFloat64OrNull(properties['p'])) / uniqExact(profile_id)` |

Notes that are easy to get wrong:

- `toFloat64OrNull` returns NULL for a missing or non-numeric value, and ClickHouse aggregates skip NULLs. So `avg` averages over the rows that actually carry a number, and `sum` is unaffected — which is the whole point of D4. A row with no such property does **not** count as a zero.
- `quantileExact`, not `quantile`: the approximate form would make the median wobble between page loads on the same data, and the user asked for the median specifically because it resists outliers.
- The two `per user` metrics divide by the group's own `uniqExact(profile_id)`, not by the report total. Division by zero cannot happen in a group that exists (a group has at least one event, so at least one `profile_id`), but the totals row divides by the deduplicated total and must guard it.
- `uniqExactIf` with `!= ''` implements A4 from Phase 1: an absent key reads as `''`, so it is excluded from cardinality rather than counted as a distinct empty value.
- Parameter keys reach SQL through the existing property-key escaping (`sqlstring.escape`), never by interpolation. `property-key-escaping.test.ts` covers the helper; the new expressions must use it.

## 6. Persisted preferences (R5)

One localStorage entry per project:

```
key:   op:event-analytics:v1:<projectId>
value: {
  "version": 1,
  "metrics": [{ "id": "events" }, { "id": "sum_param", "param": "day" }],
  "sort": { "key": "events", "dir": "desc" },
  "pct": true,
  "chart": { "metric": "events", "granularity": "day", "type": "line", "collapsed": false },
  "selected": ["/level_start", "/ads_inter_shown"]
}
```

Rules:

- **Read**: parse, then validate with a zod schema. Anything that fails — corrupt JSON, an unknown `version`, a metric id no longer in the catalogue — is **discarded wholesale** and the defaults apply. No partial recovery: a half-restored view is harder to explain than a fresh one.
- **Write**: debounced, on change, after the value has been applied.
- **Version**: bumping `version` is how a future structural change opts out of old entries. The key itself carries `v1` as well so an old build and a new build never fight over one entry.
- **Not persisted**: filters and the filter group (they are URL state and must stay shareable), the date range (already URL state), the search term (transient).
- **Relationship with R1**: the cold-start default applies **only when nothing is stored**. A user who deliberately unselected every event and reloads must not have five events selected for them again — a restored empty selection is a choice, an absent entry is not. This is why `selected` is persisted as an array that can legitimately be empty, and why the distinction is "key absent" rather than "value falsy".

## 7. R1 — chart cold start and collapse

- **Cold start.** On first render, when there is no persisted `selected` entry and the selection is empty, select the first `min(5, rows.length)` rows of the list, in the order the list returned them (which is the user's current sort). The chart then always has something to draw. Selecting fewer than five when fewer exist falls out of `min`.
- The default runs **once per mount**, guarded by a ref, not on every list refetch — otherwise changing a filter would re-select rows the user had just cleared.
- **Collapse.** The chart head gains a `32x30` icon button (`title="Hide chart"`, design line 237). When collapsed, the chart is replaced by a centred pill reading `Show chart` with a `move-diagonal` icon (design lines 208-212). State persists (§6).
- Collapsed means **not rendered**, not `display:none`: the chart's queries should not run while it is hidden.

## 8. Tasks

### Wave 0 — contract (sequential, blocks everything)

**P0 — Contract.** §4 in full: metric catalogue with metadata, `metricKey`, schema extensions, `superRefine` validation, `IEventAnalyticsMetricRow.metrics`, the `sort` widening, and the preferences schema from §6. Pure validation package plus its tests. Done when `pnpm -F @openpanel/validation typecheck` passes and the schema rejects: a parameter metric with no `param`, a plain metric carrying one, eleven metrics, duplicate keys, and a `sort` naming a metric that was not requested.

### Wave 1 — independent, parallel after P0

| Task | Scope | Files |
|---|---|---|
| **P1** | Metric SQL: build the aggregate expressions from the requested metrics in all four builders; extend the sort mapping; return `metrics` in each row and in totals | `packages/db/src/services/overview.service.ts`, new `event-analytics-metrics-sql.test.ts` |
| **P2** | Profile filters via subselect (§3 D1); delete the drop branch and rewrite the test that pins it; keep `mapContains` out | `packages/db/src/services/overview.service.ts`, `event-analytics-filters.test.ts` |
| **P3** | R1 chart: cold-start selection, collapse button, `Show chart` pill, no queries while collapsed | `apps/start/src/components/event-analytics/chart.tsx`, analytics route |
| **P4** | R5 persistence: a `useEventAnalyticsPrefs` hook over localStorage with the §6 schema, discard-on-invalid, debounced writes | `apps/start/src/hooks/use-event-analytics-prefs.ts` (new) + test |

**Conflict note:** P1 and P2 both edit `overview.service.ts`. P1 touches the SELECT lists of the four builders; P2 touches `getEventAnalyticsWhereClause` only. They do not overlap textually, but **merge P2 first** — it is the smaller diff and its test file already exists, so P1 rebases onto it rather than the other way round.

P3 and P4 both edit the analytics route, each adding a few lines. P4 merges first; P3 rebases.

### Wave 2 — after Wave 1

| Task | Scope | Files |
|---|---|---|
| **P5** | Metrics dialog UI (design 2a/2b): chip frame with drag-reorder and locked `Events`, `+` button, searchable two-group catalogue, parameter dropdown, `x of 10` counter, Apply / Cancel | `apps/start/src/components/event-analytics/metrics-dialog.tsx` + `metrics-state.ts` (pure, testable) + test |
| **P6** | Table columns (design 2c): render one column per metric, header wrap, `132px` past four metrics, totals row per metric, sort by any metric column | `event-tree-table.tsx`, `tree-nodes.tsx`, `tree-utils.ts` |
| **P7** | Chart series follow the metric set; the chart metric select lists the chosen metrics | `chart.tsx`, `chart-input.ts` |

P5 ships before P6: the table needs the metric list the dialog produces. P6 and P7 both read that list but touch different files, so they run in parallel after P5.

### Wave 3

**P8 — Integration test.** Extend the T8 fixture with a numeric parameter (`level_id`) and a non-numeric one (`app_version`), plus rows where the parameter is absent. Assert every metric in §5 against hand-computed numbers, and specifically that a missing parameter does not pull `avg_param` down and does not add a distinct value to `uniq_param`.

**P9 — Visual verification.** Compare against `render_preview` of states `2a`, `2b`, `2c`, `2d`.

### Merge order

`P0 → P2 → P1 → (P4 → P3) → P5 → (P6 ∥ P7) → P8 → P9`

### Sub-agent prompts

Common preamble:

> Work on `feature/event-analytics`. Read `docs/superpowers/specs/2026-09-16-event-analytics-phase2-design.md` first; sections 3, 4 and 5 are binding, and the Phase 1 spec's §5.4 rule (never `mapContains` for profile properties) still holds. Design: Claude Design project `233791a0-310f-443c-8118-b345c9f77b7d`, files `Event Analytics Metrics.dc.html` and `EventAnalyticsScreen.dc.html` at the project root (read with the claude_design MCP). Use `superpowers:test-driven-development`. Follow `.claude/CLAUDE.md`; NEVER run `pnpm format`; run `pnpm codegen` before any typecheck and never commit `packages/geo/src/datacenter-asns.ts`. Typecheck narrow (`pnpm -F <package> typecheck`). Verify with real test output — read both the `Test Files` and the `Tests` line and report skips. Commit only your task's files. Report any deviation from the spec instead of silently adjusting it.

**P0:**
> Implement §4 exactly in `packages/validation/src/event-analytics.ts`: the metric id enum, the exported catalogue with label / group / param / additive / locked per §4.1, `metricKey` per §4.2, `metrics` on the range schema with the `superRefine` rules in §4.3, `metrics?: Record<string, number>` on `IEventAnalyticsMetricRow`, and `sort` widened to a string validated against the request's own metrics plus `events` / `users` / `epu`. Also add the preferences schema from §6. Tests must cover every rejection listed in the Wave 0 task. Change no other package.

**P1:**
> In `packages/db/src/services/overview.service.ts`, build the per-metric aggregate expressions of §5 from `input.metrics` and add them to the SELECT of all four event analytics builders, returning them under `metrics` keyed by `metricKey`. Extend `EVENT_ANALYTICS_SORT_COLUMN` into a function that maps any requested metric key to its SQL expression, with `pctu` mapping to the `users` column. Escape parameter keys with the existing helper — never interpolate. When `metrics` is absent the emitted SQL must be byte-identical to today; add a test asserting that. Cover each metric's expression, and cover that a missing parameter neither lowers `avg_param` nor adds a value to `uniq_param`.

**P2:**
> In `getEventAnalyticsWhereClause`, replace the branch that returns `null` for `profile.properties.*` with a self-contained subselect: `profile_id IN (SELECT id FROM profiles FINAL WHERE project_id = <escaped> AND <clause>)`, where `<clause>` is compiled by the same per-filter logic against the profiles table. Do NOT build a profile CTE and do NOT touch `chart.service.ts` — see §3 D1 for why. Presence stays `properties['k'] != ''`; assert in a test that no generated SQL contains `mapContains`. Rewrite the test in `event-analytics-filters.test.ts` that currently pins the dropping behaviour, and add one proving a profile filter inside an OR group narrows rather than widens.

**P3:**
> In `apps/start/src/components/event-analytics/chart.tsx` and the analytics route, add R1 (§7): select the first `min(5, rows.length)` listed rows once per mount when the selection is empty and no persisted selection exists; add the collapse button in the chart head (`title="Hide chart"`) and the centred `Show chart` pill with the `move-diagonal` icon; do not render the chart or run its queries while collapsed. Coordinate the persisted-selection check with P4's hook. Put any logic worth testing in a pure helper beside the component, the way `tree-utils.ts` does — `apps/start` has no React test setup.

**P4:**
> Add `apps/start/src/hooks/use-event-analytics-prefs.ts` implementing §6: one localStorage entry per project keyed `op:event-analytics:v1:<projectId>`, validated with the zod schema from P0, discarded wholesale on any validation failure, written debounced. Filters and the date range are NOT persisted. Export a clear distinction between "no entry" and "entry with an empty selection" — R1's cold start depends on it. Test the pure read/write/validate logic.

**P5:**
> Build the Metrics dialog from design states `2a` and `2b` in `apps/start/src/components/event-analytics/metrics-dialog.tsx`, with all reducer-style logic in a pure `metrics-state.ts` beside it (tested; `apps/start` has no React test setup). Behaviour: chip frame listing the draft metrics in column order, grip to reorder, `x` to remove, `Events` locked with no remove button; a `+` tile that opens the 458px catalogue panel to the right, searchable, two groups titled `Metrics by events` and `Metrics by users`, a check on chosen metrics; choosing a parameter metric appends a pending chip and opens the 212px parameter dropdown under the chip frame, and clicking an existing parameter chip reopens it to change the parameter; `Apply` commits, `Cancel` restores; the counter reads `<n> of 10 metrics selected` and the `+` tile dims at 10. The toolbar button reads `Metrics · <first label>, +<n-1>`.

**P6:**
> Render one table column per chosen metric (design state `2c`): headers from the catalogue labels, uppercase, allowed to wrap; column width `158px`, or `132px` when more than four metrics are shown; cells read `row.metrics[key]` with `events` and `users` still read from their own fields; the totals row shows each metric from the totals response and never sums branches for a non-additive metric; every column header sorts, sending its metric key as `sort`. Keep the existing formatting helpers.

**P7:**
> Make the chart follow the chosen metrics: the metric select lists exactly the metrics in the current set (labels from the catalogue) instead of the fixed three, and the plotted series uses the selected metric key.

**P8:**
> Extend the event analytics ClickHouse fixture with a numeric parameter, a non-numeric parameter, and events missing the parameter entirely. Assert every metric of §5 against hand-computed values, including that a missing parameter neither lowers `avg_param` nor adds a distinct value to `uniq_param`, and that `users` in the totals row is less than the sum of the branch `users` when users overlap.

**P9:**
> Run the dashboard and compare the Events › Analytics tab against `render_preview` of states `2a`, `2b`, `2c` and `2d`. Fix gaps inside `apps/start/src/components/event-analytics/`. Report screenshots.

## 9. Assumptions

**A1 — `Unique parameter values per user` is total distinct ÷ users.**
The design's help text ("Distinct parameter values per user") also reads as "the average, per user, of that user's own distinct count", which needs a nested `GROUP BY profile_id` and a second aggregation — materially more expensive. Chose the cheap reading, which matches how `Events per user` is defined right next to it in the same group. If the expensive reading is wanted, it is a different SQL shape and should be decided before P1 — see question 1.

**A2 — A parameter metric with no parameter chosen is never sent to the server.**
The design lets a pending chip exist (`Sum of parameter values: —`). The spec makes `Apply` reject a draft holding one, rather than sending a partial metric the server would have to interpret. Alternative: send it and let the column render empty. Rejected — a column that is permanently blank looks like a data bug.

**A3 — `pctu` sorts by `users`.**
The denominator is constant within a query, so the orderings are identical and the cheaper column wins. This is what the table already does (`sortKeyForColumn`), so it is consistency rather than a new decision.

**A4 — No "Metrics by sessions" group.**
The user said to drop it for now and the design has no such group. The catalogue metadata carries a `group` field, so adding one later is additive.

**A5 — Two columns may use the same metric with different parameters.**
`metricKey` includes the parameter, so `sum_param:day` and `sum_param:level_id` coexist. The design does not forbid it and the picker does not check. Alternative: one column per metric id. Rejected — comparing the same aggregation across two parameters is the obvious use.

**A6 — The parameter list comes from the existing property-keys endpoint.**
The design hard-codes `paramList`. The real dropdown should list the project's actual event property keys, which `overview.eventPropertyKeys` already returns. Scoping it to the properties of the events currently in the table would be better but needs a new endpoint; the flat project-wide list is the smaller step.

**A7 — Metrics apply to every level of the tree, not only to event rows.**
The design's `metricCell` renders metrics for every row. A parameter metric on a deep value node is well defined (the rows under that node still have the parameter), so no special case is needed. Where the parameter is absent from that branch the aggregates simply see no numbers, which D4 already defines.

**A8 — Persistence is per project, not per user-and-project.**
localStorage is already per browser profile, so adding the user id would only matter when two accounts share one browser. Alternative: include the user id in the key. Rejected as unnecessary until someone reports it.

**A9 — Collapsing the chart stops its queries.**
Keeping them warm would make expanding instant, at the cost of querying ClickHouse for something nobody is looking at. The user asked for collapse to reduce noise; spending query budget on a hidden chart contradicts that.

**A10 — R3 produces no task.**
Both reported defects verified correct against the current design and code (§2.1). Re-applying them would be a no-op diff, and a no-op diff in a review queue costs more than it saves.

## 10. Questions for the user

1. **A1** — is `Unique parameter values per user` the total distinct count divided by users (cheap, chosen here), or the average of each user's own distinct count (needs a nested aggregation)? These give different numbers whenever users share values.
2. **A6** — should the parameter dropdown list every event property in the project, or only the properties of the events currently shown in the table? The second is friendlier and needs a new endpoint.
3. `median_param` uses `quantileExact`, which is exact but holds all values in memory per group. On a high-cardinality tree this is the most expensive metric in the catalogue. Accept it, or fall back to `quantile` (approximate, cheaper, slightly unstable between runs)?
4. **R5 scope** — should the persisted view also restore the *expanded* tree nodes, or only the selection? Restoring expansion means firing every child query on load.
5. **P2 cost** — the profile subselect scans `profiles` once per event analytics query. If a project has millions of profiles this is worth measuring before shipping. Should P2 include a benchmark step, or is that premature?
6. **A5** — should the picker allow the same metric with two different parameters, or is that confusing enough to forbid?
