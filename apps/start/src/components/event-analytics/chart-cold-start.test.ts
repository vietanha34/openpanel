import { describe, expect, it } from 'vitest';

import { coldStartSelection } from './chart-cold-start';

const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

describe('coldStartSelection', () => {
  it('selects the first five events in list order', () => {
    expect(
      coldStartSelection({
        names,
        selectedCount: 0,
        hasPersistedSelection: false,
      }),
    ).toEqual(['/a', '/b', '/c', '/d', '/e']);
  });

  it('selects every event when fewer than five exist', () => {
    expect(
      coldStartSelection({
        names: ['x', 'y'],
        selectedCount: 0,
        hasPersistedSelection: false,
      }),
    ).toEqual(['/x', '/y']);
  });

  it('does nothing when the list is empty', () => {
    expect(
      coldStartSelection({
        names: [],
        selectedCount: 0,
        hasPersistedSelection: false,
      }),
    ).toBeNull();
  });

  it('does nothing when rows are already selected', () => {
    expect(
      coldStartSelection({
        names,
        selectedCount: 1,
        hasPersistedSelection: false,
      }),
    ).toBeNull();
  });

  it('honours a persisted selection, even an empty one', () => {
    expect(
      coldStartSelection({
        names,
        selectedCount: 0,
        hasPersistedSelection: true,
      }),
    ).toBeNull();
  });
});
