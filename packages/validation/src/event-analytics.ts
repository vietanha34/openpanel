import { z } from 'zod';
import { zChartEventFilter, zRange } from './index';

/**
 * Shared contract for the AppMetrica-style Event Analytics tree
 * (event → property key → value → nested key, up to 4 levels below the event).
 *
 * See docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md §4.
 */

/** How deep below the event a node may sit (key, value, key, value). */
export const EVENT_ANALYTICS_MAX_DEPTH = 4;

/** Each parentPath entry narrows two levels (a key and its value). */
export const EVENT_ANALYTICS_MAX_PARENT_PATH = EVENT_ANALYTICS_MAX_DEPTH / 2;

export const zEventAnalyticsSortKey = z.enum(['events', 'users', 'epu']);
export const zEventAnalyticsSortDir = z.enum(['asc', 'desc']);
export const zEventAnalyticsPropertyType = z.enum(['num', 'str', 'unknown']);
export const zEventAnalyticsPropertyKind = z.enum(['key', 'obj']);

/** One `key = value` narrowing step on the way down the tree. */
export const zEventAnalyticsParentPathItem = z.object({
  key: z.string(),
  value: z.string(),
});

const zEventAnalyticsParentPath = z
  .array(zEventAnalyticsParentPathItem)
  .max(EVENT_ANALYTICS_MAX_PARENT_PATH);

/** Date range + filters every event analytics endpoint takes. */
export const zEventAnalyticsRange = z.object({
  projectId: z.string(),
  range: zRange,
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  filters: z.array(zChartEventFilter),
});

export const zEventAnalyticsListInput = zEventAnalyticsRange.extend({
  search: z.string().optional(),
  sort: zEventAnalyticsSortKey,
  dir: zEventAnalyticsSortDir,
  cursor: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).default(10),
});

export const zEventAnalyticsTotalsInput = zEventAnalyticsRange;

export const zEventPropertyKeysInput = zEventAnalyticsRange.extend({
  event: z.string(),
  prefix: z.string(),
  parentPath: zEventAnalyticsParentPath,
  cursor: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).default(20),
});

export const zEventPropertyValuesInput = zEventAnalyticsRange.extend({
  event: z.string(),
  key: z.string(),
  type: zEventAnalyticsPropertyType,
  parentPath: zEventAnalyticsParentPath,
  sort: zEventAnalyticsSortKey,
  dir: zEventAnalyticsSortDir,
  cursor: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).default(5),
});

export type IEventAnalyticsSortKey = z.infer<typeof zEventAnalyticsSortKey>;
export type IEventAnalyticsSortDir = z.infer<typeof zEventAnalyticsSortDir>;
export type IEventAnalyticsPropertyType = z.infer<
  typeof zEventAnalyticsPropertyType
>;
export type IEventAnalyticsPropertyKind = z.infer<
  typeof zEventAnalyticsPropertyKind
>;
export type IEventAnalyticsParentPathItem = z.infer<
  typeof zEventAnalyticsParentPathItem
>;
export type IEventAnalyticsRange = z.infer<typeof zEventAnalyticsRange>;
export type IEventAnalyticsListInput = z.infer<typeof zEventAnalyticsListInput>;
export type IEventAnalyticsTotalsInput = z.infer<
  typeof zEventAnalyticsTotalsInput
>;
export type IEventPropertyKeysInput = z.infer<typeof zEventPropertyKeysInput>;
export type IEventPropertyValuesInput = z.infer<
  typeof zEventPropertyValuesInput
>;

/** UI derives events/user and the percentages from the totals row. */
export type IEventAnalyticsMetricRow = { events: number; users: number };

export type IEventAnalyticsListRow = IEventAnalyticsMetricRow & {
  name: string;
};
export type IEventAnalyticsListOutput = {
  rows: IEventAnalyticsListRow[];
  nextCursor: number | null;
};

/** Deduplicated across all events — never the sum of the branches. */
export type IEventAnalyticsTotalsOutput = IEventAnalyticsMetricRow;

export type IEventPropertyKeyRow = IEventAnalyticsMetricRow & {
  key: string;
  kind: IEventAnalyticsPropertyKind;
  type: IEventAnalyticsPropertyType;
};
export type IEventPropertyKeysOutput = {
  rows: IEventPropertyKeyRow[];
  nextCursor: number | null;
};

export type IEventPropertyValueRow = IEventAnalyticsMetricRow & {
  value: string;
};
export type IEventPropertyValuesOutput = {
  rows: IEventPropertyValueRow[];
  remaining: number;
  nextCursor: number | null;
};
