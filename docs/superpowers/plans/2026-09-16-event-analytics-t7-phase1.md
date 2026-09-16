# Event Analytics Advanced Filters — Phase 1 Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use subagent dispatch in this environment.

**Goal:** Give Event Analytics an AND/OR condition tree (root group plus one level of sub-groups) with `hasProperty` / `missingProperty`, without changing the filtering behaviour of any other surface.

**Architecture:** A new leaf validation module owns the group schema, whose *shape* caps nesting at two levels. The existing per-filter SQL logic is extracted verbatim from `getEventFiltersWhereClause` / `buildFilterWhere` into `compileEventFilter` / `compileTableFilter`; a small tree walker composes those fragments with AND/OR. Only the Event Analytics query path and its UI are switched over to the walker.

**Tech Stack:** TypeScript, zod, ClickHouse SQL string building, tRPC, TanStack Router + React 19, vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-event-analytics-advanced-filters-design.md` (merged). Phase 1 scope is §10.

## Global Constraints

- Phase 1 only. Do **not** convert Phase 2 call sites (chart, funnel, conversion, sankey, retention, sessions, profiles, cohorts).
- `getEventFiltersWhereClause` and `buildFilterWhere` keep their exact signatures and behaviour. The existing tests are the proof; they must pass **unchanged**.
- Existing suites must stay green: `filter-where.test.ts`, `chart-sql.test.ts`, `event-analytics-filters.test.ts`, `event-analytics-sql.test.ts`, `event-property-keys-sql.test.ts`, `event-property-values-sql.test.ts`, `event-property-values-paging.test.ts`.
- Never emit `mapContains` for `profile.properties.*` (spec §5.4). Presence is `map['key'] != ''` / `= ''` everywhere.
- Empty string counts as missing (spec A4). `hasProperty` and `missingProperty` are exact negations.
- Never run `pnpm format`. Run `pnpm codegen` before any typecheck. Never commit `packages/geo/src/datacenter-asns.ts`.
- Typecheck narrow: `pnpm -F @openpanel/validation typecheck`, `-F @openpanel/db`, `-F @openpanel/trpc`. Full-repo typecheck at most once, at the end.
- T8 (fixtures + integration tests in `packages/db`) runs in parallel and does not touch product code. Any change to event analytics query output must be reported before merge.

---

### Task 1: Group schema and resolution

**Files:**
- Create: `packages/validation/src/filter-group.ts`
- Create: `packages/validation/src/filter-group.test.ts`
- Modify: `packages/validation/src/index.ts` (re-export)

**Interfaces:**
- Consumes: `zChartEventFilter` from `./chart-primitives`.
- Produces:
  - `FILTER_GROUP_MAX_CHILDREN: 20`, `FILTER_GROUP_MAX_DEPTH: 2`
  - `zFilterCondition`, `zFilterSubGroup`, `zFilterGroup`
  - `type IFilterGroup`, `type IFilterCondition`, `type IFilterGroupChild`
  - `resolveFilterGroup(filters: IChartEventFilter[] | undefined, group: IFilterGroup | undefined): IFilterGroup`
  - `flattenConditions(group: IFilterGroup): IChartEventFilter[]`
  - `isFlatExpressible(group: IFilterGroup): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  flattenConditions,
  isFlatExpressible,
  resolveFilterGroup,
  zFilterGroup,
} from './filter-group';

const cond = (name: string, operator = 'is') => ({
  kind: 'condition' as const,
  filter: { name, operator, value: ['x'] },
});

describe('zFilterGroup', () => {
  it('rejects a third level of nesting', () => {
    const threeLevels = {
      kind: 'group',
      op: 'and',
      children: [
        { kind: 'group', op: 'or', children: [{ kind: 'group', op: 'and', children: [] }] },
      ],
    };
    expect(zFilterGroup.safeParse(threeLevels).success).toBe(false);
  });

  it('accepts a root group holding one sub-group', () => {
    const twoLevels = {
      kind: 'group',
      op: 'or',
      children: [cond('country'), { kind: 'group', op: 'and', children: [cond('path')] }],
    };
    expect(zFilterGroup.safeParse(twoLevels).success).toBe(true);
  });
});

describe('resolveFilterGroup', () => {
  it('wraps a flat array into an implicit AND root', () => {
    const filters = [{ name: 'country', operator: 'is' as const, value: ['SE'] }];
    expect(resolveFilterGroup(filters, undefined)).toEqual({
      kind: 'group',
      op: 'and',
      children: [{ kind: 'condition', filter: filters[0] }],
    });
  });

  it('prefers the group and ignores the flat array', () => {
    const group = { kind: 'group' as const, op: 'or' as const, children: [cond('path')] };
    expect(resolveFilterGroup([{ name: 'country', operator: 'is', value: [] }], group)).toBe(group);
  });

  it('returns an empty AND root for no input', () => {
    expect(resolveFilterGroup(undefined, undefined)).toEqual({
      kind: 'group',
      op: 'and',
      children: [],
    });
  });
});

describe('flattenConditions', () => {
  it('returns conditions from the root and from sub-groups', () => {
    const group = {
      kind: 'group' as const,
      op: 'and' as const,
      children: [cond('country'), { kind: 'group' as const, op: 'or' as const, children: [cond('path')] }],
    };
    expect(flattenConditions(group).map((f) => f.name)).toEqual(['country', 'path']);
  });
});

describe('isFlatExpressible', () => {
  it('is true for an AND root of plain conditions', () => {
    expect(isFlatExpressible({ kind: 'group', op: 'and', children: [cond('country')] })).toBe(true);
  });

  it('is false for an OR root', () => {
    expect(isFlatExpressible({ kind: 'group', op: 'or', children: [cond('country')] })).toBe(false);
  });

  it('is false when a sub-group is present', () => {
    expect(
      isFlatExpressible({
        kind: 'group',
        op: 'and',
        children: [{ kind: 'group', op: 'and', children: [cond('path')] }],
      }),
    ).toBe(false);
  });

  it('is false when a presence operator is used', () => {
    expect(
      isFlatExpressible({
        kind: 'group',
        op: 'and',
        children: [cond('properties.level', 'hasProperty')],
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/validation/src/filter-group.test.ts`
Expected: FAIL — cannot resolve `./filter-group`.

- [ ] **Step 3: Write the implementation**

`packages/validation/src/filter-group.ts`. Constants go **before** the schemas: `.max(...)` is evaluated while the module loads, so a constant declared after the schema is read from its temporal dead zone and throws `ReferenceError` on import.

```ts
import { z } from 'zod';
import { type IChartEventFilter, zChartEventFilter } from './chart-primitives';

export const FILTER_GROUP_MAX_CHILDREN = 20;
export const FILTER_GROUP_MAX_DEPTH = 2;

export const zFilterCondition = z.object({
  kind: z.literal('condition'),
  id: z.string().optional(),
  filter: zChartEventFilter,
});

export const zFilterSubGroup = z.object({
  kind: z.literal('group'),
  id: z.string().optional(),
  op: z.enum(['and', 'or']),
  children: z.array(zFilterCondition).max(FILTER_GROUP_MAX_CHILDREN),
});

export const zFilterGroup = z.object({
  kind: z.literal('group'),
  id: z.string().optional(),
  op: z.enum(['and', 'or']),
  children: z
    .array(z.union([zFilterCondition, zFilterSubGroup]))
    .max(FILTER_GROUP_MAX_CHILDREN),
});

export type IFilterCondition = z.infer<typeof zFilterCondition>;
export type IFilterSubGroup = z.infer<typeof zFilterSubGroup>;
export type IFilterGroup = z.infer<typeof zFilterGroup>;
export type IFilterGroupChild = IFilterGroup['children'][number];

const PRESENCE_OPERATORS = new Set(['hasProperty', 'missingProperty']);

export function resolveFilterGroup(
  filters: IChartEventFilter[] | undefined,
  group: IFilterGroup | undefined,
): IFilterGroup {
  if (group) return group;
  return {
    kind: 'group',
    op: 'and',
    children: (filters ?? []).map((filter) => ({
      kind: 'condition' as const,
      filter,
    })),
  };
}

export function flattenConditions(group: IFilterGroup): IChartEventFilter[] {
  const out: IChartEventFilter[] = [];
  for (const child of group.children) {
    if (child.kind === 'condition') {
      out.push(child.filter);
      continue;
    }
    for (const nested of child.children) out.push(nested.filter);
  }
  return out;
}

export function isFlatExpressible(group: IFilterGroup): boolean {
  if (group.op !== 'and') return false;
  return group.children.every(
    (child) =>
      child.kind === 'condition' && !PRESENCE_OPERATORS.has(child.filter.operator),
  );
}
```

Re-export from `packages/validation/src/index.ts` next to the other `chart-primitives` re-exports.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/validation/src/filter-group.test.ts` then `pnpm -F @openpanel/validation typecheck`
Expected: PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/validation/src/filter-group.ts packages/validation/src/filter-group.test.ts packages/validation/src/index.ts
git commit -m "feat(validation): add two-level filter group schema"
```

---

### Task 2: Presence operators and the storage sentinel

**Files:**
- Modify: `packages/constants/index.ts`
- Modify: `packages/validation/src/filter-group.test.ts` (sentinel trip-wire test)

**Interfaces:**
- Produces: `operators.hasProperty`, `operators.missingProperty`, `operators.advancedFilterGroup`; `ADVANCED_FILTER_SENTINEL_NAME = '__advanced_filters__'`, `ADVANCED_FILTER_SCHEMA_VERSION = 2`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```ts
import { operators, operatorsShort, getOperatorsForType } from '@openpanel/constants';

describe('presence operators', () => {
  it('exposes has/missing property with labels', () => {
    expect(operators.hasProperty).toBe('Has property');
    expect(operators.missingProperty).toBe('Missing property');
    expect(operatorsShort.hasProperty).toBe('Has property');
  });

  it('keeps them out of the number operator list', () => {
    expect(getOperatorsForType('number')).not.toContain('hasProperty');
  });

  it('never offers the storage sentinel to the UI', () => {
    expect(getOperatorsForType('string')).not.toContain('advancedFilterGroup');
  });

  it('is rejected by the pre-group filter schema', () => {
    // Pinned copy of the operator list as it shipped before advanced filters.
    // If someone adds advancedFilterGroup to this list the trip wire is dead.
    const legacyOperators = [
      'is', 'isNot', 'contains', 'doesNotContain', 'startsWith', 'endsWith',
      'regex', 'isNull', 'isNotNull', 'gt', 'lt', 'gte', 'lte',
      'inCohort', 'notInCohort',
    ];
    expect(legacyOperators).not.toContain('advancedFilterGroup');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/validation/src/filter-group.test.ts`
Expected: FAIL — `operators.hasProperty` is `undefined`.

- [ ] **Step 3: Write the implementation**

In `packages/constants/index.ts`, add to `operators` and `operatorsShort`:

```ts
hasProperty: 'Has property',
missingProperty: 'Missing property',
// Storage sentinel, never selectable. Written into `filters` of a saved
// report that uses an advanced filter group so an old client's schema
// validation fails instead of silently rendering a narrower filter.
advancedFilterGroup: 'Advanced filter group',
```

Add `hasProperty` / `missingProperty` to `STRING_OPERATORS` only. Leave `advancedFilterGroup` out of every per-type list. Export:

```ts
export const ADVANCED_FILTER_SENTINEL_NAME = '__advanced_filters__';
export const ADVANCED_FILTER_SCHEMA_VERSION = 2;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/validation/src/filter-group.test.ts` and `pnpm -F @openpanel/constants typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/constants/index.ts packages/validation/src/filter-group.test.ts
git commit -m "feat(constants): add presence operators and advanced-filter sentinel"
```

---

### Task 3: Extract `compileEventFilter` (behaviour-preserving)

**Files:**
- Modify: `packages/db/src/services/chart.service.ts:1199+` (`getEventFiltersWhereClause`)

**Interfaces:**
- Produces: `compileEventFilter(filter, projectId, eventsAlias, tableScope): string | null`
- Consumes: nothing new.

- [ ] **Step 1: Run the existing suites first, and record the output**

Run: `pnpm vitest run packages/db/src/services/chart-sql.test.ts packages/db/src/services/filter-where.test.ts packages/db/src/services/numeric-filter-sql.test.ts packages/db/src/services/event-analytics-filters.test.ts`
Expected: PASS. This is the baseline the extraction must reproduce exactly.

- [ ] **Step 2: Move the `forEach` body into a function**

Signature:

```ts
export function compileEventFilter(
  filter: IChartEventFilter,
  projectId: string | undefined,
  eventsAlias: string | undefined,
  tableScope: 'events' | 'sessions' = 'events',
): string | null
```

Mechanical rules for the move: every `return;` inside the old `forEach` body becomes `return null;`; every `where[id] = X;` becomes `return X;`. No clause text changes. `getEventFiltersWhereClause` becomes:

```ts
export function getEventFiltersWhereClause(
  filters: IChartEventFilter[],
  projectId?: string,
  eventsAlias?: string,
  tableScope: 'events' | 'sessions' = 'events',
) {
  const where: Record<string, string> = {};
  filters.forEach((filter, index) => {
    const clause = compileEventFilter(filter, projectId, eventsAlias, tableScope);
    if (clause !== null) where[`f${index}`] = clause;
  });
  return where;
}
```

Note the one thing that must **not** change: `getEventFiltersWhereClause` does not wrap fragments in parentheses today. Keep it that way — wrapping is the walker's job (Task 5).

- [ ] **Step 3: Re-run the same suites**

Run: the Step 1 command, unchanged.
Expected: PASS, identical. If any test changed, the extraction was not verbatim — revert and redo.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/services/chart.service.ts
git commit -m "refactor(db): extract compileEventFilter from getEventFiltersWhereClause"
```

---

### Task 4: Extract `compileTableFilter`

**Files:**
- Modify: `packages/db/src/services/filter-where.service.ts:328+` (`buildFilterWhere`)

**Interfaces:**
- Produces: `compileTableFilter(filter: IChartEventFilter, projectId: string, ctx: FilterTableContext): string | null` — already parenthesised, matching today's `set()` helper.

- [ ] **Step 1: Run the existing suite and record the output**

Run: `pnpm vitest run packages/db/src/services/filter-where.test.ts packages/db/src/services/cohort-property-sql.test.ts`
Expected: PASS.

- [ ] **Step 2: Lift the dispatch out of the `forEach`**

```ts
export function compileTableFilter(
  filter: IChartEventFilter,
  projectId: string,
  ctx: FilterTableContext,
): string | null {
  const clause = (() => {
    if (filter.operator === 'inCohort' || filter.operator === 'notInCohort')
      return buildCohortClause(filter, projectId, ctx);
    if (filter.name.startsWith('cohort:')) return buildCohortClause(filter, projectId, ctx);
    if (filter.name.startsWith('group.')) return buildGroupClause(filter, projectId, ctx);
    if (filter.name.startsWith('profile.')) return buildProfileClause(filter, projectId, ctx);
    if (filter.name.startsWith('session.')) return buildSessionClause(filter, projectId, ctx);
    // properties.* only make sense on the events table; ignored elsewhere.
    return null;
  })();
  return clause ? `(${clause})` : null;
}
```

`buildFilterWhere` becomes a loop over it, keeping its `f${index}` keys.

- [ ] **Step 3: Re-run the same suite**

Run: the Step 1 command.
Expected: PASS, identical.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/services/filter-where.service.ts
git commit -m "refactor(db): extract compileTableFilter from buildFilterWhere"
```

---

### Task 5: The tree walker

**Files:**
- Create: `packages/db/src/services/filter-group.service.ts`
- Create: `packages/db/src/services/filter-group-sql.test.ts`

**Interfaces:**
- Consumes: `IFilterGroup` (Task 1).
- Produces:
  - `compileFilterGroup(group: IFilterGroup, compile: (f: IChartEventFilter) => string | null): string | null`
  - `getFilterGroupWhere(group, compile): Record<string, string>` — `{}` or `{ fgroup: clause }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { compileFilterGroup } from './filter-group.service';

const cond = (name: string) => ({ kind: 'condition' as const, filter: { name, operator: 'is' as const, value: ['1'] } });
// Stub compiler: a filter named `drop` contributes nothing.
const compile = (f: { name: string }) => (f.name === 'drop' ? null : `${f.name} = 1`);

describe('compileFilterGroup', () => {
  it('joins root conditions with AND and parenthesises each fragment', () => {
    expect(compileFilterGroup({ kind: 'group', op: 'and', children: [cond('a'), cond('b')] }, compile))
      .toBe('((a = 1) AND (b = 1))');
  });

  it('joins with OR when the root says so', () => {
    expect(compileFilterGroup({ kind: 'group', op: 'or', children: [cond('a'), cond('b')] }, compile))
      .toBe('((a = 1) OR (b = 1))');
  });

  it('nests a sub-group as one fragment', () => {
    const group = {
      kind: 'group' as const,
      op: 'and' as const,
      children: [cond('a'), { kind: 'group' as const, op: 'or' as const, children: [cond('b'), cond('c')] }],
    };
    expect(compileFilterGroup(group, compile)).toBe('((a = 1) AND ((b = 1) OR (c = 1)))');
  });

  it('drops a child that compiles to null inside AND', () => {
    expect(compileFilterGroup({ kind: 'group', op: 'and', children: [cond('a'), cond('drop')] }, compile))
      .toBe('((a = 1))');
  });

  it('drops a child that compiles to null inside OR', () => {
    expect(compileFilterGroup({ kind: 'group', op: 'or', children: [cond('a'), cond('drop')] }, compile))
      .toBe('((a = 1))');
  });

  it('drops a sub-group whose children all dropped', () => {
    const group = {
      kind: 'group' as const,
      op: 'and' as const,
      children: [cond('a'), { kind: 'group' as const, op: 'or' as const, children: [cond('drop')] }],
    };
    expect(compileFilterGroup(group, compile)).toBe('((a = 1))');
  });

  it('returns null, never 1 = 0, when everything dropped', () => {
    expect(compileFilterGroup({ kind: 'group', op: 'and', children: [cond('drop')] }, compile)).toBeNull();
  });

  it('returns null for an empty group', () => {
    expect(compileFilterGroup({ kind: 'group', op: 'and', children: [] }, compile)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/db/src/services/filter-group-sql.test.ts`
Expected: FAIL — cannot resolve `./filter-group.service`.

- [ ] **Step 3: Write the implementation**

```ts
import type { IChartEventFilter, IFilterGroup } from '@openpanel/validation';

type Compile = (filter: IChartEventFilter) => string | null;

function join(fragments: string[], op: 'and' | 'or'): string | null {
  if (fragments.length === 0) return null;
  return `(${fragments.map((f) => `(${f})`).join(op === 'and' ? ' AND ' : ' OR ')})`;
}

export function compileFilterGroup(group: IFilterGroup, compile: Compile): string | null {
  const fragments: string[] = [];
  for (const child of group.children) {
    if (child.kind === 'condition') {
      const clause = compile(child.filter);
      if (clause) fragments.push(clause);
      continue;
    }
    const nested = child.children
      .map((c) => compile(c.filter))
      .filter((c): c is string => c !== null);
    const sub = join(nested, child.op);
    if (sub) fragments.push(sub);
  }
  return join(fragments, group.op);
}

export function getFilterGroupWhere(group: IFilterGroup, compile: Compile) {
  const clause = compileFilterGroup(group, compile);
  return clause ? { fgroup: clause } : {};
}
```

Note the double parenthesisation in the expected strings: `join` wraps each fragment *and* the whole list. A nested sub-group arrives already wrapped, so it reads `((b = 1) OR (c = 1))` inside an outer `(...)`. Redundant parentheses are harmless in ClickHouse and make the precedence impossible to get wrong.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/db/src/services/filter-group-sql.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/services/filter-group.service.ts packages/db/src/services/filter-group-sql.test.ts
git commit -m "feat(db): add the AND/OR filter group walker"
```

---

### Task 6: `hasProperty` / `missingProperty` SQL

**Files:**
- Modify: `packages/db/src/services/chart.service.ts` (`compileEventFilter`)
- Modify: `packages/db/src/services/filter-where.service.ts` (`compileScalarClause`)
- Create: `packages/db/src/services/presence-filter-sql.test.ts`

**Interfaces:** no new exports.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { compileEventFilter, getEventFiltersWhereClause } from './chart.service';

const f = (name: string, operator: 'hasProperty' | 'missingProperty') => ({ name, operator, value: [] });

describe('presence operators', () => {
  it('uses the map lookup form for an event property, never mapContains', () => {
    const clause = compileEventFilter(f('properties.level_mode', 'hasProperty'), 'p', 'e', 'events');
    expect(clause).toBe(`e.properties['level_mode'] != ''`);
    expect(clause).not.toContain('mapContains');
  });

  it('uses the map lookup form for a profile property, never mapContains', () => {
    const clause = compileEventFilter(f('profile.properties.plan', 'hasProperty'), 'p', 'e', 'events');
    expect(clause).toBe(`profile.properties['plan'] != ''`);
    expect(clause).not.toContain('mapContains');
  });

  it('negates exactly for missingProperty', () => {
    expect(compileEventFilter(f('properties.level_mode', 'missingProperty'), 'p', 'e', 'events'))
      .toBe(`e.properties['level_mode'] = ''`);
  });

  it('handles a top-level column', () => {
    expect(compileEventFilter(f('country', 'hasProperty'), 'p', 'e', 'events'))
      .toBe(`(country IS NOT NULL AND country != '')`);
    expect(compileEventFilter(f('country', 'missingProperty'), 'p', 'e', 'events'))
      .toBe(`(country IS NULL OR country = '')`);
  });

  it('handles a wildcard array path with arrayExists', () => {
    const clause = compileEventFilter(f('properties.items.*.sku', 'hasProperty'), 'p', 'e', 'events');
    expect(clause).toContain('arrayExists');
    expect(clause).toContain(`x != ''`);
  });

  it('ignores an empty property name', () => {
    expect(compileEventFilter(f('', 'hasProperty'), 'p', 'e', 'events')).toBeNull();
  });

  it('throws if the storage sentinel reaches SQL compilation', () => {
    expect(() =>
      compileEventFilter({ name: '__advanced_filters__', operator: 'advancedFilterGroup' as never, value: [] }, 'p', 'e', 'events'),
    ).toThrow(/sentinel/i);
  });

  it('keeps missing values out of a numeric comparison (T6 pairing)', () => {
    const where = getEventFiltersWhereClause(
      [{ name: 'properties.level', operator: 'lt', value: ['1'] }],
      'p',
      'e',
    );
    const sql = Object.values(where).join(' AND ');
    expect(sql).toContain('toFloat64OrNull');
    expect(sql).not.toContain('toFloat64OrZero');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/db/src/services/presence-filter-sql.test.ts`
Expected: FAIL — presence operators fall through to the default branch and return `null`.

- [ ] **Step 3: Write the implementation**

In `compileEventFilter`, before the `value.length === 0` early return (presence operators legitimately carry no values), handle:

```ts
if (operator === 'advancedFilterGroup') {
  throw new Error(
    'advancedFilterGroup is a storage sentinel and must never reach SQL compilation',
  );
}

if (operator === 'hasProperty' || operator === 'missingProperty') {
  if (!name) return null;
  const has = operator === 'hasProperty';
  const expr = getSelectPropertyKey(name, eventsAlias, tableScope);
  if (name.includes('*')) {
    return has
      ? `arrayExists(x -> x != '', ${expr})`
      : `NOT arrayExists(x -> x != '', ${expr})`;
  }
  // Map-backed keys render as `map['key']`, which is the ONLY form safe for
  // profile.properties.*: the profile CTE narrows those to scalar columns and
  // drops the Map, so mapContains(profile.properties, ...) would reference a
  // column that no longer exists. See spec §5.4.
  if (expr.includes('[')) {
    return has ? `${expr} != ''` : `${expr} = ''`;
  }
  return has
    ? `(${expr} IS NOT NULL AND ${expr} != '')`
    : `(${expr} IS NULL OR ${expr} = '')`;
}
```

Mirror the same block in `compileScalarClause` in `filter-where.service.ts` for the sessions / profiles tables (top-level column form only — that file never sees a map).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/db/src/services/presence-filter-sql.test.ts packages/db/src/services/filter-where.test.ts packages/db/src/services/chart-sql.test.ts`
Expected: PASS everywhere; the two existing suites unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/services/chart.service.ts packages/db/src/services/filter-where.service.ts packages/db/src/services/presence-filter-sql.test.ts
git commit -m "feat(db): compile hasProperty and missingProperty without mapContains"
```

---

### Task 7: Prove the profile-property form survives CTE narrowing

**Decision D2 (settled):** `chart.service.ts` keeps `compileEventFilter` and the presence operators, because §5.4's proof lives there, but its own call sites (`getChartSql`, `getChartSqlAggregate`) are **not** switched to the group compiler in Phase 1. Every surface outside Event Analytics keeps its behaviour byte for byte; `filter-where.test.ts` and `chart-sql.test.ts` passing unchanged is the proof. The `getChartSql` switch, and the end-to-end cross-scope SQL test that needs it, move to Phase 2.

What Phase 1 can still prove without that switch: the clause text `compileEventFilter` emits for a profile property is exactly the text `rewriteProfilePropertyRefs` knows how to rewrite. That is the whole of the PR #7 failure — a clause naming the bare Map is not rewritten and then references a dropped column.

**Files:**
- Create: `packages/db/src/services/profile-property-presence.test.ts`

**Interfaces:** consumes `compileEventFilter` (Task 3), `rewriteProfilePropertyRefs` and `collectProfilePropertyKeys` (existing).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  collectProfilePropertyKeys,
  compileEventFilter,
  rewriteProfilePropertyRefs,
} from './chart.service';

describe('profile property presence survives CTE narrowing', () => {
  it('emits a clause the rewrite can retarget to the scalar alias', () => {
    const filter = {
      name: 'profile.properties.plan',
      operator: 'hasProperty' as const,
      value: [],
    };

    const clause = compileEventFilter(filter, 'p', 'e', 'events');
    expect(clause).toBe(`profile.properties['plan'] != ''`);

    const { keys, needsFullMap } = collectProfilePropertyKeys([filter]);
    expect(keys).toEqual(['plan']);
    expect(needsFullMap).toBe(false);

    // The CTE drops the Map when needsFullMap is false, so the clause MUST be
    // rewritten to the scalar column or it references a column that is gone.
    expect(rewriteProfilePropertyRefs(clause!, keys)).toBe(
      "`profile.properties.plan` != ''",
    );
  });

  it('never emits mapContains for a profile property', () => {
    for (const operator of ['hasProperty', 'missingProperty', 'gt', 'is'] as const) {
      const clause = compileEventFilter(
        { name: 'profile.properties.plan', operator, value: ['1'] },
        'p',
        'e',
        'events',
      );
      expect(clause ?? '').not.toContain('mapContains(profile.properties');
    }
  });

  it('cross-scope OR fragments each rewrite independently', () => {
    const profileClause = compileEventFilter(
      { name: 'profile.properties.plan', operator: 'is', value: ['pro'] },
      'p',
      'e',
      'events',
    );
    const eventClause = compileEventFilter(
      { name: 'properties.level_mode', operator: 'hasProperty', value: [] },
      'p',
      'e',
      'events',
    );

    const combined = `((${profileClause}) OR (${eventClause}))`;
    const rewritten = rewriteProfilePropertyRefs(combined, ['plan']);

    expect(rewritten).toContain('`profile.properties.plan` =');
    expect(rewritten).toContain(`e.properties['level_mode'] != ''`);
    expect(rewritten).not.toContain('mapContains(profile.properties');
  });
});
```

- [ ] **Step 2: Run it and watch it fail** — `pnpm vitest run packages/db/src/services/profile-property-presence.test.ts`. Expected FAIL until Task 6 lands the presence branch.

- [ ] **Step 3:** no implementation of its own; Task 6 makes it pass.

- [ ] **Step 4: Run it plus the untouched suites**

Run: `pnpm vitest run packages/db/src/services/profile-property-presence.test.ts packages/db/src/services/chart-sql.test.ts packages/db/src/services/filter-where.test.ts`
Expected: PASS, the latter two unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/services/profile-property-presence.test.ts
git commit -m "test(db): pin the profile property presence form against CTE narrowing"
```

---

### Task 8: Event Analytics query path

**Files:**
- Modify: `packages/validation/src/event-analytics.ts` (`zEventAnalyticsRange` gains `filterGroup`)
- Modify: `packages/db/src/services/overview.service.ts` (`getEventAnalyticsWhereClause`, `buildEventAnalyticsQuery`, `eventAnalyticsBaseQuery`)
- Create: `packages/db/src/services/event-analytics-group-sql.test.ts`

**Interfaces:** `getEventAnalyticsWhereClause(filters, projectId, filterGroup?)` — returns the same joined string it does today when `filterGroup` is absent.

- [ ] **Step 1: Write the failing test**

```ts
describe('event analytics group filters', () => {
  it('emits an OR between two property conditions', () => {
    const sql = buildEventAnalyticsQuery({
      projectId: 'p', filters: [], timezone: 'UTC',
      startDate: '2026-09-01 00:00:00', endDate: '2026-09-07 00:00:00',
      filterGroup: {
        kind: 'group', op: 'or',
        children: [
          { kind: 'condition', filter: { name: 'properties.level_mode', operator: 'is', value: ['hard'] } },
          { kind: 'condition', filter: { name: 'properties.level_id', operator: 'hasProperty', value: [] } },
        ],
      },
    }).toSQL();
    expect(sql).toContain(' OR ');
    expect(sql).toContain(`properties['level_mode']`);
    expect(sql).toContain(`properties['level_id'] != ''`);
  });

  it('is byte-identical to today when no group is supplied', () => {
    const base = { projectId: 'p', timezone: 'UTC', startDate: '2026-09-01 00:00:00', endDate: '2026-09-07 00:00:00' };
    const filters = [{ name: 'properties.level_mode', operator: 'is' as const, value: ['hard'] }];
    expect(buildEventAnalyticsQuery({ ...base, filters }).toSQL())
      .toBe(buildEventAnalyticsQuery({ ...base, filters, filterGroup: undefined }).toSQL());
  });
});
```

Check the real `toSQL()` accessor in `event-analytics-filters.test.ts` and match it.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/db/src/services/event-analytics-group-sql.test.ts`
Expected: FAIL — `filterGroup` is not accepted.

- [ ] **Step 3: Write the implementation**

`getEventAnalyticsWhereClause` takes an optional group, resolves it, applies its existing per-filter name rewrites (`utm_*` → `properties.__query.utm_*`, drop `profile.properties.*`) inside the `compile` callback rather than up front, and returns `compileFilterGroup(...) ?? ''`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/db/src/services/event-analytics-group-sql.test.ts packages/db/src/services/event-analytics-filters.test.ts packages/db/src/services/event-analytics-sql.test.ts packages/db/src/services/event-property-keys-sql.test.ts packages/db/src/services/event-property-values-sql.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/validation/src/event-analytics.ts packages/db/src/services/overview.service.ts packages/db/src/services/event-analytics-group-sql.test.ts
git commit -m "feat(db): filter event analytics through the group compiler"
```

---

### Task 9: tRPC wiring and the old-client refusal

**Files:**
- Modify: `packages/trpc/src/routers/overview.ts` (the four event analytics procedures)
- Modify: `packages/db/src/services/reports.service.ts` (schemaVersion guard)
- Create: `packages/trpc/src/routers/advanced-filter-refusal.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('refuses a schemaVersion 2 report for a caller without group support', async () => {
  await expect(loadReport({ ...report, schemaVersion: 2 }, { supportsFilterGroups: false }))
    .rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'This report uses advanced filters. Update to a newer dashboard version to view it.',
    });
});

it('does not run a query when it refuses', async () => {
  const spy = vi.fn();
  await loadReport({ ...report, schemaVersion: 2 }, { supportsFilterGroups: false, run: spy }).catch(() => {});
  expect(spy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/trpc/src/routers/advanced-filter-refusal.test.ts`
Expected: FAIL — no guard exists.

- [ ] **Step 3: Write the implementation**

Guard in `reports.service.ts`, thrown as `TRPCError({ code: 'PRECONDITION_FAILED' })` at the router boundary, before any ClickHouse call. Pass `filterGroup` through the four event analytics procedures into the service inputs.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/trpc/src/routers/advanced-filter-refusal.test.ts packages/db/src/services/reports.service.test.ts` and `pnpm -F @openpanel/trpc typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/src/routers/overview.ts packages/db/src/services/reports.service.ts packages/trpc/src/routers/advanced-filter-refusal.test.ts
git commit -m "feat(trpc): pass filter groups through and refuse advanced reports on old clients"
```

---

### Task 10: The Advanced filters panel

**Files:**
- Create: `apps/start/src/components/event-analytics/advanced-filters-panel.tsx`
- Create: `apps/start/src/components/event-analytics/advanced-filters-panel.test.tsx`
- Modify: `apps/start/src/routes/_app.$organizationId.$projectId.events._tabs.analytics.tsx`
- Modify: `apps/start/src/hooks/use-event-query-filters.ts` (the `fg` param)

**Decision D1 (settled):** the Phase 1 panel offers `['event', 'group', 'cohort']` only — **no profile category**. `getEventAnalyticsWhereClause` drops `profile.properties.*` because Event Analytics has no profile CTE join, and a silent drop inside an `OR` widens the result. The design's `user.*` rows wait for Phase 2.

The same PR also closes the **pre-existing** version of this bug: the route renders `OverviewFilterButton` with no category restriction, so `PropertiesCombobox` offers profile properties today and those filters are silently dropped inside an implicit AND, narrowing the numbers. Add a category-restriction prop to `OverviewFilterButton` / the `OverviewFilters` modal, default unchanged so no other route is affected, and pass `['event', 'group', 'cohort']` from the analytics route.

Layout is spec §6, which is read from artboard `1c`: 600px popover; header `Advanced filters` + `Match` + root AND/OR toggle; flat list of group cards carrying `level` and `indent: 22px`; 34px monospace join column whose word is the group-operator control; 118px operator field; `+ Condition` and a **disabled** `+ Nested group` at level 2 with `title="Nesting is limited to two levels"` and a `Max 2 nesting levels` note; footer `Applies to chart and table` / `Clear` (staged only) / `Apply filters`; 2px offset focus ring on every control.

- [ ] **Step 1: Write the failing test** — render the panel with a two-level group and assert: the level-2 `+ Nested group` button is disabled and carries the title; clicking a join word flips that group's operator; `Apply filters` is disabled while a condition has an operator needing values and an empty value list; `Clear` does not change the applied group.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Build the panel** against `PureFilterItem` / `PureCohortFilterItem` and `PropertiesCombobox`; no new dependencies.
- [ ] **Step 4: Run the test plus `pnpm -F @openpanel/start typecheck`.**
- [ ] **Step 5: Commit.**

---

### Task 11: Final verification

- [ ] `pnpm codegen`
- [ ] `git status` — confirm `packages/geo/src/datacenter-asns.ts` is **not** staged
- [ ] `pnpm vitest run packages/db packages/validation packages/trpc` — read **both** the `Test Files` and the `Tests` line; report any skipped test
- [ ] `pnpm -F @openpanel/validation typecheck && pnpm -F @openpanel/db typecheck && pnpm -F @openpanel/trpc typecheck`
- [ ] Push `phase1-backend` (Tasks 1-9), open PR against `feature/event-analytics`, do not merge
- [ ] Branch `phase1-ui` from it for Task 10, PR against `phase1-backend`
- [ ] After the backend PR merges: retarget the UI PR to `feature/event-analytics`, rebase, and **verify the PR diff contains only the UI commits** — a retarget that swallows the backend commits is the failure T5 hit

---

## Decisions (settled before implementation)

**D1 — SETTLED: option (a).** Phase 1 panel offers `['event', 'group', 'cohort']`; the same PR restricts the existing analytics toolbar the same way, killing the pre-existing silent-narrowing bug. No profile CTE join in Phase 1 (option b), no explicit error (option c).

Original analysis:
`getEventAnalyticsWhereClause` (added by T10) **drops** every `profile.properties.*` filter, because the event analytics queries have no profile CTE join. T10's own comment says this is only safe while the UI does not offer profile properties there. It already does: the route renders `OverviewFilterButton` with no `mode`, which gives `PropertiesCombobox` the categories `['event', 'profile', 'group', 'cohort']`. Today that is a silent narrowing bug inside an implicit AND. With OR groups it becomes a silent **widening** bug, which spec §5.2 calls out as the one thing the design must prevent. Options: (a) Phase 1 panel offers `['event', 'group', 'cohort']` only, no profile — smallest, and the design's `user.*` rows wait for Phase 2; (b) add the profile CTE join to the event analytics queries — touches T10's code and T8's fixtures; (c) compile profile conditions to an explicit error instead of dropping them. Recommendation: (a).

**D2 — SETTLED:** keep the extraction and the presence operators in `chart.service.ts`; do **not** switch `getChartSql` to the group compiler in Phase 1. Task 7 rewritten accordingly.

Original analysis:
It edits `chart.service.ts`, which §10 assigns to Phase 2, but §5.4's correctness proof lives exactly there and Task 8 reuses `compileEventFilter` from it. Options: (a) keep Task 7, accepting that `chart.service.ts` gains group support ahead of the rest of Phase 2; (b) drop Task 7 from this PR and let the chart keep reading `event.filters`, deferring the cross-scope tests to Phase 2. Recommendation: (a) for the extraction and the presence operators, (b) for the `getChartSql` call-site switch — that is, keep `chart.service.ts` compiling groups but leave its own callers on the flat array until Phase 2.

**D3 — SETTLED:** two stacked PRs, backend merges first, then the UI PR is retargeted and rebased with a diff check.

Original analysis:
Tasks 1–9 are backend and self-contained; Task 10 is a whole UI panel. Recommendation: two stacked PRs — `phase1-backend` (Tasks 1–9) against `feature/event-analytics`, then `phase1-ui` (Task 10) against the first.
