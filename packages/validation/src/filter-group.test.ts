import { describe, expect, it } from 'vitest';

import type { IChartEventFilterOperator } from './index';
import {
  flattenConditions,
  isFlatExpressible,
  resolveFilterGroup,
  zFilterGroup,
} from './filter-group';

const condition = (
  name: string,
  operator: IChartEventFilterOperator = 'is',
) => ({
  kind: 'condition' as const,
  filter: { name, operator, value: ['x'] },
});

describe('zFilterGroup', () => {
  it('rejects a third level of nesting', () => {
    const threeLevels = {
      kind: 'group',
      op: 'and',
      children: [
        {
          kind: 'group',
          op: 'or',
          children: [{ kind: 'group', op: 'and', children: [] }],
        },
      ],
    };

    expect(zFilterGroup.safeParse(threeLevels).success).toBe(false);
  });

  it('accepts a root group holding one sub-group', () => {
    const twoLevels = {
      kind: 'group',
      op: 'or',
      children: [
        condition('country'),
        { kind: 'group', op: 'and', children: [condition('path')] },
      ],
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
    const group = {
      kind: 'group' as const,
      op: 'or' as const,
      children: [condition('path')],
    };

    expect(
      resolveFilterGroup(
        [{ name: 'country', operator: 'is' as const, value: [] }],
        group,
      ),
    ).toBe(group);
  });

  it('returns an empty AND root when nothing is supplied', () => {
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
      children: [
        condition('country'),
        {
          kind: 'group' as const,
          op: 'or' as const,
          children: [condition('path')],
        },
      ],
    };

    expect(flattenConditions(group).map((filter) => filter.name)).toEqual([
      'country',
      'path',
    ]);
  });
});

describe('isFlatExpressible', () => {
  it('is true for an AND root of plain conditions', () => {
    expect(
      isFlatExpressible({
        kind: 'group',
        op: 'and',
        children: [condition('country')],
      }),
    ).toBe(true);
  });

  it('is false for an OR root', () => {
    expect(
      isFlatExpressible({
        kind: 'group',
        op: 'or',
        children: [condition('country')],
      }),
    ).toBe(false);
  });

  it('is false when a sub-group is present', () => {
    expect(
      isFlatExpressible({
        kind: 'group',
        op: 'and',
        children: [
          { kind: 'group', op: 'and', children: [condition('path')] },
        ],
      }),
    ).toBe(false);
  });

  it('is false when a presence operator is used', () => {
    expect(
      isFlatExpressible({
        kind: 'group',
        op: 'and',
        children: [condition('properties.level', 'hasProperty')],
      }),
    ).toBe(false);
  });
});
