/**
 * Byte-for-byte pin of the SQL every pre-existing chart segment compiles to,
 * from both builders. The snapshot was written from the code BEFORE the Event
 * Analytics segments (B3) were added, so any change to an existing segment
 * fails here.
 */

import { chartSegments } from '@openpanel/constants';
import type { IChartEvent } from '@openpanel/validation';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  getAggregateChartSql as _getAggregateChartSql,
  getChartSql as _getChartSql,
} from './chart.service';

// The SQL builders ignore the display-only fields of their input type.
const getChartSql: (input: any) => Promise<string> = _getChartSql as any;
const getAggregateChartSql: (input: any) => Promise<string> =
  _getAggregateChartSql as any;

const base = {
  projectId: 'test-chart-segment-sql',
  startDate: '2026-04-14 00:00:00',
  endDate: '2026-05-15 00:00:00',
  timezone: 'UTC',
};

// A property segment reads `property`; the others ignore it. Both a map key
// and a numeric top-level column, because the builders branch on that.
const PROPERTIES = ['properties.lives_left', 'revenue'];

const cases = Object.keys(chartSegments).flatMap((segment) =>
  (segment.startsWith('property_') ? PROPERTIES : [undefined]).flatMap(
    (property) =>
      [[], [{ id: 'country', name: 'country' }]].map((breakdowns) => ({
        label: `${segment}${property ? ` ${property}` : ''}${breakdowns.length ? ' by country' : ''}`,
        event: {
          id: 'A',
          name: 'level_start',
          segment,
          property,
          filters: [{ name: 'properties.level_mode', operator: 'is', value: ['hard'] }],
        } as IChartEvent,
        breakdowns,
      }))
  )
);

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('existing chart segments compile to unchanged SQL', () => {
  it.for(cases)('getChartSql: $label', async ({ event, breakdowns }) => {
    expect(
      await getChartSql({ ...base, event, breakdowns, interval: 'day' })
    ).toMatchSnapshot();
  });

  it.for(cases)('getAggregateChartSql: $label', async ({
    event,
    breakdowns,
  }) => {
    expect(
      await getAggregateChartSql({ ...base, event, breakdowns })
    ).toMatchSnapshot();
  });
});
