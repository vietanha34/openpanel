import type { IFilterGroup } from '@openpanel/validation';
import { describe, expect, it } from 'vitest';

import {
  buildEventAnalyticsListQuery,
  buildEventAnalyticsQuery,
} from './overview.service';

const range = {
  projectId: 'test-event-analytics-groups',
  startDate: '2026-09-01 00:00:00',
  endDate: '2026-09-02 00:00:00',
  timezone: 'UTC',
};

const listExtras = { sort: 'events' as const, dir: 'desc' as const, limit: 10 };

const orGroup: IFilterGroup = {
  kind: 'group',
  op: 'or',
  children: [
    {
      kind: 'condition',
      filter: {
        name: 'properties.level_mode',
        operator: 'is',
        value: ['hard'],
      },
    },
    {
      kind: 'condition',
      filter: {
        name: 'properties.level_id',
        operator: 'hasProperty',
        value: [],
      },
    },
  ],
};

describe('event analytics filter groups', () => {
  it('emits an OR between two property conditions', () => {
    const sql = buildEventAnalyticsQuery({
      ...range,
      filters: [],
      filterGroup: orGroup,
    }).toSQL();

    expect(sql).toContain(' OR ');
    expect(sql).toContain("properties['level_mode'] = 'hard'");
    expect(sql).toContain("properties['level_id'] != ''");
  });

  it('applies the group to the paginated list query too', () => {
    const sql = buildEventAnalyticsListQuery({
      ...range,
      ...listExtras,
      filters: [],
      filterGroup: orGroup,
    }).toSQL();

    expect(sql).toContain(' OR ');
    expect(sql).toContain("properties['level_id'] != ''");
  });

  it('nests a sub-group inside the root operator', () => {
    const sql = buildEventAnalyticsQuery({
      ...range,
      filters: [],
      filterGroup: {
        kind: 'group',
        op: 'and',
        children: [
          {
            kind: 'condition',
            filter: { name: 'country', operator: 'is', value: ['SE'] },
          },
          {
            kind: 'group',
            op: 'or',
            children: [
              {
                kind: 'condition',
                filter: {
                  name: 'properties.level_mode',
                  operator: 'is',
                  value: ['hard'],
                },
              },
              {
                kind: 'condition',
                filter: {
                  name: 'properties.level_mode',
                  operator: 'missingProperty',
                  value: [],
                },
              },
            ],
          },
        ],
      },
    }).toSQL();

    expect(sql).toContain("country = 'SE'");
    expect(sql).toContain(' AND ');
    expect(sql).toContain(' OR ');
    expect(sql).toContain("properties['level_mode'] = ''");
  });

  it('still rewrites utm names inside a group', () => {
    const sql = buildEventAnalyticsQuery({
      ...range,
      filters: [],
      filterGroup: {
        kind: 'group',
        op: 'and',
        children: [
          {
            kind: 'condition',
            filter: {
              name: 'utm_source',
              operator: 'is',
              value: ['newsletter'],
            },
          },
        ],
      },
    }).toSQL();

    expect(sql).toContain("properties['__query.utm_source'] = 'newsletter'");
  });

  it('drops profile property conditions, as the flat path already does', () => {
    const sql = buildEventAnalyticsQuery({
      ...range,
      filters: [],
      filterGroup: {
        kind: 'group',
        op: 'and',
        children: [
          {
            kind: 'condition',
            filter: {
              name: 'profile.properties.plan',
              operator: 'is',
              value: ['pro'],
            },
          },
        ],
      },
    }).toSQL();

    expect(sql).not.toContain('profile.properties');
  });

  it('is byte-identical to the flat path when no group is supplied', () => {
    const filters = [
      {
        name: 'properties.level_mode',
        operator: 'is' as const,
        value: ['hard'],
      },
    ];

    expect(buildEventAnalyticsQuery({ ...range, filters }).toSQL()).toBe(
      buildEventAnalyticsQuery({
        ...range,
        filters,
        filterGroup: undefined,
      }).toSQL(),
    );
  });
});
