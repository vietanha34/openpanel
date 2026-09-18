import { describe, expect, it } from 'vitest';

import { coldStartSelection, coldStartTrigger } from './chart-cold-start';

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

describe('coldStartTrigger', () => {
  const mounted = { prefsStatus: 'stored' as const, selectedCount: 3 };

  it('seeds on mount only when nothing was stored', () => {
    expect(
      coldStartTrigger({
        ...mounted,
        prefsStatus: 'absent',
        previousFilterKey: null,
        filterKey: 'f=[]',
      }),
    ).toBe('seed');

    expect(
      coldStartTrigger({
        ...mounted,
        previousFilterKey: null,
        filterKey: 'f=[]',
      }),
    ).toBe('none');
  });

  it('waits while the stored preferences are still loading', () => {
    expect(
      coldStartTrigger({
        ...mounted,
        prefsStatus: 'loading',
        previousFilterKey: 'f=[]',
        filterKey: 'f=[country]',
      }),
    ).toBe('wait');
  });

  it('reseeds when the filter changes, even with stored preferences (R2)', () => {
    // The user's hand-picked selection is dropped on purpose: R2 asks for
    // "clear the previous selection and add the new one".
    expect(
      coldStartTrigger({
        ...mounted,
        previousFilterKey: 'f=[]',
        filterKey: 'f=[country]',
      }),
    ).toBe('reseed');
  });

  it('reseeds again on a second filter change', () => {
    expect(
      coldStartTrigger({
        ...mounted,
        previousFilterKey: 'f=[country]',
        filterKey: 'f=[country,path]',
      }),
    ).toBe('reseed');
  });

  it('does nothing while the filter stays the same', () => {
    expect(
      coldStartTrigger({
        ...mounted,
        previousFilterKey: 'f=[country]',
        filterKey: 'f=[country]',
      }),
    ).toBe('none');
  });

  it('keeps an empty selection the user cleared while the filter is unchanged', () => {
    expect(
      coldStartTrigger({
        prefsStatus: 'stored',
        selectedCount: 0,
        previousFilterKey: 'f=[country]',
        filterKey: 'f=[country]',
      }),
    ).toBe('none');
  });
});
