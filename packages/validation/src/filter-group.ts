import { z } from 'zod';

import { zChartEventFilter } from './chart-primitives';

/**
 * Condition tree for advanced filters: a root group plus at most one level of
 * sub-groups, combined with AND or OR.
 *
 * See docs/superpowers/specs/2026-09-15-event-analytics-advanced-filters-design.md §3.
 */

/**
 * Declared BEFORE the schemas below. `.max(...)` runs while this module loads,
 * so a constant declared after a schema that reads it would be accessed from
 * its temporal dead zone and throw a ReferenceError on the first import.
 */
export const FILTER_GROUP_MAX_CHILDREN = 20;

/**
 * Documentation only. The limit itself is structural: `zFilterSubGroup` accepts
 * conditions and nothing else, so a third level cannot be represented — no
 * runtime depth counter, and no payload can smuggle one past validation.
 */
export const FILTER_GROUP_MAX_DEPTH = 2;

export const zFilterCondition = z.object({
  kind: z.literal('condition'),
  id: z.string().optional(),
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

export type IChartEventFilterInput = z.infer<typeof zChartEventFilter>;
export type IFilterCondition = z.infer<typeof zFilterCondition>;
export type IFilterSubGroup = z.infer<typeof zFilterSubGroup>;
export type IFilterGroup = z.infer<typeof zFilterGroup>;
export type IFilterGroupChild = IFilterGroup['children'][number];

/**
 * Operators that ask about presence. They have no flat equivalent, so a group
 * using one is never expressible as a plain `filters` array.
 */
const PRESENCE_OPERATORS = new Set(['hasProperty', 'missingProperty']);

/**
 * The single place that decides which of the two wire shapes wins. A flat array
 * is a valid implicit-AND group, which is what keeps every existing caller,
 * saved report and API client working without a migration.
 */
export function resolveFilterGroup(
  filters: IChartEventFilterInput[] | undefined,
  group: IFilterGroup | undefined,
): IFilterGroup {
  if (group) {
    return group;
  }

  return {
    kind: 'group',
    op: 'and',
    children: (filters ?? []).map((filter) => ({
      kind: 'condition' as const,
      filter,
    })),
  };
}

/**
 * Every condition in the tree, in document order. Callers that scan filters to
 * decide query shape (which joins to add, which profile keys to project) must
 * scan this rather than the flat array, or a condition living inside a group
 * leaves the join it needs unwired.
 */
export function flattenConditions(
  group: IFilterGroup,
): IChartEventFilterInput[] {
  const conditions: IChartEventFilterInput[] = [];

  for (const child of group.children) {
    if (child.kind === 'condition') {
      conditions.push(child.filter);
      continue;
    }

    for (const nested of child.children) {
      conditions.push(nested.filter);
    }
  }

  return conditions;
}

/**
 * True when the group means exactly the same thing as a flat `filters` array.
 * Such a report saves in the old shape and stays readable by old clients;
 * anything else is an advanced report and must refuse to render on them.
 */
export function isFlatExpressible(group: IFilterGroup): boolean {
  if (group.op !== 'and') {
    return false;
  }

  return group.children.every(
    (child) =>
      child.kind === 'condition' &&
      !PRESENCE_OPERATORS.has(child.filter.operator),
  );
}
