import type { IChartEventItem, IFilterGroup } from '@openpanel/validation';
import { describe, expect, it } from 'vitest';

import { toChartQueryEvent } from './fetch';

type EventSerie = Extract<IChartEventItem, { type: 'event' }>;

describe('toChartQueryEvent', () => {
  const filterGroup: IFilterGroup = {
    kind: 'group',
    op: 'or',
    children: [
      {
        kind: 'condition',
        filter: { name: 'country', operator: 'is', value: ['SE'] },
      },
    ],
  };

  const serie: EventSerie = {
    type: 'event',
    id: 'A',
    name: 'level_start',
    displayName: 'Level start',
    segment: 'property_sum_missing_zero',
    property: 'properties.coins',
    filters: [{ name: 'path', operator: 'is', value: ['/'] }],
    filterGroup,
  };

  it('carries the filter group to the SQL builder (B7)', () => {
    // Before B7 the engine re-listed the event's fields and silently dropped
    // `filterGroup`, so the Event Analytics chart ignored the table's group.
    expect(toChartQueryEvent(serie).filterGroup).toBe(filterGroup);
  });

  it('keeps every field the SQL builder reads', () => {
    expect(toChartQueryEvent(serie)).toEqual({
      id: 'A',
      name: 'level_start',
      displayName: 'Level start',
      segment: 'property_sum_missing_zero',
      property: 'properties.coins',
      filters: [{ name: 'path', operator: 'is', value: ['/'] }],
      filterGroup,
    });
  });

  it('leaves filterGroup undefined for a flat serie, keeping its SQL unchanged', () => {
    const { filterGroup: _ignored, ...flat } = serie;

    expect(toChartQueryEvent(flat).filterGroup).toBeUndefined();
  });
});
