/**
 * The Event Analytics chart must filter exactly as the Event Analytics table
 * does. The table compiles an AND/OR filter group through
 * `getEventAnalyticsWhereClause`; before B7 the chart only read the flat
 * `filters`, so every series drifted from the table as soon as a group held an
 * OR, a presence check or a sub-group.
 */

// The builders read the machine time zone through `new Date(...)`.
process.env.TZ = 'UTC';

import type { IChartEvent, IFilterGroup } from '@openpanel/validation';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  getAggregateChartSql as _getAggregateChartSql,
  getChartSql as _getChartSql,
} from './chart.service';
import { OverviewService } from './overview.service';

const getChartSql: (input: any) => Promise<string> = _getChartSql as any;
const getAggregateChartSql: (input: any) => Promise<string> =
  _getAggregateChartSql as any;

const projectId = 'test-chart-filter-group';

const base = {
  projectId,
  startDate: '2026-04-14 00:00:00',
  endDate: '2026-05-15 00:00:00',
  timezone: 'UTC',
  interval: 'day',
  breakdowns: [],
};

const crossScopeOr: IFilterGroup = {
  kind: 'group',
  op: 'or',
  children: [
    {
      kind: 'condition',
      filter: {
        name: 'profile.properties.plan',
        operator: 'missingProperty',
        value: [],
      },
    },
    {
      kind: 'condition',
      filter: {
        name: 'properties.level_mode',
        operator: 'hasProperty',
        value: [],
      },
    },
    {
      kind: 'group',
      op: 'and',
      children: [
        {
          kind: 'condition',
          filter: { name: 'utm_source', operator: 'is', value: ['newsletter'] },
        },
        {
          kind: 'condition',
          filter: { name: 'country', operator: 'is', value: ['SE'] },
        },
      ],
    },
  ],
};

const eventWith = (filterGroup?: IFilterGroup): IChartEvent =>
  ({
    id: 'A',
    name: 'level_start',
    segment: 'event',
    filters: [],
    ...(filterGroup ? { filterGroup } : {}),
  }) as IChartEvent;

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('chart SQL honours the filter group', () => {
  for (const [label, build] of [
    ['getChartSql', getChartSql],
    ['getAggregateChartSql', getAggregateChartSql],
  ] as const) {
    it(`${label} compiles the group with its OR and sub-group`, async () => {
      const sql = await build({ ...base, event: eventWith(crossScopeOr) });

      expect(sql).toContain(' OR ');
      expect(sql).toContain("e.properties['level_mode'] != ''");
      expect(sql).toContain("e.properties['__query.utm_source'] = 'newsletter'");
    });

    it(`${label} emits the table's own clause for every condition`, async () => {
      const sql = await build({ ...base, event: eventWith(crossScopeOr) });
      // The table compiles the same group without the events alias. Every
      // profile condition is alias-free, so it must appear verbatim.
      const tableWhere = new OverviewService(
        undefined as never,
      ).getEventAnalyticsWhereClause([], projectId, crossScopeOr);

      const profileClause = tableWhere.match(
        /profile_id IN \(SELECT id FROM profiles AS profile FINAL WHERE [^)]*\)/,
      )?.[0];
      expect(profileClause).toBeDefined();
      expect(sql).toContain(profileClause as string);
    });

    it(`${label} filters a profile condition by subselect, not through the profile join`, async () => {
      const sql = await build({ ...base, event: eventWith(crossScopeOr) });

      // Through the LEFT ANY JOIN, an event whose profile has no row reads ''
      // and would satisfy missingProperty; the table's subselect excludes it.
      expect(sql).not.toContain('LEFT ANY JOIN profile');
      expect(sql).not.toContain('`profile.properties.plan`');
      expect(sql).not.toContain('mapContains(profile.properties');
    });

    it(`${label} is byte-identical to today when no group is sent`, async () => {
      const flat = {
        ...base,
        event: {
          ...eventWith(),
          filters: [
            { name: 'properties.level_mode', operator: 'is', value: ['hard'] },
          ],
        },
      };

      expect(await build(flat)).toBe(
        await build({ ...flat, event: { ...flat.event, filterGroup: undefined } }),
      );
      expect(await build(flat)).toContain("e.properties['level_mode'] = 'hard'");
    });
  }
});
