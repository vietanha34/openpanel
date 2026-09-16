/**
 * Round trip: a filter group sent on a chart series must survive the tRPC input
 * schema. zod strips unknown keys, so before `zChartEvent` declared
 * `filterGroup` the Event Analytics chart's group vanished at the API boundary
 * and every series was computed unfiltered by it (B7).
 */
import { describe, expect, it } from 'vitest';

import type { IFilterGroup } from './filter-group';
import { zReportInput } from './index';

const filterGroup: IFilterGroup = {
  kind: 'group',
  op: 'or',
  children: [
    {
      kind: 'condition',
      filter: { name: 'properties.level_mode', operator: 'hasProperty', value: [] },
    },
    {
      kind: 'group',
      op: 'and',
      children: [
        {
          kind: 'condition',
          filter: { name: 'country', operator: 'is', value: ['SE'] },
        },
      ],
    },
  ],
};

const report = (serie: Record<string, unknown>) => ({
  projectId: 'p',
  chartType: 'linear',
  interval: 'day',
  range: '7d',
  breakdowns: [],
  series: [
    { type: 'event', id: 'A', name: 'level_start', segment: 'event', ...serie },
  ],
});

describe('filter group on a report series', () => {
  it('survives zReportInput parsing', () => {
    const parsed = zReportInput.parse(report({ filters: [], filterGroup }));
    const [serie] = parsed.series;

    expect(serie?.type === 'event' && serie.filterGroup).toEqual(filterGroup);
  });

  it('stays absent for a flat series', () => {
    const parsed = zReportInput.parse(report({ filters: [] }));
    const [serie] = parsed.series;

    expect(serie?.type === 'event' && serie.filterGroup).toBeUndefined();
  });

  it('rejects a third nesting level at the API boundary', () => {
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

    expect(
      zReportInput.safeParse(report({ filters: [], filterGroup: threeLevels }))
        .success,
    ).toBe(false);
  });
});
