# Advanced Filters (AND/OR groups) — Design

Date: 2026-09-15
Branch: `feature/event-analytics`
Task: T7 of `docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md` §5.
Design source: Claude Design project `cde63790-13aa-464a-851a-edf3a279a8e3`, file `EventAnalyticsScreen.dc.html`, panel "Advanced filters".

> Spec only. No implementation until the spec is approved.

## 1. Goal

Replace the flat, implicitly-ANDed filter list with a condition tree:

- Groups combined with `AND` or `OR`.
- At most two group levels: a root group plus one level of sub-groups.
- Two new operators: `hasProperty` ("has property") and `missingProperty` ("missing property").
- The same tree drives the Event Analytics chart and the Event Analytics tree table, and — because it reuses the shared filter compiler — every other report surface that already accepts `IChartEventFilter[]`.
- Saved reports, saved URLs, and the public API keep working without a data migration.

## 2. Current state

| Where | Shape | Notes |
|---|---|---|
| `packages/validation/src/chart-primitives.ts` | `zChartEventFilter` | Single condition: `name`, `operator`, `value[]`, optional `type`, `cohortIds`. |
| `packages/validation/src/index.ts` | `zChartEvent.filters`, `zReportInput.globalFilters` | `z.array(zChartEventFilter)`. |
| `packages/validation/src/event-analytics.ts` | `zEventAnalyticsRange.filters` | `z.array(zChartEventFilter)`. |
| `packages/db/src/services/chart.service.ts` | `getEventFiltersWhereClause(filters, projectId, eventsAlias?, tableScope?)` | Returns `Record<string,string>`; callers merge the values with `AND`. Events/sessions scope. Used by chart, funnel, conversion, sankey, retention, overview, event services and `packages/trpc/src/routers/chart.ts`. |
| `packages/db/src/services/filter-where.service.ts` | `buildFilterWhere(filters, projectId, ctx)` | Same idea for the sessions / profiles / cohort tables. Already parenthesises each fragment. |
| `apps/start/src/components/filters/FiltersBuilder.tsx` | flat list UI | Renders `PureFilterItem` / `PureCohortFilterItem` per condition. Used by report sidebar, table filter modals, project settings, cohort builder. |

Two independent compilers exist. Both iterate the array and emit one WHERE fragment per filter. Neither can express OR between filters.

R10 (`toFloat64OrZero` making missing / non-numeric values compare as `0`) is being fixed in T6. This spec assumes the corrected behaviour: **a missing or non-numeric property never satisfies a numeric comparison.** `hasProperty` / `missingProperty` are the supported way to ask about presence; users must no longer rely on `prop < 1` to catch missing keys.

## 3. Data model

New file `packages/validation/src/filter-group.ts` (a leaf module like `chart-primitives.ts`, so it cannot create an import cycle through `index.ts`):

```ts
import { zChartEventFilter } from './chart-primitives';

export const zFilterCondition = z.object({
  kind: z.literal('condition'),
  filter: zChartEventFilter,
});

/** Level 1: a sub-group. Conditions only — it may not contain further groups. */
export const zFilterSubGroup = z.object({
  kind: z.literal('group'),
  id: z.string().optional(),
  op: z.enum(['and', 'or']),
  children: z.array(zFilterCondition).max(FILTER_GROUP_MAX_CHILDREN),
});

/** Level 0: the root group. Holds conditions and sub-groups. */
export const zFilterGroup = z.object({
  kind: z.literal('group'),
  id: z.string().optional(),
  op: z.enum(['and', 'or']),
  children: z
    .array(z.union([zFilterCondition, zFilterSubGroup]))
    .max(FILTER_GROUP_MAX_CHILDREN),
});

export const FILTER_GROUP_MAX_CHILDREN = 20;
export const FILTER_GROUP_MAX_DEPTH = 2; // documentation constant; the depth limit is structural
```

The two-level limit is enforced by the schema shape, not by a runtime depth counter: `zFilterSubGroup.children` accepts conditions only, so a third level is unrepresentable. No `z.lazy`, no recursion guard, no way for a hand-written API payload to smuggle deeper nesting past validation.

`zChartEventFilter` itself gains the two new operators. They are added to `operators` and `operatorsShort` in `packages/constants/index.ts`:

```ts
hasProperty: 'Has property',
missingProperty: 'Missing property',
```

Both take an empty `value` array, like `isNull` / `isNotNull`. They are excluded from the per-type operator lists for `number`, `date`, `datetime` and `boolean`, and offered for every property regardless of type by the property-presence branch of the operator select (see §6).

## 4. Wire format and migration

Every input schema that has `filters: z.array(zChartEventFilter)` gains a sibling optional field:

| Schema | Existing | Added |
|---|---|---|
| `zChartEvent` | `filters` | `filterGroup?: zFilterGroup` |
| `zReportInput` | `globalFilters` | `globalFilterGroup?: zFilterGroup` |
| `zEventAnalyticsRange` | `filters` | `filterGroup?: zFilterGroup` |

Resolution rule, implemented once in `packages/validation/src/filter-group.ts` and used by every consumer:

```ts
export function resolveFilterGroup(
  filters: IChartEventFilter[] | undefined,
  group: IFilterGroup | undefined,
): IFilterGroup   // never null; an empty root group means "no filtering"
```

- `group` present → return it. `filters` is then ignored.
- `group` absent → return `{ kind: 'group', op: 'and', children: filters.map(toCondition) }`.

Consequences:

- Old saved reports (Postgres JSON), old saved URLs and old API clients keep working untouched. No Prisma migration, no backfill.
- Anything that writes a group also writes the flattened `filters` array holding the conditions that are still combined with a top-level `AND` (root `op: 'and'`, direct condition children). When the root is `or`, or the condition sits in a sub-group, it is omitted from the flat array. Old readers therefore see a **narrower-or-equal** filter, never a wider one. This is a deliberate one-way lossy mirror for old clients; the group is the source of truth.
- Once the UI writes groups, `filters` is still the field the AI filter agent (`packages/trpc/src/agents/filter-command.ts`) and the public API emit. Both keep working because a flat array is a valid implicit-AND group.

## 5. SQL compilation

### 5.1 Refactor, not rewrite

`getEventFiltersWhereClause` currently owns a ~300-line `forEach` whose body computes one clause per filter. Extract that body verbatim into:

```ts
export function compileEventFilter(
  filter: IChartEventFilter,
  projectId: string | undefined,
  eventsAlias: string | undefined,
  tableScope: 'events' | 'sessions',
): string | null      // null = this filter contributes nothing
```

`getEventFiltersWhereClause` keeps its current signature and behaviour, now implemented as a loop over `compileEventFilter`. All existing call sites and tests stay untouched. `filter-where.service.ts` already has this shape internally (`compileScalarClause` + the `set(...)` helper); expose its per-filter path as `compileTableFilter(filter, projectId, ctx): string | null`.

### 5.2 Tree walker

One shared walker, in `packages/db/src/services/filter-group.service.ts`:

```ts
export function compileFilterGroup(
  group: IFilterGroup,
  compile: (filter: IChartEventFilter) => string | null,
): string | null
```

Rules:

- Compile every child. A condition that compiles to `null` is **dropped**.
- A sub-group whose children all dropped is itself dropped.
- Join the surviving fragments with ` AND ` / ` OR ` per `op`, wrapping each fragment and the whole join in parentheses.
- A group with zero surviving children returns `null` — i.e. "no restriction", never `1 = 0`.

The drop rule is the one behavioural risk worth stating loudly: inside an `OR`, dropping a child **widens** the result set, while inside an `AND` it narrows nothing. That is why the UI (§6) refuses to save a condition that would compile to `null` (empty value list on an operator that needs values), so drops cannot happen from user input in practice — only from a filter that is structurally inapplicable to the table being queried (`properties.*` on the sessions table, which `buildFilterWhere` already ignores today).

Callers change from

```ts
sb.where = getEventFiltersWhereClause(event.filters, projectId, 'e');
```

to

```ts
sb.where = getFilterWhere(resolveFilterGroup(event.filters, event.filterGroup), projectId, 'e');
```

where `getFilterWhere` returns `{}` or `{ fgroup: '<clause>' }`. Existing callers keep merging `sb.where` values with `AND`, so a single key is enough and no caller needs to learn about grouping.

Call sites to convert: `chart.service.ts` (2), `event.service.ts` (3), `conversion.service.ts` (2), `funnel.service.ts`, `sankey.service.ts`, `retention.service.ts`, `overview.service.ts`, `trpc/src/routers/chart.ts`, plus `session.service.ts` / `profile.service.ts` / `cohort.service.ts` for the `buildFilterWhere` side. Each converts only when its input schema actually carries a group; the rest keep calling the array API, which still works.

### 5.3 The new operators

Property presence depends on where the property lives:

| Filter name | `hasProperty` | `missingProperty` |
|---|---|---|
| Map-backed property (`properties.*`, `group.*`) | `mapContains(properties, 'k') AND properties['k'] != ''` | `NOT mapContains(properties, 'k') OR properties['k'] = ''` |
| Top-level column (`country`, `path`, …) | `<col> IS NOT NULL AND <col> != ''` | `<col> IS NULL OR <col> = ''` |
| Array column (wildcard path) | `arrayExists(x -> x != '', <expr>)` | `NOT arrayExists(x -> x != '', <expr>)` |

Empty string counts as missing. ClickHouse `Map(String,String)` returns `''` for an absent key and the ingest path (`toDots`, `event.service.ts:386`) cannot distinguish "sent empty" from "not sent", so treating them alike is the only behaviour that is consistent between the two. This makes `hasProperty` / `missingProperty` exact complements — `missingProperty` is the negation of `hasProperty` for the same key, with no third state.

`missingProperty` is the operator users need now that T6 makes numeric comparisons skip missing values. Document that pairing in the operator dropdown help text.

## 6. UI

`apps/start/src/components/filters/FiltersBuilder.tsx` gains a group-aware mode. It keeps its current flat props as the default so the five existing call sites do not change:

```ts
value: IChartEventFilter[]; onChange: (next: IChartEventFilter[]) => void;   // existing
group?: IFilterGroup; onGroupChange?: (next: IFilterGroup) => void;          // new
```

When `group` is supplied the component renders the tree; otherwise it renders today's list. The condition row itself is unchanged — `PureFilterItem` and `PureCohortFilterItem` are reused as-is.

Layout, matching the design's "Advanced filters" panel:

- Root group: an `AND` / `OR` segmented toggle in the header; children stacked below.
- Condition row: property combobox, operator select, value input, remove button (today's row).
- Sub-group: indented block with its own `AND` / `OR` toggle, a left rule, its own "Add condition" button, and a remove button. No "Add group" button inside a sub-group — the second level is the last one, so the affordance simply does not exist rather than appearing and erroring.
- Root footer: "Add condition" and "Add group".
- The operator select shows "Has property" / "Missing property" in a separate section at the bottom of the list and hides the value input when either is chosen.
- Saving is blocked while any condition has an operator that needs values and an empty value list; the row is marked invalid inline. This is what keeps §5.2's drop rule from ever firing on user input.

Chart and table share one group: the Event Analytics route holds it in state and passes it to both `eventAnalyticsList` / `eventAnalyticsTotals` / the tree endpoints and to the chart query, exactly as `filters` is passed today.

Event Analytics URL state (`use-event-query-filters.ts`) keeps the existing flat param and adds one `fg` param holding the JSON-encoded group. When `fg` parses, it wins; otherwise the flat param is used. An `fg` value that fails `zFilterGroup` is discarded with a toast rather than throwing, so a hand-edited or truncated URL degrades to the flat filters instead of breaking the page.

## 7. Error handling

- Invalid group from an API client: zod rejects at the router boundary; the structural depth limit means a three-level payload fails validation rather than compiling.
- Group with no compilable children: treated as no filter (see §5.2).
- `hasProperty` with an empty `name`: rejected by the UI; compiles to `null` server-side.
- Truncated / corrupt `fg` URL param: discarded, flat filters used, toast shown.

## 8. Testing

- `packages/validation`: a three-level group fails `zFilterGroup`; a flat array round-trips through `resolveFilterGroup` into an implicit-AND root; the flattened mirror omits sub-group and `or`-root conditions.
- `packages/db`: unit tests on `compileFilterGroup` with a stub `compile` — AND/OR nesting parenthesisation, dropped child inside AND, dropped child inside OR, all-dropped group returning `null`.
- `packages/db`: SQL-shape tests for `hasProperty` / `missingProperty` on a map property, a top-level column and an array column; plus a test asserting `missingProperty` and `hasProperty` on the same key produce mutually exclusive clauses.
- `packages/db`: a regression test pinning the T6 interaction — a row with no `level` key matches `missingProperty` and does **not** match `level < 1`.
- Existing `filter-where.test.ts` and the chart SQL tests must pass unchanged; that is the proof the §5.1 extraction was behaviour-preserving.
- Commands: `pnpm vitest run <path>`, `pnpm typecheck`. Never run `pnpm format` (project rule).

## 9. Assumptions

No user was reachable while writing this spec, so every open decision below was made here. Each lists the alternatives considered and why they lost.

**A1 — Two levels means root group + one level of sub-groups.**
Alternatives: (a) root is implicit and the two levels are both user-visible groups (three levels of parentheses in SQL); (b) a runtime depth counter over a recursive `z.lazy` schema. Chose the stated reading because it matches the design panel (one `AND`/`OR` header plus indented sub-blocks) and because a non-recursive schema makes the limit unrepresentable rather than merely validated.

**A2 — Additive `filterGroup` field, no data migration.**
Alternatives: (a) change `filters` to a union of array-or-group — breaks every existing consumer's types and the public API; (b) migrate saved report JSON in Postgres — irreversible, and a bad migration corrupts user reports for a feature they have not asked for yet. Additive is reversible: drop the field and everything still runs.

**A3 — The flat `filters` mirror is lossy and narrower-or-equal.**
Alternative: stop writing `filters` once a group exists, so old readers see no filters at all. Rejected — an old reader silently showing *unfiltered* data is a worse failure than showing over-filtered data. Writing only the top-level ANDed conditions guarantees the mirror can never be wider than the real filter.

**A4 — Empty string counts as a missing property.**
Alternative: `mapContains` alone, so an explicitly-empty value counts as present. Rejected because ClickHouse `Map(String,String)` returns `''` for absent keys and the ingest flattening loses the distinction, so the stricter reading is not actually observable and would make `hasProperty` and `missingProperty` non-complementary.

**A5 — An uncompilable condition is dropped, not treated as false.**
Alternative: compile to `0` so an `OR` branch cannot widen. Rejected: `0` inside an `AND` group silently empties the whole report, which is the more damaging failure. The UI-side save guard (§6) means user input never produces a drop, so the rule only covers filters that are structurally inapplicable to the queried table — which is exactly today's behaviour in `buildFilterWhere`.

**A6 — `hasProperty` / `missingProperty` apply to any property, not only event properties.**
Alternative: restrict to `properties.*`. Rejected — "is this column empty" is the same question for `country` or `referrer_name`, the existing `isNull` / `isNotNull` operators already straddle both, and the per-table compilers already know how to address each column.

**A7 — One group per surface, shared by chart and table.**
Alternative: separate chart and table filters. Rejected: the design shows a single "Advanced filters" panel above both, and divergent filters would make the chart and the table disagree about the same numbers.

**A8 — Sub-groups hold conditions only, and the "Add group" button is absent there.**
Alternative: show the button disabled with a tooltip. Rejected — an affordance that exists only to refuse is worse than no affordance.

**A9 — `fg` URL param carries JSON.**
Alternatives: a compact custom encoding, or storing the group server-side and putting an id in the URL. Rejected as premature: JSON is what the existing filter params already carry, and no measurement says the URLs are too long.

## 10. Questions for the user

1. **A3** — is the lossy flat mirror acceptable, or should a saved report that uses OR/sub-groups be unreadable by old clients instead of under-filtered?
2. **A4** — should an explicitly-empty property value (`prop=""`) count as *present* for `hasProperty`? Answering yes needs a change at ingest, not here.
3. Should `missingProperty` be offered for **cohort** filters (`inCohort` / `notInCohort` share the operator select)? This spec excludes it.
4. Scope check: this spec converts every `getEventFiltersWhereClause` / `buildFilterWhere` call site to the group API. Should the first implementation instead limit itself to the Event Analytics surfaces and convert the rest later?
5. The design panel could not be read while writing this spec (`DesignSync` requires an interactive `/design-login` that is unavailable here). §6's layout is reconstructed from the tree-design spec's description of the panel; please confirm it against the actual design file.
