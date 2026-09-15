import { z } from 'zod';

import {
  filterValueTypes,
  operators,
  timeWindows,
} from '@openpanel/constants';

/**
 * Leaf schemas with no dependencies on the rest of this package.
 *
 * `index.ts` re-exports everything here, so other modules in the package can
 * import these directly instead of reaching back through the barrel and
 * closing an import cycle.
 */

export function objectToZodEnums<K extends string>(
  obj: Record<K, any>,
): [K, ...K[]] {
  const [firstKey, ...otherKeys] = Object.keys(obj) as K[];
  return [firstKey!, ...otherKeys];
}

export const mapKeys = objectToZodEnums;

export const zRange = z.enum(objectToZodEnums(timeWindows));

export const zChartEventFilter = z.object({
  id: z.string().optional().describe('Unique identifier for the filter'),
  name: z.string().describe('The property name to filter on'),
  operator: z
    .enum(objectToZodEnums(operators))
    .describe('The operator to use for the filter'),
  value: z
    .array(z.string().or(z.number()).or(z.boolean()).or(z.null()))
    .describe('The values to filter on'),
  type: z
    .enum(objectToZodEnums(filterValueTypes))
    .optional()
    .describe(
      'Cast type for the column/value in equality & comparison operators ' +
        '(string/number/date/datetime/boolean). Absent = legacy behavior.',
    ),
  cohortId: z
    .string()
    .optional()
    .describe(
      'DEPRECATED: legacy single-cohort id, kept for saved reports. ' +
        'New code reads cohortIds via getCohortIds(filter).',
    ),
  cohortIds: z
    .array(z.string())
    .optional()
    .describe(
      'Cohort IDs for inCohort/notInCohort. Multiple ids OR-match ' +
        '(matches profiles in any of the listed cohorts).',
    ),
});
