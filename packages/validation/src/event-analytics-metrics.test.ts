import { describe, expect, it } from 'vitest';

import {
  EVENT_ANALYTICS_MAX_METRICS,
  EVENT_ANALYTICS_METRICS,
  type IEventAnalyticsMetric,
  metricKey,
  zEventAnalyticsListInput,
  zEventAnalyticsMetric,
  zEventAnalyticsPreferences,
  zEventAnalyticsRange,
} from './event-analytics';

const range = {
  projectId: 'p',
  range: '7d' as const,
  filters: [],
};

const listInput = {
  ...range,
  sort: 'events',
  dir: 'desc' as const,
  limit: 10,
};

describe('metric catalogue', () => {
  it('holds the ten metrics of the design, in catalogue order', () => {
    expect(Object.keys(EVENT_ANALYTICS_METRICS)).toEqual([
      'events',
      'uniq_param',
      'sum_param',
      'avg_param',
      'median_param',
      'users',
      'epu',
      'pctu',
      'uniq_param_user',
      'sum_param_user',
    ]);
  });

  it('locks Events and nothing else', () => {
    const locked = Object.entries(EVENT_ANALYTICS_METRICS)
      .filter(([, def]) => def.locked)
      .map(([id]) => id);

    expect(locked).toEqual(['events']);
  });

  it('marks exactly the five parameter metrics', () => {
    const withParam = Object.entries(EVENT_ANALYTICS_METRICS)
      .filter(([, def]) => def.param)
      .map(([id]) => id);

    expect(withParam).toEqual([
      'uniq_param',
      'sum_param',
      'avg_param',
      'median_param',
      'uniq_param_user',
      'sum_param_user',
    ]);
  });

  it('marks only events and sum_param as additive down the tree', () => {
    const additive = Object.entries(EVENT_ANALYTICS_METRICS)
      .filter(([, def]) => def.additive)
      .map(([id]) => id);

    expect(additive).toEqual(['events', 'sum_param']);
  });

  it('groups by events and users, matching the design titles', () => {
    expect(EVENT_ANALYTICS_METRICS.events.group).toBe('events');
    expect(EVENT_ANALYTICS_METRICS.pctu.group).toBe('users');
  });
});

describe('metricKey', () => {
  it('is the bare id for a plain metric', () => {
    expect(metricKey({ id: 'events' })).toBe('events');
  });

  it('carries the parameter for a parameter metric', () => {
    expect(metricKey({ id: 'sum_param', param: 'day' })).toBe('sum_param:day');
  });

  it('separates the same metric on two parameters', () => {
    expect(metricKey({ id: 'sum_param', param: 'day' })).not.toBe(
      metricKey({ id: 'sum_param', param: 'level_id' }),
    );
  });
});

describe('zEventAnalyticsMetric', () => {
  it('accepts a plain metric', () => {
    expect(zEventAnalyticsMetric.safeParse({ id: 'users' }).success).toBe(true);
  });

  it('rejects an unknown id', () => {
    expect(zEventAnalyticsMetric.safeParse({ id: 'nope' }).success).toBe(false);
  });
});

describe('metrics validation on the range schema', () => {
  const parse = (metrics: unknown) =>
    zEventAnalyticsRange.safeParse({ ...range, metrics });

  it('accepts the legacy request with no metrics at all', () => {
    expect(zEventAnalyticsRange.safeParse(range).success).toBe(true);
  });

  it('accepts a valid set', () => {
    expect(
      parse([
        { id: 'events' },
        { id: 'users' },
        { id: 'sum_param', param: 'day' },
      ]).success,
    ).toBe(true);
  });

  it('rejects a parameter metric with no param', () => {
    const result = parse([{ id: 'events' }, { id: 'sum_param' }]);

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toMatch(/parameter/i);
  });

  it('rejects a parameter metric with an empty param', () => {
    expect(parse([{ id: 'events' }, { id: 'sum_param', param: '' }]).success).toBe(
      false,
    );
  });

  it('rejects a plain metric carrying a param', () => {
    expect(parse([{ id: 'events' }, { id: 'users', param: 'day' }]).success).toBe(
      false,
    );
  });

  it('rejects more than ten metrics', () => {
    const eleven: IEventAnalyticsMetric[] = [
      { id: 'events' },
      { id: 'users' },
      { id: 'epu' },
      { id: 'pctu' },
      ...Array.from({ length: 7 }, (_, index) => ({
        id: 'sum_param' as const,
        param: `p${index}`,
      })),
    ];

    expect(eleven).toHaveLength(EVENT_ANALYTICS_MAX_METRICS + 1);
    expect(parse(eleven).success).toBe(false);
  });

  it('rejects duplicate metric keys', () => {
    expect(
      parse([
        { id: 'events' },
        { id: 'sum_param', param: 'day' },
        { id: 'sum_param', param: 'day' },
      ]).success,
    ).toBe(false);
  });

  it('allows the same metric on two different parameters', () => {
    expect(
      parse([
        { id: 'events' },
        { id: 'sum_param', param: 'day' },
        { id: 'sum_param', param: 'level_id' },
      ]).success,
    ).toBe(true);
  });

  it('requires events to be present once metrics are supplied', () => {
    expect(parse([{ id: 'users' }]).success).toBe(false);
  });
});

describe('sort validation', () => {
  const parse = (input: Record<string, unknown>) =>
    zEventAnalyticsListInput.safeParse({ ...listInput, ...input });

  it('accepts the three legacy sort keys with no metrics requested', () => {
    for (const sort of ['events', 'users', 'epu']) {
      expect(parse({ sort }).success).toBe(true);
    }
  });

  it('accepts a sort naming a requested metric key', () => {
    expect(
      parse({
        metrics: [{ id: 'events' }, { id: 'sum_param', param: 'day' }],
        sort: 'sum_param:day',
      }).success,
    ).toBe(true);
  });

  it('rejects a sort naming a metric that was not requested', () => {
    expect(
      parse({
        metrics: [{ id: 'events' }, { id: 'sum_param', param: 'day' }],
        sort: 'sum_param:level_id',
      }).success,
    ).toBe(false);
  });

  it('rejects an arbitrary string, so sort cannot smuggle SQL', () => {
    expect(parse({ sort: 'events; DROP TABLE events' }).success).toBe(false);
  });
});

describe('zEventAnalyticsPreferences', () => {
  const prefs = {
    version: 1,
    metrics: [{ id: 'events' }, { id: 'sum_param', param: 'day' }],
    sort: { key: 'events', dir: 'desc' },
    pct: true,
    chart: {
      metric: 'events',
      granularity: 'day',
      type: 'line',
      collapsed: false,
    },
    selected: ['/level_start'],
  };

  it('accepts a complete entry', () => {
    expect(zEventAnalyticsPreferences.safeParse(prefs).success).toBe(true);
  });

  it('accepts an empty selection — a deliberate choice, not an absent entry', () => {
    expect(
      zEventAnalyticsPreferences.safeParse({ ...prefs, selected: [] }).success,
    ).toBe(true);
  });

  it('rejects an unknown version so a future shape cannot be half-restored', () => {
    expect(
      zEventAnalyticsPreferences.safeParse({ ...prefs, version: 2 }).success,
    ).toBe(false);
  });

  it('rejects a metric id that has left the catalogue', () => {
    expect(
      zEventAnalyticsPreferences.safeParse({
        ...prefs,
        metrics: [{ id: 'retired_metric' }],
      }).success,
    ).toBe(false);
  });

  it('rejects a parameter metric with no param, like the request schema', () => {
    expect(
      zEventAnalyticsPreferences.safeParse({
        ...prefs,
        metrics: [{ id: 'events' }, { id: 'sum_param' }],
      }).success,
    ).toBe(false);
  });
});
