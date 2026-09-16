import type { IFilterGroup } from '@openpanel/validation';
import { describe, expect, it } from 'vitest';

import {
  addCondition,
  addSubGroup,
  canAddSubGroup,
  chipsFor,
  emptyGroup,
  flattenGroups,
  isApplyDisabled,
  removeCondition,
  scopeOf,
  setGroupOp,
  updateCondition,
} from './advanced-filters-state';

const condition = (
  name: string,
  operator = 'is',
  value: string[] = ['hard'],
) => ({
  kind: 'condition' as const,
  id: name,
  filter: { id: name, name, operator, value } as never,
});

const root: IFilterGroup = {
  kind: 'group',
  id: 'root',
  op: 'and',
  children: [
    condition('properties.level_mode'),
    {
      kind: 'group',
      id: 'g1',
      op: 'or',
      children: [condition('country', 'is', ['SE'])],
    },
  ],
};

describe('flattenGroups', () => {
  it('renders the root at level 1 and a sub-group at level 2 with 22px indent', () => {
    const rows = flattenGroups(root);

    expect(rows.map((row) => row.level)).toEqual([1, 2]);
    expect(rows.map((row) => row.indent)).toEqual([0, 22]);
  });

  it('gives the first condition an empty join word and the rest the group operator', () => {
    const [first] = flattenGroups({
      kind: 'group',
      op: 'or',
      children: [condition('a'), condition('b'), condition('c')],
    });

    expect(first?.rows.map((row) => row.join)).toEqual(['', 'OR', 'OR']);
  });

  it('describes the operator in words, matching the design hint', () => {
    const rows = flattenGroups(root);

    expect(rows[0]?.hint).toBe('All conditions must match');
    expect(rows[1]?.hint).toBe('Any condition may match');
  });
});

describe('canAddSubGroup', () => {
  it('is true at the root', () => {
    expect(canAddSubGroup(1)).toBe(true);
  });

  it('is false at level 2 — nesting is capped at two levels', () => {
    expect(canAddSubGroup(2)).toBe(false);
  });
});

describe('scopeOf', () => {
  it('labels an event property group', () => {
    expect(scopeOf([condition('properties.level_mode')])).toBe(
      'EVENT PROPERTY',
    );
  });

  it('labels a profile property group', () => {
    expect(scopeOf([condition('profile.country')])).toBe('USER PROPERTY');
  });

  it('labels a group holding both', () => {
    expect(
      scopeOf([condition('properties.level_mode'), condition('profile.country')]),
    ).toBe('MIXED');
  });
});

describe('editing', () => {
  it('appends a condition to the addressed group', () => {
    const next = addSubGroup(root);
    expect(next.children).toHaveLength(3);

    const added = next.children[2];
    expect(added?.kind).toBe('group');
  });

  it('adds a condition to the root', () => {
    const next = addCondition(root, null, 'path');
    expect(next.children).toHaveLength(3);
    expect(next.children[2]).toMatchObject({
      kind: 'condition',
      filter: { name: 'path', operator: 'is', value: [] },
    });
  });

  it('adds a condition to a sub-group by id', () => {
    const next = addCondition(root, 'g1', 'path');
    const subGroup = next.children[1];

    expect(subGroup?.kind).toBe('group');
    expect(subGroup.kind === 'group' && subGroup.children).toHaveLength(2);
  });

  it('flips a group operator', () => {
    expect(setGroupOp(root, null, 'or').op).toBe('or');

    const next = setGroupOp(root, 'g1', 'and');
    const subGroup = next.children[1];
    expect(subGroup.kind === 'group' && subGroup.op).toBe('and');
  });

  it('updates a condition in place', () => {
    const next = updateCondition(root, 'properties.level_mode', {
      id: 'properties.level_mode',
      name: 'properties.level_mode',
      operator: 'isNot',
      value: ['easy'],
    } as never);

    expect(next.children[0]).toMatchObject({
      filter: { operator: 'isNot', value: ['easy'] },
    });
  });

  it('removes a condition and drops a sub-group left empty', () => {
    const next = removeCondition(root, 'country');

    expect(next.children).toHaveLength(1);
    expect(next.children[0]?.kind).toBe('condition');
  });
});

describe('isApplyDisabled', () => {
  it('blocks a condition that needs values but has none', () => {
    expect(
      isApplyDisabled({
        kind: 'group',
        op: 'and',
        children: [condition('country', 'is', [])],
      }),
    ).toBe(true);
  });

  it('allows a presence operator with no values', () => {
    expect(
      isApplyDisabled({
        kind: 'group',
        op: 'and',
        children: [condition('properties.level', 'hasProperty', [])],
      }),
    ).toBe(false);
  });

  it('allows an empty group — that just means no filtering', () => {
    expect(isApplyDisabled(emptyGroup())).toBe(false);
  });
});

describe('chipsFor', () => {
  it('summarises every applied condition, sub-groups included', () => {
    expect(chipsFor(root).map((chip) => chip.text)).toEqual([
      'level_mode = hard',
      'country = SE',
    ]);
  });

  it('renders a presence operator without a value', () => {
    expect(
      chipsFor({
        kind: 'group',
        op: 'and',
        children: [condition('properties.level_id', 'missingProperty', [])],
      })[0]?.text,
    ).toBe('level_id missing');
  });
});
