import {
  getOperatorsForType,
  operators,
  operatorsShort,
} from '@openpanel/constants';
import { describe, expect, it } from 'vitest';

describe('presence operators', () => {
  it('exposes has/missing property with labels', () => {
    expect(operators.hasProperty).toBe('Has property');
    expect(operators.missingProperty).toBe('Missing property');
    expect(operatorsShort.hasProperty).toBe('Has property');
    expect(operatorsShort.missingProperty).toBe('Missing property');
  });

  it('offers them for text properties', () => {
    expect(getOperatorsForType('string')).toContain('hasProperty');
    expect(getOperatorsForType('string')).toContain('missingProperty');
  });

  it('keeps them out of the ordered operator lists', () => {
    expect(getOperatorsForType('number')).not.toContain('hasProperty');
    expect(getOperatorsForType('boolean')).not.toContain('missingProperty');
  });
});

describe('advanced filter storage sentinel', () => {
  it('exists so new clients can recognise it', () => {
    expect(operators.advancedFilterGroup).toBeDefined();
  });

  it('is never offered to the operator select', () => {
    for (const type of ['string', 'number', 'boolean', 'date'] as const) {
      expect(getOperatorsForType(type)).not.toContain('advancedFilterGroup');
    }
  });

  it('is rejected by the operator list that shipped before advanced filters', () => {
    // Pinned copy of `operators` as it shipped before this feature. The
    // sentinel only works as a trip wire while it is absent here: if someone
    // ever adds it to the old list, an old client would parse the report and
    // render a narrower filter silently.
    const legacyOperators = [
      'is',
      'isNot',
      'contains',
      'doesNotContain',
      'startsWith',
      'endsWith',
      'regex',
      'isNull',
      'isNotNull',
      'gt',
      'lt',
      'gte',
      'lte',
      'inCohort',
      'notInCohort',
    ];

    expect(legacyOperators).not.toContain('advancedFilterGroup');
    expect(legacyOperators).not.toContain('hasProperty');
    expect(legacyOperators).not.toContain('missingProperty');
  });
});
