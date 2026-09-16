import type { IChartEventFilter, IFilterGroup } from '@openpanel/validation';
import { describe, expect, it } from 'vitest';

import { compileFilterGroup, getFilterGroupWhere } from './filter-group.service';

const condition = (name: string) => ({
  kind: 'condition' as const,
  filter: { name, operator: 'is' as const, value: ['1'] },
});

/** Stub compiler: a filter named `drop` contributes nothing, like an empty value list. */
const compile = (filter: IChartEventFilter) =>
  filter.name === 'drop' ? null : `${filter.name} = 1`;

const group = (
  op: 'and' | 'or',
  children: IFilterGroup['children'],
): IFilterGroup => ({ kind: 'group', op, children });

describe('compileFilterGroup', () => {
  it('joins root conditions with AND and parenthesises each fragment', () => {
    expect(
      compileFilterGroup(group('and', [condition('a'), condition('b')]), compile),
    ).toBe('((a = 1) AND (b = 1))');
  });

  it('joins with OR when the root says so', () => {
    expect(
      compileFilterGroup(group('or', [condition('a'), condition('b')]), compile),
    ).toBe('((a = 1) OR (b = 1))');
  });

  it('nests a sub-group as a single fragment', () => {
    expect(
      compileFilterGroup(
        group('and', [
          condition('a'),
          { kind: 'group', op: 'or', children: [condition('b'), condition('c')] },
        ]),
        compile,
      ),
    ).toBe('((a = 1) AND (((b = 1) OR (c = 1))))');
  });

  it('drops a child that compiles to null inside AND', () => {
    expect(
      compileFilterGroup(
        group('and', [condition('a'), condition('drop')]),
        compile,
      ),
    ).toBe('((a = 1))');
  });

  it('drops a child that compiles to null inside OR', () => {
    expect(
      compileFilterGroup(
        group('or', [condition('a'), condition('drop')]),
        compile,
      ),
    ).toBe('((a = 1))');
  });

  it('drops a sub-group whose children all dropped', () => {
    expect(
      compileFilterGroup(
        group('and', [
          condition('a'),
          { kind: 'group', op: 'or', children: [condition('drop')] },
        ]),
        compile,
      ),
    ).toBe('((a = 1))');
  });

  it('returns null rather than 1 = 0 when every child dropped', () => {
    expect(compileFilterGroup(group('and', [condition('drop')]), compile)).toBeNull();
  });

  it('returns null for an empty group', () => {
    expect(compileFilterGroup(group('and', []), compile)).toBeNull();
  });
});

describe('getFilterGroupWhere', () => {
  it('returns a single fgroup key the existing callers merge with AND', () => {
    expect(getFilterGroupWhere(group('or', [condition('a')]), compile)).toEqual({
      fgroup: '((a = 1))',
    });
  });

  it('returns an empty record when nothing restricts the query', () => {
    expect(getFilterGroupWhere(group('and', []), compile)).toEqual({});
  });
});
