import type { IChartEventFilter } from '@openpanel/validation';
import { describe, expect, it } from 'vitest';

import {
  collectProfilePropertyKeys,
  compileEventFilter,
  rewriteProfilePropertyRefs,
} from './chart.service';

/**
 * The profile CTE projects only the referenced keys as scalar columns and drops
 * the `properties` Map when no wildcard needs it. A clause naming the bare Map
 * is not matched by `rewriteProfilePropertyRefs`, survives into the final SQL
 * and references a column that is gone. These tests pin the clause shape that
 * cannot fail that way. See the advanced filters spec §5.4.
 */
describe('profile property presence survives CTE narrowing', () => {
  it('emits a clause the rewrite can retarget to the scalar alias', () => {
    const filter: IChartEventFilter = {
      name: 'profile.properties.plan',
      operator: 'hasProperty',
      value: [],
    };

    const clause = compileEventFilter(filter, 'p', 'e', 'events');
    expect(clause).toBe("profile.properties['plan'] != ''");

    const { keys, needsFullMap } = collectProfilePropertyKeys([
      { name: filter.name },
    ]);
    expect(keys).toEqual(['plan']);
    expect(needsFullMap).toBe(false);

    expect(rewriteProfilePropertyRefs(clause as string, keys)).toBe(
      "`profile.properties.plan` != ''",
    );
  });

  it('never emits mapContains for a profile property', () => {
    for (const operator of [
      'hasProperty',
      'missingProperty',
      'gt',
      'is',
    ] as const) {
      const clause = compileEventFilter(
        { name: 'profile.properties.plan', operator, value: ['1'] },
        'p',
        'e',
        'events',
      );

      expect(clause ?? '').not.toContain('mapContains(profile.properties');
    }
  });

  it('rewrites each branch of a cross-scope OR independently', () => {
    const profileClause = compileEventFilter(
      { name: 'profile.properties.plan', operator: 'is', value: ['pro'] },
      'p',
      'e',
      'events',
    );
    const eventClause = compileEventFilter(
      { name: 'properties.level_mode', operator: 'hasProperty', value: [] },
      'p',
      'e',
      'events',
    );

    const combined = `((${profileClause}) OR (${eventClause}))`;
    const rewritten = rewriteProfilePropertyRefs(combined, ['plan']);

    expect(rewritten).toContain('`profile.properties.plan` =');
    expect(rewritten).toContain("e.properties['level_mode'] != ''");
    expect(rewritten).not.toContain('mapContains(profile.properties');
  });

  it('keeps the full map when a wildcard profile reference is present', () => {
    const { keys, needsFullMap } = collectProfilePropertyKeys([
      { name: 'profile.properties.plan' },
      { name: 'profile.properties.*' },
    ]);

    expect(keys).toEqual(['plan']);
    expect(needsFullMap).toBe(true);

    // The narrowed key still rewrites; the wildcard ref keeps the Map alive.
    const clause = compileEventFilter(
      { name: 'profile.properties.plan', operator: 'hasProperty', value: [] },
      'p',
      'e',
      'events',
    );
    expect(rewriteProfilePropertyRefs(clause as string, keys)).toBe(
      "`profile.properties.plan` != ''",
    );
  });
});
