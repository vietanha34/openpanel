import { operatorsShort } from '@openpanel/constants';
import type {
  IChartEventFilter,
  IFilterGroup,
  IFilterSubGroup,
} from '@openpanel/validation';

/**
 * Pure state helpers for the Advanced filters panel. The panel itself only
 * renders; everything that can be reasoned about without a DOM lives here, the
 * way `tree-utils.ts` serves the tree table.
 *
 * Layout constants come from the design's artboard `1c`.
 */

/** Sub-groups sit one step in, matching the tree table's own indentation. */
export const SUB_GROUP_INDENT = 22;

/** Operators that carry no value, so an empty value list is not an error. */
const VALUELESS_OPERATORS = new Set([
  'isNull',
  'isNotNull',
  'hasProperty',
  'missingProperty',
]);

export type FilterGroupRow = {
  /** Empty on the first row, the group's operator on every later one. */
  join: '' | 'AND' | 'OR';
  condition: IChartEventFilter;
  id: string;
};

export type FilterGroupCard = {
  /** null addresses the root group. */
  id: string | null;
  op: 'and' | 'or';
  level: 1 | 2;
  indent: number;
  scope: string;
  hint: string;
  rows: FilterGroupRow[];
};

export function emptyGroup(): IFilterGroup {
  return { kind: 'group', op: 'and', children: [] };
}

/** Wording from the design; it is the only place the operator is spelled out. */
function hintFor(op: 'and' | 'or') {
  return op === 'and'
    ? 'All conditions must match'
    : 'Any condition may match';
}

export function scopeOf(
  children: { filter: IChartEventFilter }[],
): 'EVENT PROPERTY' | 'USER PROPERTY' | 'MIXED' | 'CONDITIONS' {
  let user = false;
  let event = false;

  for (const child of children) {
    if (child.filter.name.startsWith('profile.')) {
      user = true;
    } else {
      event = true;
    }
  }

  if (user && event) return 'MIXED';
  if (user) return 'USER PROPERTY';
  if (event) return 'EVENT PROPERTY';
  return 'CONDITIONS';
}

function rowsOf(
  children: { id?: string; filter: IChartEventFilter }[],
  op: 'and' | 'or',
): FilterGroupRow[] {
  const join = op === 'and' ? 'AND' : 'OR';

  return children.map((child, index) => ({
    join: index === 0 ? '' : join,
    condition: child.filter,
    id: child.id ?? child.filter.id ?? child.filter.name,
  }));
}

/**
 * The design renders the tree as a flat, ordered list of group cards, each
 * carrying its own level and indent, rather than as nested markup.
 */
export function flattenGroups(group: IFilterGroup): FilterGroupCard[] {
  const conditions = group.children.filter(
    (child): child is Extract<typeof child, { kind: 'condition' }> =>
      child.kind === 'condition',
  );

  const cards: FilterGroupCard[] = [
    {
      id: null,
      op: group.op,
      level: 1,
      indent: 0,
      scope: scopeOf(conditions),
      hint: hintFor(group.op),
      rows: rowsOf(conditions, group.op),
    },
  ];

  for (const child of group.children) {
    if (child.kind !== 'group') continue;

    cards.push({
      id: child.id ?? null,
      op: child.op,
      level: 2,
      indent: SUB_GROUP_INDENT,
      scope: scopeOf(child.children),
      hint: hintFor(child.op),
      rows: rowsOf(child.children, child.op),
    });
  }

  return cards;
}

/**
 * Level 2 is the last one. The design still renders the button there, disabled
 * with a tooltip, so the limit teaches itself instead of leaving the user
 * wondering where the option went.
 */
export function canAddSubGroup(level: 1 | 2): boolean {
  return level === 1;
}

function mapSubGroup(
  group: IFilterGroup,
  id: string,
  update: (subGroup: IFilterSubGroup) => IFilterSubGroup,
): IFilterGroup {
  return {
    ...group,
    children: group.children.map((child) =>
      child.kind === 'group' && child.id === id ? update(child) : child,
    ),
  };
}

export function addSubGroup(group: IFilterGroup): IFilterGroup {
  return {
    ...group,
    children: [
      ...group.children,
      {
        kind: 'group',
        id: `g${group.children.length + 1}-${Date.now()}`,
        op: 'or',
        children: [],
      },
    ],
  };
}

export function addCondition(
  group: IFilterGroup,
  groupId: string | null,
  name: string,
): IFilterGroup {
  const condition = {
    kind: 'condition' as const,
    id: name,
    filter: { id: name, name, operator: 'is' as const, value: [] },
  };

  if (groupId === null) {
    return { ...group, children: [...group.children, condition] };
  }

  return mapSubGroup(group, groupId, (subGroup) => ({
    ...subGroup,
    children: [...subGroup.children, condition],
  }));
}

export function setGroupOp(
  group: IFilterGroup,
  groupId: string | null,
  op: 'and' | 'or',
): IFilterGroup {
  if (groupId === null) {
    return { ...group, op };
  }

  return mapSubGroup(group, groupId, (subGroup) => ({ ...subGroup, op }));
}

const conditionId = (child: { id?: string; filter: IChartEventFilter }) =>
  child.id ?? child.filter.id ?? child.filter.name;

export function updateCondition(
  group: IFilterGroup,
  id: string,
  filter: IChartEventFilter,
): IFilterGroup {
  return {
    ...group,
    children: group.children.map((child) => {
      if (child.kind === 'condition') {
        return conditionId(child) === id ? { ...child, filter } : child;
      }

      return {
        ...child,
        children: child.children.map((nested) =>
          conditionId(nested) === id ? { ...nested, filter } : nested,
        ),
      };
    }),
  };
}

/** Removing the last condition of a sub-group removes the sub-group with it. */
export function removeCondition(
  group: IFilterGroup,
  id: string,
): IFilterGroup {
  const children = group.children.flatMap((child) => {
    if (child.kind === 'condition') {
      return conditionId(child) === id ? [] : [child];
    }

    const remaining = child.children.filter(
      (nested) => conditionId(nested) !== id,
    );
    return remaining.length === 0 ? [] : [{ ...child, children: remaining }];
  });

  return { ...group, children };
}

function allConditions(group: IFilterGroup): IChartEventFilter[] {
  return group.children.flatMap((child) =>
    child.kind === 'condition'
      ? [child.filter]
      : child.children.map((nested) => nested.filter),
  );
}

/**
 * A condition that would compile to nothing must never be applied: dropped
 * inside an OR it widens the result instead of narrowing it.
 */
export function isApplyDisabled(group: IFilterGroup): boolean {
  return allConditions(group).some(
    (filter) =>
      !VALUELESS_OPERATORS.has(filter.operator) && filter.value.length === 0,
  );
}

/** Short label shown on the chips under the toolbar. */
function chipText(filter: IChartEventFilter): string {
  const name = filter.name.split('.').pop() ?? filter.name;

  if (filter.operator === 'hasProperty') return `${name} has value`;
  if (filter.operator === 'missingProperty') return `${name} missing`;

  const operator = filter.operator === 'is' ? '=' : operatorsShort[filter.operator];
  return `${name} ${operator} ${filter.value.join(', ')}`.trim();
}

export function chipsFor(group: IFilterGroup) {
  return group.children.flatMap((child) => {
    const children = child.kind === 'condition' ? [child] : child.children;

    return children.map((nested) => ({
      id: conditionId(nested),
      text: chipText(nested.filter),
    }));
  });
}
