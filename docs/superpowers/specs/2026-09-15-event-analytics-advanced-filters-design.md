# Advanced Filters (AND/OR groups) — Design

Date: 2026-09-15
Branch: `feature/event-analytics`
Task: T7 of `docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md` §5.
Design source: Claude Design project `233791a0-310f-443c-8118-b345c9f77b7d`, file `EventAnalyticsScreen.dc.html` (824 lines), panel "Advanced filters" (`filtersOpen` prop, `filterGroups` view model).

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

Read from the design file, not inferred: the panel is a 600px popover anchored to a "Filters" toolbar button. The button carries a count badge (`filterCount` = number of active conditions) that is hidden when the count is zero, and inverts to dark when the panel is open.

**Header.** `Advanced filters` on the left, then the label `Match` and a two-segment `AND` / `OR` toggle. This is the root group's operator — there is exactly one root-level toggle, which confirms §3's root-plus-one-level shape.

**Body.** The design renders the groups as a *flat, ordered list of group cards* (`filterGroups`), each carrying its own `level` and `indent`, rather than as nested DOM. Level 1 sits at `indent: 0`, level 2 at `indent: 22px` with a tinted background (`#FAFBFD`). The implementation should flatten the tree the same way (`flattenGroups(root) -> { group, level, indent }[]`); it keeps the markup shallow and matches the table's own 22px-per-depth indentation.

Each group card has:

- A **scope badge** (`USER PROPERTY`, `EVENT PROPERTY`), a **hint** describing the group's operator in words (`All conditions must match` / `Any condition may match`), and a monospace `LEVEL n` marker.
- **Condition rows**: a 34px right-aligned monospace **join column** — empty on the first row, the group's operator (`AND` / `OR`) on every subsequent row — then the property field, a fixed 118px operator field, the value field, and an `x` remove button.
- A footer with `+ Condition` and `+ Nested group`.

The group's operator is therefore surfaced twice — as the per-row join word and as the hint sentence — but the design shows no per-group toggle control. The implementation makes the join word itself the control: clicking `AND` / `OR` in the join column flips the group's operator, with the hint sentence updating to match. That adds no chrome the design does not show while keeping the operator reachable.

**Nesting limit, as designed.** In the level-2 card, `+ Nested group` is *present but disabled*: `cursor: not-allowed`, `opacity: 0.5`, `title: "Nesting is limited to two levels"`, next to a grey note `Max 2 nesting levels`. Match this exactly.

**Footer.** `Applies to chart and table` on the left, then `Clear` and a primary `Apply filters` button that closes the panel. Edits inside the panel are therefore **staged**: the report does not re-query on each keystroke, only on `Apply`. `Clear` empties the root group. Closing the panel without pressing `Apply` discards the staged edit.

**Active chips.** Below the toolbar sits a row of pills (`platform = iOS`, `app_version ≥ 3.4.0`) each with an `x`, followed by `Clear all`, and the empty state `No property filters — showing all traffic`. The chips are the flattened applied conditions; removing one removes that condition from its group and re-queries immediately (chips act on the applied state, not the staged one). A group left with no conditions is removed with its last chip.

**Property naming.** The design writes user-scoped properties as `user.country` and event-scoped ones as `<event>.<property>` (`level_start.level_id`). Existing `IChartEventFilter.name` values already use `profile.*` for the former; event property filters stay `properties.*` on the wire, with the event-qualified form used only as the display label.

**Operator labels.** The design shows `is one of`, `is not`, `equals`, `≥`. The repo's `operators` / `operatorsShort` already cover these (`is`, `isNot`, `gte`); rendering `is` as `equals` for a single value and `is one of` for several is a label-only refinement of the existing select, not a new operator. The two new operators from §3 (`hasProperty`, `missingProperty`) do not appear in the mockup's sample rows; they go at the bottom of the operator select and hide the value field when chosen.

**Component reuse.** `apps/start/src/components/filters/FiltersBuilder.tsx` gains a group-aware mode; its current flat props stay the default so the five existing call sites do not change:

```ts
value: IChartEventFilter[]; onChange: (next: IChartEventFilter[]) => void;   // existing
group?: IFilterGroup; onGroupChange?: (next: IFilterGroup) => void;          // new
```

The condition row itself is unchanged — `PureFilterItem` and `PureCohortFilterItem` are reused as-is.

Saving is blocked while any condition has an operator that needs values and an empty value list; the row is marked invalid inline and `Apply filters` is disabled. This is what keeps §5.2's drop rule from ever firing on user input.

Chart and table share one group, as the footer states. The Event Analytics route holds it in state and passes it to `eventAnalyticsList` / `eventAnalyticsTotals` / the tree endpoints and to the chart query, exactly as `filters` is passed today.

Event Analytics URL state (`use-event-query-filters.ts`) keeps the existing flat param and adds one `fg` param holding the JSON-encoded applied group. When `fg` parses, it wins; otherwise the flat param is used. An `fg` value that fails `zFilterGroup` is discarded with a toast rather than throwing, so a hand-edited or truncated URL degrades to the flat filters instead of breaking the page. The design has no routing, so this part is not design-derived (see A9).


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

**A8 — Sub-groups hold conditions only; `+ Nested group` is shown disabled there.**
An earlier draft of this spec hid the button entirely. The design file settles it: the level-2 card keeps the button with `cursor: not-allowed`, `opacity: 0.5`, `title: "Nesting is limited to two levels"` and a `Max 2 nesting levels` note. The disabled affordance teaches the limit instead of leaving the user wondering where the option went. Spec follows the design.

**A9 — `fg` URL param carries JSON.**
Alternatives: a compact custom encoding, or storing the group server-side and putting an id in the URL. Rejected as premature: JSON is what the existing filter params already carry, and no measurement says the URLs are too long.

**A10 — The scope badge (`USER PROPERTY` / `EVENT PROPERTY`) is a derived label, not a constraint.**
The design shows one badge per group, and in the sample each group happens to be single-scope. This spec computes the badge from the conditions the group holds and shows `MIXED` when they disagree, rather than forbidding mixed groups. Alternative: make scope a real property of the group and restrict which conditions may be added. Rejected as a much larger model change that the design does not clearly demand — see question 4.

**A11 — Panel edits are staged; `Apply filters` commits.**
The design's footer has an explicit `Apply filters` button, so the panel cannot be live-updating. Alternative: apply on every change and treat the button as a close affordance. Rejected — it would re-query ClickHouse on every keystroke in a value field.

**A12 — Chips act on the applied group and remove immediately.**
Alternative: make chip removal staged too. Rejected — the chips sit outside the panel and have no Apply button of their own, so staging them would leave no way to commit.

**A13 — The join word in the row gutter is the group-operator control.**
The design shows the join word (`AND` / `OR`) per row and describes the operator in the hint sentence, but shows no per-group toggle. Alternative: add a toggle to each group header mirroring the root's. Rejected — it adds chrome the design does not have; making the existing word clickable does not.

## 10. Questions for the user

1. **A3** — is the lossy flat mirror acceptable, or should a saved report that uses OR/sub-groups be unreadable by old clients instead of under-filtered?
2. **A4** — should an explicitly-empty property value (`prop=""`) count as *present* for `hasProperty`? Answering yes needs a change at ingest, not here.
3. Should `missingProperty` be offered for **cohort** filters (`inCohort` / `notInCohort` share the operator select)? This spec excludes it.
4. **A10** — is the scope badge purely informational, or should a group be restricted to a single property scope (all user properties or all event properties)? The design's sample has one of each but never shows a mixed group.
5. Scope check: this spec converts every `getEventFiltersWhereClause` / `buildFilterWhere` call site to the group API. Should the first implementation instead limit itself to the Event Analytics surfaces and convert the rest later?
6. **A13** — is a clickable join word discoverable enough as the group-operator control, or should each group header get its own `AND` / `OR` toggle like the root?
7. **A11** — should `Clear` in the panel footer clear the staged group only, or also clear the applied filters immediately (like `Clear all` on the chip row does)?
