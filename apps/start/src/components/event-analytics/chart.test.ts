import { describe, expect, it } from 'vitest';

import type { IEventAnalyticsMetric } from '@openpanel/validation';

import {
  buildEventAnalyticsChartInput,
  chartSegmentFor,
  resolveChartMetric,
} from './chart-input';

const base = {
  projectId: 'proj',
  range: '7d' as const,
  startDate: null,
  endDate: null,
  filters: [],
  metric: { id: 'events' } as IEventAnalyticsMetric,
  granularity: 'day' as const,
  chartType: 'linear' as const,
};

describe('buildEventAnalyticsChartInput', () => {
  it('keeps custom dates next to the range (R4)', () => {
    const input = buildEventAnalyticsChartInput({
      ...base,
      startDate: '2026-09-01',
      endDate: '2026-09-08',
      selected: [{ path: '/level_start', color: '#2563EB' }],
    });

    expect(input.range).toBe('7d');
    expect(input.startDate).toBe('2026-09-01');
    expect(input.endDate).toBe('2026-09-08');
  });

  it('maps the metric to a chart segment', () => {
    const selected = [{ path: '/level_start', color: '#2563EB' }];
    const serieFor = (metric: IEventAnalyticsMetric) =>
      buildEventAnalyticsChartInput({ ...base, metric, selected }).series[0];

    expect(serieFor({ id: 'events' })?.segment).toBe('event');
    expect(serieFor({ id: 'users' })?.segment).toBe('user');
    expect(serieFor({ id: 'epu' })?.segment).toBe('user_average');
    expect(serieFor({ id: 'sum_param', param: 'payload.coins' })).toMatchObject(
      { segment: 'property_sum', property: 'properties.payload.coins' },
    );
    expect(serieFor({ id: 'events' })).not.toHaveProperty('property');
  });

  it('maps granularity to the chart interval and keeps the chart type', () => {
    const input = buildEventAnalyticsChartInput({
      ...base,
      granularity: 'week',
      chartType: 'bar',
      selected: [{ path: '/level_start', color: '#2563EB' }],
    });

    expect(input.interval).toBe('week');
    expect(input.chartType).toBe('bar');
  });

  it('builds one series per distinct event and carries the filters', () => {
    const filters = [
      { name: 'platform', operator: 'is' as const, value: ['iOS'] },
    ];
    const input = buildEventAnalyticsChartInput({
      ...base,
      filters,
      selected: [
        { path: '/level_start', color: '#2563EB' },
        { path: '/level_start/level_mode', color: '#ff7557' },
        { path: '/ads_inter_shown', color: '#3ba974' },
      ],
    });

    expect(input.series.map((serie) => serie.name)).toEqual([
      'level_start',
      'ads_inter_shown',
    ]);
    expect(input.series[0]?.filters).toEqual(filters);
  });

  it('breaks down by the property keys of the selected event/key paths', () => {
    const input = buildEventAnalyticsChartInput({
      ...base,
      selected: [
        { path: '/level_start/level_mode', color: '#2563EB' },
        { path: '/ads_inter_shown/placement', color: '#ff7557' },
        { path: '/level_finish/placement', color: '#3ba974' },
      ],
    });

    expect(input.breakdowns).toEqual([
      { name: 'level_mode' },
      { name: 'placement' },
    ]);
  });

  it('returns no series when nothing is selected', () => {
    const input = buildEventAnalyticsChartInput({ ...base, selected: [] });

    expect(input.series).toEqual([]);
    expect(input.breakdowns).toEqual([]);
  });
});

describe('chartSegmentFor', () => {
  // The report chart has no segment that computes these the way the table
  // does. avg_param in particular: `property_average` skips events without
  // the parameter, the opposite of spec §3 D4 (missing counts as 0).
  it.each([
    { id: 'avg_param', param: 'level_id' },
    { id: 'median_param', param: 'level_id' },
    { id: 'uniq_param', param: 'level_id' },
    { id: 'uniq_param_user', param: 'level_id' },
    { id: 'sum_param_user', param: 'level_id' },
    { id: 'epau' },
    { id: 'pctu' },
  ] satisfies IEventAnalyticsMetric[])('cannot plot $id', (metric) => {
    expect(chartSegmentFor(metric)).toBeNull();
  });
});

describe('resolveChartMetric', () => {
  const metrics: IEventAnalyticsMetric[] = [
    { id: 'events' },
    { id: 'users' },
    { id: 'sum_param', param: 'day' },
  ];

  it('keeps the stored metric while it is still in the set', () => {
    expect(resolveChartMetric(metrics, 'users')).toEqual({ id: 'users' });
    expect(resolveChartMetric(metrics, 'sum_param:day')).toEqual({
      id: 'sum_param',
      param: 'day',
    });
  });

  it('falls back to the first metric once the stored one is removed', () => {
    expect(resolveChartMetric(metrics, 'epu')).toEqual({ id: 'events' });
    // Same id, different parameter: a different column, so also removed.
    expect(resolveChartMetric(metrics, 'sum_param:level_id')).toEqual({
      id: 'events',
    });
  });

  it('skips metrics the chart cannot plot', () => {
    const set: IEventAnalyticsMetric[] = [
      { id: 'pctu' },
      { id: 'users' },
      { id: 'events' },
    ];

    expect(resolveChartMetric(set, 'pctu')).toEqual({ id: 'users' });
    expect(resolveChartMetric(set, 'gone')).toEqual({ id: 'users' });
  });

  it('plots events when nothing in the set is chartable', () => {
    expect(resolveChartMetric([{ id: 'pctu' }], 'pctu')).toEqual({
      id: 'events',
    });
  });
});
