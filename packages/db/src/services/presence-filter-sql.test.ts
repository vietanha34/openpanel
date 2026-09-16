import type { IChartEventFilter } from '@openpanel/validation';
import { describe, expect, it } from 'vitest';

import { compileEventFilter, getEventFiltersWhereClause } from './chart.service';

const presence = (
  name: string,
  operator: 'hasProperty' | 'missingProperty',
): IChartEventFilter => ({ name, operator, value: [] });

describe('hasProperty / missingProperty', () => {
  it('uses the map lookup form for an event property, never mapContains', () => {
    const clause = compileEventFilter(
      presence('properties.level_mode', 'hasProperty'),
      'p',
      'e',
      'events',
    );

    expect(clause).toBe("e.properties['level_mode'] != ''");
    expect(clause).not.toContain('mapContains');
  });

  it('uses the map lookup form for a profile property, never mapContains', () => {
    const clause = compileEventFilter(
      presence('profile.properties.plan', 'hasProperty'),
      'p',
      'e',
      'events',
    );

    expect(clause).toBe("profile.properties['plan'] != ''");
    expect(clause).not.toContain('mapContains');
  });

  it('negates exactly for missingProperty', () => {
    expect(
      compileEventFilter(
        presence('properties.level_mode', 'missingProperty'),
        'p',
        'e',
        'events',
      ),
    ).toBe("e.properties['level_mode'] = ''");
  });

  it('handles a top-level column', () => {
    expect(
      compileEventFilter(presence('country', 'hasProperty'), 'p', 'e', 'events'),
    ).toBe("(country IS NOT NULL AND country != '')");
    expect(
      compileEventFilter(
        presence('country', 'missingProperty'),
        'p',
        'e',
        'events',
      ),
    ).toBe("(country IS NULL OR country = '')");
  });

  it('handles a wildcard array path with arrayExists', () => {
    const clause = compileEventFilter(
      presence('properties.items.*.sku', 'hasProperty'),
      'p',
      'e',
      'events',
    );

    expect(clause).toContain('arrayExists');
    expect(clause).toContain("x != ''");
  });

  it('ignores an empty property name', () => {
    expect(
      compileEventFilter(presence('', 'hasProperty'), 'p', 'e', 'events'),
    ).toBeNull();
  });

  it('throws if the storage sentinel reaches SQL compilation', () => {
    expect(() =>
      compileEventFilter(
        {
          name: '__advanced_filters__',
          operator: 'advancedFilterGroup',
          value: [],
        },
        'p',
        'e',
        'events',
      ),
    ).toThrow(/sentinel/i);
  });

  it('keeps missing values out of a numeric comparison (T6 pairing)', () => {
    const sql = Object.values(
      getEventFiltersWhereClause(
        [{ name: 'properties.level', operator: 'lt', value: ['1'] }],
        'p',
        'e',
      ),
    ).join(' AND ');

    expect(sql).toContain('toFloat64OrNull');
    expect(sql).not.toContain('toFloat64OrZero');
  });
});
