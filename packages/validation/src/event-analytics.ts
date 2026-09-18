import { z } from 'zod';
import { zChartEventFilter, zRange } from './chart-primitives';
import { zFilterGroup } from './filter-group';

/**
 * Shared contract for the AppMetrica-style Event Analytics tree
 * (event → property key → value → nested key, up to 4 levels below the event).
 *
 * See docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md §4.
 */

/**
 * How deep below the event a node may sit. Levels are counted from the event:
 * property key (1) -> value (2) -> nested key (3) -> value of that key (4).
 */
export const EVENT_ANALYTICS_MAX_DEPTH = 4;

/**
 * How many `key = value` pairs a request may carry.
 *
 * The node being queried occupies a level of its own, so the pairs only cover
 * its ancestors: `eventPropertyKeys` with no pairs returns level 1 keys and
 * with one pair returns level 3 keys, while `eventPropertyValues` with one
 * pair returns level 4 values -- the deepest node the tree allows. A second
 * pair would ask for level 5 keys / level 6 values, past the limit.
 */
export const EVENT_ANALYTICS_MAX_PARENT_PATH = 1;

/**
 * How many metric columns the table may show at once. Declared BEFORE the
 * schemas: `.max(...)` reads it while the module loads, and a constant declared
 * afterwards would be read from its temporal dead zone.
 */
export const EVENT_ANALYTICS_MAX_METRICS = 10;

/**
 * How many periods one comparison may hold, baseline included (Phase 3 R3 §8).
 * Declared before the schema that reads it in `.max(...)`.
 */
export const EVENT_ANALYTICS_MAX_PERIODS = 4;

export type IEventAnalyticsMetricGroup = 'events' | 'users';

export type IEventAnalyticsMetricDef = {
  /** Column header and picker label, from the design's `metricDefs`. */
  label: string;
  group: IEventAnalyticsMetricGroup;
  /** Reads one event property, which the caller must name. */
  param: boolean;
  /**
   * Whether a parent's value is the sum of its children's. `events` and the
   * parameter sum are; user counts and every ratio are not, because the same
   * user appears under several branches. The table must never add up a
   * non-additive column.
   */
  additive: boolean;
  /** Cannot be removed in the picker. */
  locked: boolean;
  /** Tooltip text, from the design. */
  help: string;
};

/**
 * The metric catalogue. One source for the picker, the table header, the chart
 * metric select and the SQL builder.
 *
 * Insertion order is the order the picker lists them in, grouped by `group`
 * under the titles "Metrics by events" and "Metrics by users".
 *
 * See docs/superpowers/specs/2026-09-16-event-analytics-phase2-design.md §4.1.
 */
export const EVENT_ANALYTICS_METRICS = {
  events: {
    label: 'Events',
    group: 'events',
    param: false,
    additive: true,
    locked: true,
    help: 'Total number of events in the period',
  },
  uniq_param: {
    label: 'Unique parameter values',
    group: 'events',
    param: true,
    additive: false,
    locked: false,
    help: 'The number of unique values of the selected event parameter',
  },
  sum_param: {
    label: 'Sum of parameter values',
    group: 'events',
    param: true,
    additive: true,
    locked: false,
    help: 'The sum of values of the selected event parameter',
  },
  avg_param: {
    label: 'Average parameter value',
    group: 'events',
    param: true,
    additive: false,
    locked: false,
    help: 'The sum of values of the selected event parameter divided by the number of events',
  },
  median_param: {
    label: 'Median value of the parameter',
    group: 'events',
    param: true,
    additive: false,
    locked: false,
    help: 'The median value of the selected event parameter',
  },
  users: {
    label: 'Users',
    group: 'users',
    param: false,
    additive: false,
    locked: false,
    help: 'The number of users with the event',
  },
  epu: {
    label: 'Events per user',
    group: 'users',
    param: false,
    additive: false,
    locked: false,
    help: 'The ratio of the number of events to the number of users with the event (not all tracked users)',
  },
  /**
   * The AppMetrica definition of "events per user" divides by every tracked
   * user, not by the users who fired the event. Phase 1 shipped the latter
   * under the `epu` label, so both live in the catalogue rather than one
   * silently changing meaning. Same app-wide denominator as `pctu`.
   */
  epau: {
    label: 'Events per app user',
    group: 'users',
    param: false,
    additive: false,
    locked: false,
    help: 'The ratio of the number of events to the total number of app users (all tracked users, not only users with the event)',
  },
  pctu: {
    label: '% of all users',
    group: 'users',
    param: false,
    additive: false,
    locked: false,
    help: 'The percentage of users with the event out of the total number of app users',
  },
  uniq_param_user: {
    label: 'Unique parameter values per user',
    group: 'users',
    param: true,
    additive: false,
    locked: false,
    help: 'The ratio of the number of unique values of the selected event parameter to the number of users with the event',
  },
  sum_param_user: {
    label: 'Sum of parameter values per user',
    group: 'users',
    param: true,
    additive: false,
    locked: false,
    help: 'The ratio of the sum of values of the selected event parameter to the number of users with the event',
  },
} as const satisfies Record<string, IEventAnalyticsMetricDef>;

export type IEventAnalyticsMetricId = keyof typeof EVENT_ANALYTICS_METRICS;

const METRIC_IDS = Object.keys(EVENT_ANALYTICS_METRICS) as [
  IEventAnalyticsMetricId,
  ...IEventAnalyticsMetricId[],
];

export const zEventAnalyticsMetricId = z.enum(METRIC_IDS);

export const zEventAnalyticsMetric = z.object({
  id: zEventAnalyticsMetricId,
  /**
   * The event property a parameter metric reads. Required for the metrics whose
   * catalogue entry has `param: true`, forbidden for the others — enforced by
   * `refineMetrics` below, because the rule depends on the id.
   */
  param: z.string().optional(),
});

export type IEventAnalyticsMetric = z.infer<typeof zEventAnalyticsMetric>;

/**
 * The stable identifier of a metric column, used as the key in the response
 * `metrics` map, as the `sort` value, and in the persisted preferences.
 *
 * The parameter is part of the key, so the same metric on two parameters is two
 * distinct columns.
 */
export function metricKey(metric: IEventAnalyticsMetric): string {
  return metric.param ? `${metric.id}:${metric.param}` : metric.id;
}

/** Sort keys that predate the metric catalogue and stay valid forever. */
/** One comparison period. `periods[0]` is the baseline the UI labels A. */
export const zEventAnalyticsPeriod = z.object({
  startDate: z.string(),
  endDate: z.string(),
});

export type IEventAnalyticsPeriod = z.infer<typeof zEventAnalyticsPeriod>;

const PERIOD_LABELS = ['A', 'B', 'C', 'D'] as const;

/** The letter the UI shows for a period index. */
export function periodLabel(index: number): string {
  return PERIOD_LABELS[index] ?? String(index + 1);
}

/** `sort` may carry the clicked column's period, e.g. `events:B`. */
const PERIOD_SORT_SUFFIX = /:(A|B|C|D)$/;

/**
 * The metric a `sort` value names, with any period suffix removed.
 *
 * Clicking period B's column sorts by that metric of period A, so the rows keep
 * one order across every period (Phase 3 §3 D7).
 */
export function sortKeyWithoutPeriod(sort: string): string {
  return sort.replace(PERIOD_SORT_SUFFIX, '');
}

const LEGACY_SORT_KEYS = ['events', 'users', 'epu'] as const;

// `epau` is deliberately NOT here: it is a catalogue metric, so it becomes a
// valid sort key only when the request asks for it.

/** Which `sort` values a request may carry, given the metrics it asked for. */
export function allowedSortKeys(
  metrics: IEventAnalyticsMetric[] | undefined,
): string[] {
  const keys = new Set<string>(LEGACY_SORT_KEYS);
  for (const metric of metrics ?? []) {
    keys.add(metricKey(metric));
  }
  return Array.from(keys);
}

/**
 * The rules that depend on the catalogue rather than on one field's shape. Used
 * by both the request schema and the persisted-preferences schema so a stored
 * metric set is exactly as valid as a requested one.
 */
function refineMetrics(
  metrics: IEventAnalyticsMetric[],
  ctx: z.RefinementCtx,
): void {
  const seen = new Set<string>();

  for (const [index, metric] of metrics.entries()) {
    const def = EVENT_ANALYTICS_METRICS[metric.id];

    if (def.param && !metric.param) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'param'],
        message: `Metric "${metric.id}" needs a parameter`,
      });
    }

    if (!def.param && metric.param !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'param'],
        message: `Metric "${metric.id}" takes no parameter`,
      });
    }

    const key = metricKey(metric);
    if (seen.has(key)) {
      ctx.addIssue({
        code: 'custom',
        path: [index],
        message: `Duplicate metric "${key}"`,
      });
    }
    seen.add(key);
  }

  // `events` is locked in the picker, but the server does not trust the UI.
  if (!metrics.some((metric) => metric.id === 'events')) {
    ctx.addIssue({
      code: 'custom',
      message: 'The "events" metric is required',
    });
  }
}

const zEventAnalyticsMetrics = z
  .array(zEventAnalyticsMetric)
  .max(EVENT_ANALYTICS_MAX_METRICS)
  .superRefine(refineMetrics);


/**
 * Open-ended because any metric column can be sorted on. The value is checked
 * against the request's own metrics by `refineSort` below, so an unknown key is
 * rejected at the boundary rather than silently ignored in SQL.
 */
export const zEventAnalyticsSortKey = z.string();
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


const PERIOD_DAY_MS = 24 * 60 * 60 * 1000;

function periodBounds(period: IEventAnalyticsPeriod): [number, number] | null {
  const start = Date.parse(period.startDate.replace(' ', 'T'));
  const end = Date.parse(period.endDate.replace(' ', 'T'));
  return Number.isNaN(start) || Number.isNaN(end) ? null : [start, end];
}

/**
 * Periods must be the same length and must not overlap (invariant I10).
 *
 * Same length: a comparison where one column covers 7 days and another 30 puts
 * two different questions under one header. The UI locks the length to the
 * baseline's; this rejects a hand-written payload that does not.
 *
 * No overlap: an event inside two periods would be counted twice, and every
 * total below it would stop meaning anything.
 */
function refinePeriods(
  periods: IEventAnalyticsPeriod[],
  ctx: z.RefinementCtx,
): void {
  if (periods.length === 0) {
    // `.min(1)` already reported it; without this the baseline read below
    // would throw instead of collecting issues.
    return;
  }

  const bounds: [number, number][] = [];

  for (const [index, period] of periods.entries()) {
    const parsed = periodBounds(period);
    if (!parsed) {
      ctx.addIssue({
        code: 'custom',
        path: [index],
        message: 'Period dates must be parseable timestamps',
      });
      return;
    }
    if (parsed[1] <= parsed[0]) {
      ctx.addIssue({
        code: 'custom',
        path: [index],
        message: 'A period must end after it starts',
      });
      return;
    }
    bounds.push(parsed);
  }

  // Compare in whole days: the UI builds a period as [00:00:00, 23:59:59], so
  // two 7-day periods differ by a second, not by nothing.
  const days = ([start, end]: [number, number]) =>
    Math.round((end - start) / PERIOD_DAY_MS);
  const baselineDays = days(bounds[0] as [number, number]);

  for (const [index, bound] of bounds.entries()) {
    if (days(bound) !== baselineDays) {
      ctx.addIssue({
        code: 'custom',
        path: [index],
        message: `Every period must have the same length as the baseline (${baselineDays} days)`,
      });
    }
  }

  const sorted = bounds
    .map((bound, index) => ({ bound, index }))
    .sort((a, b) => a.bound[0] - b.bound[0]);

  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (previous && current && current.bound[0] <= previous.bound[1]) {
      ctx.addIssue({
        code: 'custom',
        path: [current.index],
        message: 'Periods must not overlap',
      });
    }
  }
}

const zEventAnalyticsPeriods = z
  .array(zEventAnalyticsPeriod)
  .min(1)
  .max(EVENT_ANALYTICS_MAX_PERIODS)
  .superRefine(refinePeriods);

/** Date range + filters every event analytics endpoint takes. */
export const zEventAnalyticsRange = z.object({
  projectId: z.string(),
  range: zRange,
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  filters: z.array(zChartEventFilter),
  /**
   * Advanced filters: an AND/OR condition tree. Wins over `filters` when
   * present; a plain array stays valid as an implicit AND root.
   */
  filterGroup: zFilterGroup.optional(),
  /**
   * Metric columns to compute. Absent means the legacy behaviour: `events` and
   * `users` only.
   */
  metrics: zEventAnalyticsMetrics.optional(),
  /**
   * Comparison periods, baseline first. Absent means one period and the SQL is
   * unchanged. See the Phase 3 spec §4.
   */
  periods: zEventAnalyticsPeriods.optional(),
});

/**
 * Reject a `sort` that names a metric the request did not ask for. Applied to
 * every input that carries both fields. Without it an unknown key would reach
 * the SQL builder's lookup table and fall through to a default, silently
 * sorting by something the caller did not choose.
 */
function refineSort(
  input: { sort: string; metrics?: IEventAnalyticsMetric[] },
  ctx: z.RefinementCtx,
): void {
  if (!allowedSortKeys(input.metrics).includes(sortKeyWithoutPeriod(input.sort))) {
    ctx.addIssue({
      code: 'custom',
      path: ['sort'],
      message: `Cannot sort by "${input.sort}": it is not one of the requested metrics`,
    });
  }
}

export const zEventAnalyticsListInput = zEventAnalyticsRange
  .extend({
    search: z.string().optional(),
    sort: zEventAnalyticsSortKey,
    dir: zEventAnalyticsSortDir,
    cursor: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).default(10),
  })
  .superRefine(refineSort);

export const zEventAnalyticsTotalsInput = zEventAnalyticsRange;

export const zEventPropertyKeysInput = zEventAnalyticsRange.extend({
  event: z.string(),
  prefix: z.string(),
  parentPath: zEventAnalyticsParentPath,
  cursor: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).default(20),
});

export const zEventPropertyValuesInput = zEventAnalyticsRange
  .extend({
    event: z.string(),
    key: z.string(),
    type: zEventAnalyticsPropertyType,
    parentPath: zEventAnalyticsParentPath,
    sort: zEventAnalyticsSortKey,
    dir: zEventAnalyticsSortDir,
    cursor: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).default(5),
  })
  .superRefine(refineSort);

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

/**
 * `events` and `users` stay mandatory: `events` is locked in the picker, and
 * `users` backs both the `% of all users` denominator and the deduplication
 * note. Everything else the caller asked for arrives in `metrics`, keyed by
 * `metricKey`, so existing readers keep working untouched.
 */
export type IEventAnalyticsMetricRow = {
  events: number;
  users: number;
  metrics?: Record<string, number>;
  /**
   * One entry per requested period, baseline first, present only when the
   * request asked for more than one. `periods[0]` repeats the three fields
   * above, so every existing reader keeps working untouched.
   */
  periods?: Array<{
    events: number;
    users: number;
    metrics?: Record<string, number>;
  }>;
};

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

/**
 * The per-project view preferences persisted in localStorage under
 * `op:event-analytics:v1:<projectId>`.
 *
 * Anything that fails this schema is discarded wholesale — a half-restored view
 * is harder to explain than a fresh one. Filters are deliberately absent: they
 * live in the URL so a view stays shareable.
 *
 * See docs/superpowers/specs/2026-09-16-event-analytics-phase2-design.md §6.
 */
export const EVENT_ANALYTICS_PREFS_VERSION = 1;

export function eventAnalyticsPrefsKey(projectId: string): string {
  return `op:event-analytics:v${EVENT_ANALYTICS_PREFS_VERSION}:${projectId}`;
}

export const zEventAnalyticsPreferences = z.object({
  version: z.literal(EVENT_ANALYTICS_PREFS_VERSION),
  metrics: zEventAnalyticsMetrics,
  sort: z.object({
    key: zEventAnalyticsSortKey,
    dir: zEventAnalyticsSortDir,
  }),
  pct: z.boolean(),
  chart: z.object({
    metric: z.string(),
    granularity: z.string(),
    type: z.string(),
    collapsed: z.boolean(),
  }),
  /**
   * Plotted paths. An empty array is a deliberate choice and must be honoured;
   * the cold-start default applies only when the entry is ABSENT.
   */
  selected: z.array(z.string()),
});

export type IEventAnalyticsPreferences = z.infer<
  typeof zEventAnalyticsPreferences
>;
