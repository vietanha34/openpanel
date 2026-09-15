import { describe, expect, it } from 'vitest';

import { buildEventAnalyticsChartInput } from './chart-input';

const base = {
  projectId: 'proj',
  range: '7d' as const,
  startDate: null,
  endDate: null,
  filters: [],
  metric: 'events' as const,
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
    const segmentFor = (metric: 'events' | 'users' | 'epu') =>
      buildEventAnalyticsChartInput({ ...base, metric, selected }).series[0]
        ?.segment;

    expect(segmentFor('events')).toBe('event');
    expect(segmentFor('users')).toBe('user');
    expect(segmentFor('epu')).toBe('user_average');
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
