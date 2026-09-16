import {
  EVENT_ANALYTICS_MAX_DEPTH,
  type IEventAnalyticsMetric,
  type IEventAnalyticsMetricRow,
} from '@openpanel/validation';
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
  metricCell,
  metricColumnLabel,
  metricColumnWidth,
  resolveSort,
  sortArrow,
  subPercent,
  tableMinWidth,
  totalsCell,
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

describe('nextSort', () => {
  it('starts a new column descending', () => {
    expect(nextSort({ key: 'events', dir: 'desc' }, 'sum_param:day')).toEqual({
      key: 'sum_param:day',
      dir: 'desc',
    });
  });

  it('toggles direction on the active column', () => {
    expect(nextSort({ key: 'events', dir: 'desc' }, 'events')).toEqual({
      key: 'events',
      dir: 'asc',
    });
    expect(nextSort({ key: 'events', dir: 'asc' }, 'events')).toEqual({
      key: 'events',
      dir: 'desc',
    });
  });
});

describe('sortArrow', () => {
  it('marks only the active column', () => {
    expect(sortArrow({ key: 'users', dir: 'desc' }, 'users')).toBe('↓');
    expect(sortArrow({ key: 'users', dir: 'asc' }, 'users')).toBe('↑');
    expect(sortArrow({ key: 'users', dir: 'asc' }, 'events')).toBe('');
  });

  it('separates the users column from the percentage column', () => {
    expect(sortArrow({ key: 'pctu', dir: 'desc' }, 'users')).toBe('');
    expect(sortArrow({ key: 'pctu', dir: 'desc' }, 'pctu')).toBe('↓');
  });
});

describe('resolveSort', () => {
  const metrics: IEventAnalyticsMetric[] = [
    { id: 'events' },
    { id: 'sum_param', param: 'day' },
    { id: 'pctu' },
  ];

  it('sends the metric key itself, including pctu (the server maps it)', () => {
    expect(resolveSort({ key: 'sum_param:day', dir: 'asc' }, metrics)).toEqual({
      key: 'sum_param:day',
      dir: 'asc',
    });
    expect(resolveSort({ key: 'pctu', dir: 'desc' }, metrics)).toEqual({
      key: 'pctu',
      dir: 'desc',
    });
  });

  it('never sends a key outside allowedSortKeys(metrics)', () => {
    expect(resolveSort({ key: 'avg_param:day', dir: 'asc' }, metrics)).toEqual({
      key: 'events',
      dir: 'desc',
    });
  });
});

describe('metric column layout', () => {
  it('uses 158px columns up to four metrics and 132px past that', () => {
    expect(metricColumnWidth(4)).toBe(158);
    expect(metricColumnWidth(5)).toBe(132);
  });

  it('grows the scroll track with the columns (860px for the four defaults)', () => {
    expect(tableMinWidth(4)).toBe(860);
    expect(tableMinWidth(6)).toBe(228 + 6 * 132);
  });

  it('labels a column from the catalogue, uppercase, with its parameter', () => {
    expect(metricColumnLabel({ id: 'epu' })).toBe('EVENTS PER USER');
    expect(metricColumnLabel({ id: 'uniq_param_user', param: 'day' })).toBe(
      'UNIQUE PARAMETER VALUES PER USER: DAY',
    );
  });
});

describe('metricCell', () => {
  const totals: IEventAnalyticsMetricRow = {
    events: 1000,
    users: 200,
    metrics: { 'sum_param:day': 400 },
  };
  const row: IEventAnalyticsMetricRow = {
    events: 100,
    users: 20,
    metrics: {
      'sum_param:day': 40,
      'uniq_param:day': 1234,
      'avg_param:day': 0.4,
      'uniq_param_user:day': 0.25,
    },
  };

  it('reads events and users from their own fields, with the share when % is on', () => {
    expect(metricCell({ id: 'events' }, row, totals, true)).toEqual({
      value: '100',
      sub: '10.00 %',
    });
    expect(metricCell({ id: 'users' }, row, totals, false)).toEqual({
      value: '20',
      sub: null,
    });
  });

  it('derives epu from the row and pctu / epau from the totals users', () => {
    expect(metricCell({ id: 'epu' }, row, totals, true).value).toBe('5.00');
    expect(metricCell({ id: 'pctu' }, row, totals, true).value).toBe('10.00 %');
    // events / every tracked user, not the node's own users.
    expect(metricCell({ id: 'epau' }, row, totals, true).value).toBe('0.50');
  });

  it('reads parameter metrics from row.metrics by metric key', () => {
    expect(metricCell({ id: 'uniq_param', param: 'day' }, row, totals, true)).toEqual({
      value: '1,234',
      sub: null,
    });
    expect(metricCell({ id: 'sum_param', param: 'day' }, row, totals, true)).toEqual({
      value: '40.00',
      sub: '10.00 %',
    });
    expect(metricCell({ id: 'avg_param', param: 'day' }, row, totals, true).value).toBe(
      '0.40',
    );
    expect(
      metricCell({ id: 'uniq_param_user', param: 'day' }, row, totals, true).value,
    ).toBe('0.25');
  });

  it('shows a dash when the value is missing or the denominator is zero', () => {
    expect(
      metricCell({ id: 'median_param', param: 'day' }, row, totals, true).value,
    ).toBe('—');
    expect(
      metricCell({ id: 'epau' }, row, { events: 0, users: 0 }, true).value,
    ).toBe('—');
  });
});

describe('totalsCell', () => {
  const totals: IEventAnalyticsMetricRow = {
    events: 1000,
    users: 200,
    metrics: { 'sum_param:day': 400, 'uniq_param_user:day': 1.5 },
  };

  it('labels the built-in columns like the design', () => {
    expect(totalsCell({ id: 'events' }, totals)).toEqual({
      value: '1,000',
      sub: '100.00 %',
    });
    expect(totalsCell({ id: 'users' }, totals)).toEqual({
      value: '200',
      sub: 'unique · not a sum',
    });
    expect(totalsCell({ id: 'epu' }, totals)).toEqual({ value: '5.00', sub: 'average' });
    expect(totalsCell({ id: 'pctu' }, totals)).toEqual({
      value: '100.00 %',
      sub: 'of tracked users',
    });
    expect(totalsCell({ id: 'epau' }, totals)).toEqual({ value: '5.00', sub: 'average' });
  });

  it('reads parameter totals from the totals response, never from branches', () => {
    expect(totalsCell({ id: 'sum_param', param: 'day' }, totals)).toEqual({
      value: '400.00',
      sub: '100.00 %',
    });
    // Non-additive: the deduplicated number from the totals query.
    expect(totalsCell({ id: 'uniq_param_user', param: 'day' }, totals)).toEqual({
      value: '1.50',
      sub: 'average',
    });
  });
});
