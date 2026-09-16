/**
 * A report whose filtering cannot be expressed as a flat AND list must refuse
 * to render on a client that does not understand groups, rather than draw a
 * number that is wrong and looks right. See the advanced filters spec §4.1.
 */
import {
  ADVANCED_FILTER_SCHEMA_VERSION,
  ADVANCED_FILTER_SENTINEL_NAME,
} from '@openpanel/constants';
import { describe, expect, it } from 'vitest';

import {
  ADVANCED_FILTER_REFUSAL_MESSAGE,
  advancedFilterSentinel,
  assertReportRenderable,
  usesAdvancedFilters,
} from './reports.service';

const plainReport = { options: { schemaVersion: 1 } };
const advancedReport = {
  options: { schemaVersion: ADVANCED_FILTER_SCHEMA_VERSION },
};

describe('usesAdvancedFilters', () => {
  it('is false for a report with no schemaVersion', () => {
    expect(usesAdvancedFilters({ options: null })).toBe(false);
  });

  it('is false for schemaVersion 1', () => {
    expect(usesAdvancedFilters(plainReport)).toBe(false);
  });

  it('is true for schemaVersion 2', () => {
    expect(usesAdvancedFilters(advancedReport)).toBe(true);
  });
});

describe('assertReportRenderable', () => {
  it('refuses an advanced report for a caller without group support', () => {
    expect(() => assertReportRenderable(advancedReport, false)).toThrow(
      ADVANCED_FILTER_REFUSAL_MESSAGE,
    );
  });

  it('allows an advanced report for a caller with group support', () => {
    expect(() => assertReportRenderable(advancedReport, true)).not.toThrow();
  });

  it('never refuses a plain report', () => {
    expect(() => assertReportRenderable(plainReport, false)).not.toThrow();
    expect(() => assertReportRenderable({ options: null }, false)).not.toThrow();
  });

  it('carries the exact message the dashboard shows', () => {
    expect(ADVANCED_FILTER_REFUSAL_MESSAGE).toBe(
      'This report uses advanced filters. Update to a newer dashboard version to view it.',
    );
  });
});

describe('advancedFilterSentinel', () => {
  it('is the only filters entry an advanced report stores', () => {
    expect(advancedFilterSentinel()).toEqual([
      {
        name: ADVANCED_FILTER_SENTINEL_NAME,
        operator: 'advancedFilterGroup',
        value: [],
      },
    ]);
  });
});
