import { describe, expect, it } from 'vitest';

import type {
  IEventAnalyticsMetric,
  IFilterGroup,
} from '@openpanel/validation';

import {
  buildComparisonChartInputs,
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
  const selected = [
    { path: '/level_start', color: '#2563EB' },
    { path: '/level_end', color: '#ff7557' },
  ];

  it('sends the advanced filter group on every series (B7)', () => {
    const filterGroup: IFilterGroup = {
      kind: 'group',
      op: 'or',
      children: [
        {
          kind: 'condition',
          filter: { name: 'properties.level_mode', operator: 'hasProperty', value: [] },
        },
        {
          kind: 'condition',
          filter: { name: 'country', operator: 'is', value: ['SE'] },
        },
      ],
    };

    const { series } = buildEventAnalyticsChartInput({
      ...base,
      filterGroup,
      selected,
    });

    expect(series).toHaveLength(2);
    for (const serie of series) {
      expect(serie.filterGroup).toEqual(filterGroup);
    }
  });

  it('sends flat filters as a group too, so the chart compiles them exactly as the table', () => {
    const filters = [
      { name: 'profile.properties.plan', operator: 'missingProperty' as const, value: [] },
    ];

    const [serie] = buildEventAnalyticsChartInput({ ...base, filters, selected }).series;

    expect(serie?.filterGroup).toEqual({
      kind: 'group',
      op: 'and',
      children: [{ kind: 'condition', filter: filters[0] }],
    });
    // Kept for any reader of the flat field; the group wins on the server.
    expect(serie?.filters).toEqual(filters);
  });

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
      {
        segment: 'property_sum_missing_zero',
        property: 'properties.payload.coins',
      },
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
  // Each parameter metric plots through a segment whose SQL is the table's
  // aggregate, missing parameter counted as 0 (spec §3 D4). The db test
  // `event-analytics-chart-segments.test.ts` checks each segment against the
  // table expression and the fixture numbers.
  it.each([
    ['sum_param', 'property_sum_missing_zero'],
    ['avg_param', 'property_average_missing_zero'],
    ['median_param', 'property_median_missing_zero'],
    ['uniq_param', 'property_unique_missing_zero'],
    ['sum_param_user', 'property_sum_per_user_missing_zero'],
    ['uniq_param_user', 'property_unique_per_user_missing_zero'],
  ] as const)('plots %s with %s', (id, segment) => {
    expect(chartSegmentFor({ id, param: 'level_id' })).toEqual({
      segment,
      property: 'properties.level_id',
    });
    expect(chartSegmentFor({ id })).toBeNull();
  });

  // Their denominator is every tracked user per bucket, which no chart
  // segment computes.
  it.each([{ id: 'epau' }, { id: 'pctu' }] satisfies IEventAnalyticsMetric[])(
    'cannot plot $id',
    (metric) => {
      expect(chartSegmentFor(metric)).toBeNull();
    },
  );
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

describe('buildComparisonChartInputs', () => {
  const selected = [{ path: '/level_start', color: '#2563EB' }];
  const periods = [
    { startDate: '2026-09-12 00:00:00', endDate: '2026-09-18 23:59:59' },
    { startDate: '2026-09-05 00:00:00', endDate: '2026-09-11 23:59:59' },
  ];

  it('builds one input per period, dates apart', () => {
    const inputs = buildComparisonChartInputs({ ...base, selected, periods });

    expect(inputs).toHaveLength(2);
    expect(inputs.map((input) => [input.startDate, input.endDate])).toEqual(
      periods.map((period) => [period.startDate, period.endDate]),
    );
  });

  // The whole point of reusing the builder: a comparison series and a plain
  // series can never be computed from different query inputs.
  it('period A is the non-compare input with A dates', () => {
    const plain = buildEventAnalyticsChartInput({ ...base, selected });
    const [periodA] = buildComparisonChartInputs({
      ...base,
      selected,
      periods,
    });

    expect(periodA).toEqual({
      ...plain,
      startDate: periods[0]!.startDate,
      endDate: periods[0]!.endDate,
    });
  });

  it('carries the metric segment and the filter group into every period', () => {
    const filterGroup = {
      kind: 'group' as const,
      op: 'and' as const,
      children: [
        {
          kind: 'condition' as const,
          filter: {
            name: 'properties.level_mode',
            operator: 'is' as const,
            value: ['hard'],
          },
        },
      ],
    };
    const inputs = buildComparisonChartInputs({
      ...base,
      filterGroup,
      metric: { id: 'avg_param', param: 'level_id' },
      selected,
      periods,
    });

    for (const input of inputs) {
      // The group rides on each series, where the server reads it (B7).
      expect(input.series[0]?.filterGroup).toEqual(filterGroup);
      expect(input.series[0]?.segment).toBe('property_average_missing_zero');
    }
  });
});
