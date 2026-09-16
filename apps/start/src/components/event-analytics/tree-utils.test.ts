import { EVENT_ANALYTICS_MAX_DEPTH } from '@openpanel/validation';
import { describe, expect, it } from 'vitest';
import {
  MAX_LEVEL,
  badgeFor,
  canExpand,
  childPath,
  formatCount,
  formatEventsPerUser,
  formatPercent,
  iconFor,
  indentStyle,
  nextSort,
  sortArrow,
  sortKeyForColumn,
  subPercent,
  valueKindForLevel,
} from './tree-utils';

describe('childPath', () => {
  it('builds the design path format', () => {
    expect(childPath('', 'level_start')).toBe('/level_start');
    expect(childPath('/level_start', 'level_mode')).toBe(
      '/level_start/level_mode',
    );
    expect(childPath('/level_start/level_mode', 'hard')).toBe(
      '/level_start/level_mode/hard',
    );
  });
});

describe('indentStyle', () => {
  it('indents 22px per depth on top of the 14px gutter', () => {
    expect(indentStyle(0)).toEqual({ paddingLeft: '14px' });
    expect(indentStyle(3)).toEqual({ paddingLeft: '80px' });
  });
});

describe('iconFor', () => {
  it('maps each kind to the design glyph', () => {
    expect(iconFor('event')).toBe('E');
    expect(iconFor('key')).toBe('K');
    expect(iconFor('obj')).toBe('{}');
    expect(iconFor('value')).toBe('V');
    expect(iconFor('leaf')).toBe('·');
  });
});

describe('badgeFor', () => {
  it('omits the badge for events (no category from the backend)', () => {
    expect(badgeFor('event', 'unknown')).toBeNull();
  });

  it('shows the inferred type for keys and object for obj nodes', () => {
    expect(badgeFor('key', 'num')).toBe('num');
    expect(badgeFor('key', 'str')).toBe('str');
    expect(badgeFor('obj', 'unknown')).toBe('object');
  });

  it('omits the badge for values and for keys of unknown type', () => {
    expect(badgeFor('value', 'str')).toBeNull();
    expect(badgeFor('leaf', 'str')).toBeNull();
    expect(badgeFor('key', 'unknown')).toBeNull();
  });
});

describe('canExpand', () => {
  it('takes its limit from the contract, not from a copy of the number', () => {
    expect(MAX_LEVEL).toBe(EVENT_ANALYTICS_MAX_DEPTH);
  });

  it('allows children up to the contract depth limit', () => {
    expect(MAX_LEVEL).toBe(4);
    expect(canExpand(1)).toBe(true);
    expect(canExpand(4)).toBe(true);
    expect(canExpand(5)).toBe(false);
  });
});

describe('valueKindForLevel', () => {
  it('uses the leaf glyph for the deepest values', () => {
    expect(valueKindForLevel(2)).toBe('value');
    expect(valueKindForLevel(4)).toBe('leaf');
  });
});

describe('formatEventsPerUser', () => {
  it('divides events by users', () => {
    expect(formatEventsPerUser({ events: 10, users: 4 })).toBe('2.50');
  });

  it('renders a dash instead of Infinity or NaN when there are no users', () => {
    expect(formatEventsPerUser({ events: 10, users: 0 })).toBe('—');
    expect(formatEventsPerUser({ events: 0, users: 0 })).toBe('—');
  });

  it('renders a real zero', () => {
    expect(formatEventsPerUser({ events: 0, users: 5 })).toBe('0.00');
  });
});

describe('formatPercent', () => {
  it('formats a share with two decimals', () => {
    expect(formatPercent(1, 4)).toBe('25.00 %');
  });

  it('renders a dash when the total is zero', () => {
    expect(formatPercent(0, 0)).toBe('—');
    expect(formatPercent(5, 0)).toBe('—');
  });

  it('renders a real zero share', () => {
    expect(formatPercent(0, 10)).toBe('0.00 %');
  });
});

describe('subPercent', () => {
  it('returns null when the pct toggle is off', () => {
    expect(subPercent(1, 4, false)).toBeNull();
  });

  it('returns the formatted share when the toggle is on', () => {
    expect(subPercent(1, 4, true)).toBe('25.00 %');
  });
});

describe('formatCount', () => {
  it('groups thousands and never emits NaN', () => {
    expect(formatCount(842910)).toBe('842,910');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(Number.NaN)).toBe('—');
  });
});

describe('sortKeyForColumn', () => {
  it('maps the metric columns straight through', () => {
    expect(sortKeyForColumn('events')).toBe('events');
    expect(sortKeyForColumn('users')).toBe('users');
    expect(sortKeyForColumn('epu')).toBe('epu');
  });

  it('maps "% of all users" to users', () => {
    expect(sortKeyForColumn('pctu')).toBe('users');
  });
});

describe('nextSort', () => {
  it('starts a new column descending', () => {
    expect(nextSort({ sort: 'events', dir: 'desc' }, 'users')).toEqual({
      sort: 'users',
      dir: 'desc',
    });
  });

  it('toggles direction on the active column', () => {
    expect(nextSort({ sort: 'events', dir: 'desc' }, 'events')).toEqual({
      sort: 'events',
      dir: 'asc',
    });
    expect(nextSort({ sort: 'events', dir: 'asc' }, 'events')).toEqual({
      sort: 'events',
      dir: 'desc',
    });
  });
});

describe('sortArrow', () => {
  it('marks only the active column', () => {
    expect(sortArrow({ sort: 'users', dir: 'desc' }, 'users')).toBe('↓');
    expect(sortArrow({ sort: 'users', dir: 'asc' }, 'users')).toBe('↑');
    expect(sortArrow({ sort: 'users', dir: 'asc' }, 'events')).toBe('');
  });

  it('separates the users column from the percentage column', () => {
    expect(sortArrow({ sort: 'pctu', dir: 'desc' }, 'users')).toBe('');
    expect(sortArrow({ sort: 'pctu', dir: 'desc' }, 'pctu')).toBe('↓');
  });
});
