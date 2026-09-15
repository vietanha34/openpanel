# Advanced Filters (AND/OR groups) — Design

Date: 2026-09-15
Branch: `feature/event-analytics`
Task: T7 of `docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md` §5.
Design source: Claude Design project `233791a0-310f-443c-8118-b345c9f77b7d`:
- `Event Analytics.dc.html` — canvas index. Artboard `1c` "Advanced filter popover open": *"Property · operator · value rows, AND/OR groups, nesting capped at two levels"*, rendered as `<dc-import name="EventAnalyticsScreen" filters-open="{{ yes }}">`. Also the `FilterControl` and `Toolbar · below 1200px` component cards.
- `EventAnalyticsScreen.dc.html` (root, 56119 bytes) — the component itself: `filtersOpen` prop, `filterGroups` view model. Not `uploads/Event Analytics Report/*`, which is an older copy.

> Spec only. No implementation until the spec is approved.

## 1. Goal

Replace the flat, implicitly-ANDed filter list with a condition tree:

- Groups combined with `AND` or `OR`.
- At most two group levels: a root group plus one level of sub-groups.
- Two new operators: `hasProperty` ("has property") and `missingProperty` ("missing property").
- The same tree drives the Event Analytics chart and the Event Analytics tree table, and — because it reuses the shared filter compiler — every other report surface that already accepts `IChartEventFilter[]`.
- Saved reports, saved URLs, and the public API keep working without a data migration; a report that *uses* an advanced filter refuses to render on a client too old to understand it, rather than drawing a wrong number (§4.1).

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

// Declared FIRST: the schemas below are built at module load and read these
// values eagerly inside `.max(...)`. Declaring them after the schemas would
// read a `const` still in its temporal dead zone and throw a ReferenceError
// the moment the module is imported.
export const FILTER_GROUP_MAX_CHILDREN = 20;
export const FILTER_GROUP_MAX_DEPTH = 2; // documentation constant; the depth limit is structural

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
- A flat array stays a valid implicit-AND group, so the AI filter agent (`packages/trpc/src/agents/filter-command.ts`) and the public API keep emitting `filters` and keep working unchanged.

### 4.1 A report that uses advanced filters must not render on an old client

There is deliberately **no** flattened mirror of the group into `filters`. A mirror can only ever be lossy — a root `OR`, a sub-group, or a `hasProperty` condition has no flat equivalent — and a lossy mirror means an old dashboard draws a **number that is wrong and looks right**. Silent wrong numbers are worse than a visible failure. The rule is therefore: a report whose filtering cannot be expressed as a flat AND list **refuses to render on any client that does not understand groups**.

A group is *flat-expressible* when its root `op` is `and`, it has no sub-group children, and no condition uses `hasProperty` / `missingProperty`. For a flat-expressible group, `filters` is written normally and `filterGroup` is omitted — nothing changes for anyone. Everything else is an **advanced report**, and is stored as:

```jsonc
{
  "schemaVersion": 2,                 // new: advanced-filter reports only
  "filterGroup": { /* the real filter */ },
  "filters": [
    { "name": "__advanced_filters__", "operator": "advancedFilterGroup", "value": [] }
  ]
}
```

Two independent trip wires, because either one alone fails:

1. **The sentinel in `filters`.** `operator: "advancedFilterGroup"` is not a member of the *old* `operators` enum, so an old client's `zChartEventFilter` parse **fails** on load. This is mechanical: it works even against a client that has never heard of `schemaVersion` and would have ignored it. `advancedFilterGroup` is added to `operators` in `packages/constants/index.ts` purely so that new clients can recognise the sentinel; it is never selectable in the operator dropdown and `compileEventFilter` throws if it ever reaches SQL compilation.
2. **`schemaVersion: 2`.** Explicit, greppable, and what the *server* checks. Every read path that loads a report (`reports.service.ts`) checks it before running any query: on `schemaVersion > 1` from a caller that did not declare group support, the tRPC procedure throws `PRECONDITION_FAILED` with the message *"This report uses advanced filters. Update to a newer dashboard version to view it."* The API refusing means the old client shows that exact sentence wherever it surfaces tRPC error text, rather than the generic zod parse error it would get from the sentinel alone.

Honest limit: an old client that renders a saved report entirely from its own cached copy, without a server round-trip, gets only trip wire 1 — a parse failure with a generic "could not load report" message, not the sentence above. It still refuses to draw numbers, which is the property that matters.

Scope of the refusal: the *report* refuses. Report lists, names, dashboards containing the report, and edit links keep working; only the chart and table area shows the message. Downgrading is possible at any time — clear the advanced filter and the report saves as a normal flat report again.

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

Which call sites convert, and when, is §10. Every call site that has not been converted keeps calling the array API, which is unchanged and still works.

### 5.3 The new operators

Property presence depends on where the property lives:

| Filter name | `hasProperty` | `missingProperty` | |
|---|---|---|---|
| Map-backed property (`properties.*`, `group.*`) | `properties['k'] != ''` | `properties['k'] = ''` | (`mapContains` is deliberately **not** used — see §5.4) |
| Top-level column (`country`, `path`, …) | `<col> IS NOT NULL AND <col> != ''` | `<col> IS NULL OR <col> = ''` | |
| Array column (wildcard path) | `arrayExists(x -> x != '', <expr>)` | `NOT arrayExists(x -> x != '', <expr>)` | |

Empty string counts as missing. ClickHouse `Map(String,String)` returns `''` for an absent key and the ingest path (`toDots`, `event.service.ts:386`) cannot distinguish "sent empty" from "not sent", so treating them alike is the only behaviour that is consistent between the two. It also means presence needs no `mapContains`, which §5.4 shows is actively unsafe for profile properties. This makes `hasProperty` / `missingProperty` exact complements — `missingProperty` is the negation of `hasProperty` for the same key, with no third state.

`missingProperty` is the operator users need now that T6 makes numeric comparisons skip missing values. Document that pairing in the operator dropdown help text.

### 5.4 Cross-scope groups and the profile-property CTE

An `OR` group may mix scopes — one branch on a profile property, the other on an event property. Proving that this compiles correctly is a precondition for A10 (the scope badge being cosmetic), because the profile side does **not** read from a plain Map at query time.

**The trap.** `chart.service.ts` narrows profile properties for memory reasons: `collectProfilePropertyKeys` collects every `profile.properties.<key>` reference, `profilePropertiesCteSelect` projects *only those keys* as scalar columns, and `rewriteProfilePropertyRefs` string-replaces `profile.properties['<key>']` with the scalar alias. When no wildcard reference forces `needsFullMap`, the CTE **does not select the `properties` Map at all**. Any clause that names the bare map — `mapContains(profile.properties, 'plan')` — is not matched by the rewrite (it contains no `['plan']` text), survives into the final SQL, and references a column that no longer exists. This is the failure T6 hit in PR #7.

**Rule that avoids it:** for `profile.properties.*`, presence is expressed **only through the `map['key']` form**, never through `mapContains` or any other bare-map function. Since §5.3 already defines an empty string as missing (A4), the `map['key']` form is sufficient:

| Operator | `properties.*` (events) | `profile.properties.*` |
|---|---|---|
| `hasProperty` | `e.properties['k'] != ''` | `profile.properties['k'] != ''` |
| `missingProperty` | `e.properties['k'] = ''` | `profile.properties['k'] = ''` |

This supersedes the `mapContains` form sketched in §5.3 for the profile case, and makes `mapContains` unnecessary for the events case too — one rule instead of two. The same rule binds T6's numeric fix: `toFloat64OrNull(profile.properties['k']) > toFloat64('5')` is safe; adding a `mapContains(profile.properties, 'k')` guard next to it would reintroduce the bug.

**Worked example.** Root group, `op: 'or'`:

```
OR ├─ profile.properties.plan   is            'pro'
   └─ properties.level_mode     hasProperty
```

`compileFilterGroup` emits, before rewriting:

```sql
(profile.properties['plan'] = 'pro' OR e.properties['level_mode'] != '')
```

`collectProfilePropertyKeys` sees one profile reference, so `keys = ['plan']`, `needsFullMap = false`, and the CTE is:

```sql
WITH profile AS (
  SELECT id as "profile.id",
         properties['plan'] as `profile.properties.plan`,
         ...
  FROM profiles FINAL WHERE project_id = 'p'
)
```

`rewriteProfilePropertyRefs(sql, ['plan'])` then yields the final WHERE:

```sql
... FROM events e
LEFT ANY JOIN profile ON profile.id = e.profile_id
WHERE project_id = 'p'
  AND (`profile.properties.plan` = 'pro' OR e.properties['level_mode'] != '')
```

Both branches resolve: the left against the CTE's scalar column, the right against the events Map. **Cross-scope OR is correct**, so the scope badge stays cosmetic (A10).

Three implementation obligations follow, all of them things the flat-array code gets for free and the group code does not:

1. **Scope detection must scan the flattened tree, not `event.filters`.** `chart.service.ts` decides whether to add the profile join with `event.filters.some(f => f.name.startsWith('profile.'))`, and feeds `collectProfilePropertyKeys([...event.filters, ...breakdowns, ...])`. With a group, the conditions are no longer in `event.filters`. Every such scan becomes `flattenConditions(resolveFilterGroup(event.filters, event.filterGroup))`. Missing this produces exactly the PR #7 symptom — a reference to a join or column that was never added. The same applies to the group-join detection (`group.` prefix) and the cohort CTE collection.
2. **`LEFT ANY JOIN` defaults, not NULLs.** An event whose profile has no row in the CTE reads `''` for every profile scalar. So `missingProperty` on a profile property is **true** for events with no profile at all, and inside an `OR` that widens the result set. This is the correct reading ("this event has no such profile property") but it is worth a line in the UI help text and a test.
3. **A wildcard profile reference anywhere in the group** (`profile.properties.*`) sets `needsFullMap`, the CTE keeps the Map, and the `map['key']` form still works — no special case needed. Test it anyway, since it is the branch where both shapes coexist.

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

**Focus and accessibility.** The canvas's `FilterControl` card fixes the focus treatment for every control in this panel: a 2px ring offset from the control (`outline: 2px solid #2266ec; outline-offset: 1px`), never a colour change on its own. The `AND` / `OR` toggles, the join words, the operator select and both footer buttons are keyboard-reachable and carry that ring.

**Below 1200px.** The canvas's `Toolbar · below 1200px` card puts the quick dimension chips (Platform, Version, Country, Event) *inside this same popover*: the toolbar collapses to one button labelled `All filters` whose badge counts every filter, dimension chips included (the card shows `6`). Search moves below the toolbar, full width. So the panel is not purely the advanced-filter editor at narrow widths — it also hosts the dimension selects, above the `Advanced filters` header. The dimension chips remain ordinary top-level AND conditions in the same root group; folding them in is a layout change, not a model change.

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
- Advanced report loaded by a client without group support: `PRECONDITION_FAILED`, "This report uses advanced filters. Update to a newer dashboard version to view it." The chart and table area shows that message; the report name, its dashboard and the edit link stay usable (§4.1).
- `advancedFilterGroup` reaching `compileEventFilter`: throws. It is a storage sentinel, never a real condition.
- Group with no compilable children: treated as no filter (see §5.2).
- `hasProperty` with an empty `name`: rejected by the UI; compiles to `null` server-side.
- Truncated / corrupt `fg` URL param: discarded, flat filters used, toast shown.

## 8. Testing

- `packages/validation`: a three-level group fails `zFilterGroup`; a flat array round-trips through `resolveFilterGroup` into an implicit-AND root; a flat-expressible group saves as plain `filters` with no `schemaVersion`, while a group with a sub-group / `or` root / `hasProperty` saves with `schemaVersion: 2` and the sentinel.
- `packages/validation`: the `advancedFilterGroup` sentinel fails the *previous* `zChartEventFilter` (pin the old operator list in the test so the trip wire cannot rot).
- `packages/trpc`: loading a `schemaVersion: 2` report as a caller without group support throws `PRECONDITION_FAILED` with the advanced-filters message, and does not execute a query.
- `packages/db`: unit tests on `compileFilterGroup` with a stub `compile` — AND/OR nesting parenthesisation, dropped child inside AND, dropped child inside OR, all-dropped group returning `null`.
- `packages/db`: SQL-shape tests for `hasProperty` / `missingProperty` on a map property, a top-level column and an array column; plus a test asserting `missingProperty` and `hasProperty` on the same key produce mutually exclusive clauses.
- `packages/db`: a regression test pinning the T6 interaction — a row with no `level` key matches `missingProperty` and does **not** match `level < 1`.
- `packages/db`: the §5.4 cross-scope case end to end — an `OR` of `profile.properties.plan is pro` and `properties.level_mode hasProperty` produces SQL whose profile branch is the rewritten scalar alias `` `profile.properties.plan` `` and whose CTE selects that column; assert the string `mapContains(profile.properties` never appears in any generated SQL.
- `packages/db`: the same group with a wildcard profile reference added sets `needsFullMap`, the CTE keeps `properties as "profile.properties"`, and the `map['key']` branch still resolves.
- `packages/db`: scope detection over a group — a `profile.*` condition buried in a sub-group still adds the profile join and still registers its key with `collectProfilePropertyKeys` (the PR #7 failure mode).
- `packages/db`: an Event Analytics query with a `properties.*` condition inside an `OR` group filters correctly. (That such a condition reaches the compiler at all is T10's test, not this spec's — see §10.)
- Existing `filter-where.test.ts` and the chart SQL tests must pass unchanged; that is the proof the §5.1 extraction was behaviour-preserving.
- Commands: `pnpm vitest run <path>`, `pnpm typecheck`. Never run `pnpm format` (project rule).

## 9. Assumptions

No user was reachable while writing this spec, so every open decision below was made here. Each lists the alternatives considered and why they lost.

**A1 — Two levels means root group + one level of sub-groups.**
Alternatives: (a) root is implicit and the two levels are both user-visible groups (three levels of parentheses in SQL); (b) a runtime depth counter over a recursive `z.lazy` schema. Chose the stated reading because it matches the design panel (one `AND`/`OR` header plus indented sub-blocks) and because a non-recursive schema makes the limit unrepresentable rather than merely validated.

**A2 — Additive `filterGroup` field, no data migration.**
Alternatives: (a) change `filters` to a union of array-or-group — breaks every existing consumer's types and the public API; (b) migrate saved report JSON in Postgres — irreversible, and a bad migration corrupts user reports for a feature they have not asked for yet. Additive is reversible: drop the field and everything still runs.

**A3 — RESOLVED by the project owner: no lossy mirror; old clients refuse to render.**
An earlier draft proposed mirroring the group into a narrower-or-equal flat `filters` array. Rejected on review: an old client would then draw numbers that are wrong and look right, with nothing to warn the user. Silent wrong numbers beat every alternative for damage. §4.1 replaces it with an explicit refusal — `schemaVersion: 2` checked by the server, plus an `advancedFilterGroup` sentinel that breaks the old client's own schema validation. No longer an assumption.

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

**A10 — RESOLVED by the project owner, conditional on proof: the scope badge is a derived label, not a constraint.**
The condition attached to the decision was that a cross-scope `OR` must be shown to compile to valid SQL, given that `rewriteProfilePropertyRefs` narrows profile properties to scalar CTE columns and drops the full Map. §5.4 carries that proof, plus the rule it depends on (`map['key']` form only for `profile.properties.*`, never `mapContains`) and the three implementation obligations it exposes — chief among them that scope detection must scan the flattened condition tree, not `event.filters`. Mixed groups are allowed; the badge is computed from the conditions and reads `MIXED` when they disagree.

**A11 — Panel edits are staged; `Apply filters` commits.**
The design's footer has an explicit `Apply filters` button, so the panel cannot be live-updating. Alternative: apply on every change and treat the button as a close affordance. Rejected — it would re-query ClickHouse on every keystroke in a value field.

**A12 — Chips act on the applied group and remove immediately.**
Alternative: make chip removal staged too. Rejected — the chips sit outside the panel and have no Apply button of their own, so staging them would leave no way to commit.

**A13 — The join word in the row gutter is the group-operator control.**
The design shows the join word (`AND` / `OR`) per row and describes the operator in the hint sentence, but shows no per-group toggle. Alternative: add a toggle to each group header mirroring the root's. Rejected — it adds chrome the design does not have; making the existing word clickable does not.

**A14 — Dimension chips fold into the same popover below 1200px, as plain root-level AND conditions.**
The design card mandates the folding but not the data model behind it. Alternative: keep dimension filters in a separate state and render them in the popover as a distinct section that never mixes with the group tree. Rejected — they are `is` conditions on `country` / `app_version` / event name, exactly what the root group already holds, and a second model would need its own AND/OR story.

## 10. Delivery phases

The group model touches the one function every report surface filters through. Converting all of them at once would be a diff nobody can review and a rollback that takes the whole product with it. Two phases:

### Phase 1 — Event Analytics only

Ships: the validation module (§3), `resolveFilterGroup` and the refusal mechanism (§4), the `compileEventFilter` / `compileTableFilter` extraction and `compileFilterGroup` walker (§5.1–5.2), the two new operators (§5.3), the profile-property rule (§5.4), and the panel UI (§6) mounted on the Event Analytics route only.

Converted call sites: the Event Analytics query path alone — `buildEventAnalyticsQuery` and the `eventAnalyticsList` / `eventAnalyticsTotals` / `eventPropertyKeys` / `eventPropertyValues` procedures from T1–T3.

**Dependency: T10 must land first.** `buildEventAnalyticsQuery` currently filters through `OverviewService.getRawWhereClause('events', filters)`, which **silently drops every filter whose name is not in `WHITELISTED_FILTERS`** (`overview.service.ts:34`) — no `properties.*`, no `profile.*`, no cohorts. The design's own sample conditions (`user.install_source`, `level_start.level_id`) are all in the dropped set, so Event Analytics cannot filter on them today at all, and a silent drop inside an `OR` group would **widen** the result (§5.2).

That replacement is **not** part of this spec. It is task **T10**, which runs right after Wave 1 merges and swaps `getRawWhereClause` for `getEventFiltersWhereClause` across the four event analytics functions, with tests proving a `properties.*` filter actually filters. Phase 1 here **assumes T10 has landed** and starts from the flat `getEventFiltersWhereClause` call it leaves behind, converting that call to the group compiler. Keeping the two apart means no two workers edit the same region of `overview.service.ts`.

Phase 1 is therefore blocked on T10. If T10 has not merged when Phase 1 starts, stop and report rather than doing T10's work inline.

Everything else in the product keeps its current flat-filter behaviour, byte for byte. `getEventFiltersWhereClause` and `buildFilterWhere` keep their signatures and their tests.

### Phase 2 — the rest of the product

A separate spec and separate PRs, one surface at a time, each adding `filterGroup` to that surface's input schema and its UI:

| Call site | File | Count |
|---|---|---|
| chart series + aggregate | `packages/db/src/services/chart.service.ts` | 2 |
| event list / breakdown | `packages/db/src/services/event.service.ts` | 3 |
| conversion A/B | `packages/db/src/services/conversion.service.ts` | 2 |
| funnel steps | `packages/db/src/services/funnel.service.ts` | 1 |
| sankey | `packages/db/src/services/sankey.service.ts` | 1 |
| retention | `packages/db/src/services/retention.service.ts` | 1 |
| overview widgets | `packages/db/src/services/overview.service.ts` | 1 (`getRawWhereClause`) |
| chart router | `packages/trpc/src/routers/chart.ts` | 1 |
| sessions | `packages/db/src/services/session.service.ts` | 3 (`buildFilterWhere`) |
| profiles | `packages/db/src/services/profile.service.ts` | 3 (`buildFilterWhere`) |
| cohorts | `packages/db/src/services/cohort.service.ts` | 1 (`buildFilterWhere`) |

Cohorts are the one to sequence last: `cohort.validation.ts` keeps its **own** copy of `zChartEventFilter` (with a comment explaining the cycle it avoids), so it needs the same copy-not-import treatment for `zFilterGroup`, and cohort criteria feed the `inCohort` filters that Phase 1 already compiles.

## 11. Decisions on the open questions

All six were answered by the project owner when the spec was approved. Recorded here so the implementation does not reopen them.

1. **A4 — empty string stays "missing". No.** `toDots` at ingest cannot tell "sent empty" from "not sent", so the stricter reading is not observable. `hasProperty` and `missingProperty` remain exact negations of each other, and §5.4's `map['key'] != ''` rule keeps working.
2. **`missingProperty` is not offered for cohort filters in Phase 1.** Cohorts move in Phase 2, in the order §10 gives.
3. **A13 — follow artboard `1c` exactly.** The clickable join word is the group-operator control. Do not add a per-group toggle the design does not have.
4. **A14 — below 1200px the folded chips stay locked to `is` selects**, as the wide toolbar renders them. No operator select inside a collapsed chip: narrow screens are where mis-taps happen, and the full panel is always one tap away.
5. **A11 — footer `Clear` clears the staged group only.** It never touches applied filters; the user always has a way back. `Clear all` on the chip row keeps its current behaviour.
6. **The `getRawWhereClause` replacement is T10's, not Phase 1's.** See §10.
