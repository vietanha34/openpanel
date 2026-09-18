import { average, sum } from '@openpanel/common';
import { chartColors } from '@openpanel/constants';
import {
  EVENT_ANALYTICS_MAX_DEPTH,
  EVENT_ANALYTICS_MAX_PARENT_PATH,
  type IChartEventFilter,
  type IEventAnalyticsListInput,
  type IEventAnalyticsListOutput,
  type IEventAnalyticsListRow,
  type IEventAnalyticsMetric,
  type IEventAnalyticsMetricRow,
  type IEventAnalyticsParentPathItem,
  type IEventAnalyticsPeriod,
  type IEventAnalyticsSortKey,
  type IEventPropertyKeyRow,
  type IEventPropertyKeysOutput,
  type IEventPropertyValuesOutput,
  type IFilterGroup,
  zEventAnalyticsParentPathItem,
  zEventAnalyticsPropertyType,
  zEventAnalyticsSortDir,
  zEventAnalyticsSortKey,
  metricKey,
  sortKeyWithoutPeriod,
  zTimeInterval,
} from '@openpanel/validation';
import sqlstring from 'sqlstring';
import { z } from 'zod';
import {
  ch,
  convertClickhouseDateToJs,
  isClickhouseDefaultMinDate,
  TABLE_NAMES,
} from '../clickhouse/client';
import { clix } from '../clickhouse/query-builder';
import { compileFilterGroup } from './filter-group.service';
import {
  compileEventAnalyticsFilter,
  getEventFiltersWhereClause,
  getSelectPropertyKey,
  UTM_COLUMNS,
} from './chart.service';

// Constants
const ROLLUP_DATE_PREFIX = '1970-01-01';

/**
 * ClickHouse returns counts as strings; an empty range returns no row at all.
 * The UI divides by these, so never hand it `NaN` or `Infinity`.
 */
function toFiniteCount(value: number | string | undefined): number {
  const count = Number(value);
  return Number.isFinite(count) ? count : 0;
}

// Toggle revenue tracking in overview queries
const INCLUDE_REVENUE = true; // TODO: Make this configurable later

// Maximum number of records to return (for detail modals)
const MAX_RECORDS_LIMIT = 1000;

const COLUMN_PREFIX_MAP: Record<string, string> = {
  region: 'country',
  city: 'country',
  browser_version: 'browser',
  os_version: 'os',
};

const WHITELISTED_FILTERS = [
  'os',
  'path',
  'city',
  'brand',
  'model',
  'origin',
  'region',
  'device',
  'revenue',
  'country',
  'browser',
  'referrer',
  'os_version',
  'referrer_name',
  'browser_version',
  'referrer_type',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
];


// Types
type MetricsRow = {
  bounce_rate: number;
  unique_visitors: number;
  total_sessions: number;
  avg_session_duration: number;
  total_screen_views: number;
  views_per_session: number;
};

type MetricsSeriesRow = MetricsRow & { date: string; total_revenue: number };

export const zGetMetricsInput = z.object({
  projectId: z.string(),
  filters: z.array(z.any()),
  startDate: z.string(),
  endDate: z.string(),
  interval: zTimeInterval,
});

export type IGetMetricsInput = z.infer<typeof zGetMetricsInput> & {
  timezone: string;
};

export const zGetTopPagesInput = z.object({
  projectId: z.string(),
  filters: z.array(z.any()),
  startDate: z.string(),
  endDate: z.string(),
  limit: z.number().min(1).max(1000).optional(),
});

export type IGetTopPagesInput = z.infer<typeof zGetTopPagesInput> & {
  timezone: string;
};

export const zGetTopEntryExitInput = z.object({
  projectId: z.string(),
  filters: z.array(z.any()),
  startDate: z.string(),
  endDate: z.string(),
  mode: z.enum(['entry', 'exit']),
  limit: z.number().min(1).max(1000).optional(),
});

export type IGetTopEntryExitInput = z.infer<typeof zGetTopEntryExitInput> & {
  timezone: string;
};

export const zGetTopGenericInput = z.object({
  projectId: z.string(),
  filters: z.array(z.any()),
  startDate: z.string(),
  endDate: z.string(),
  column: z.enum([
    // Referrers
    'referrer',
    'referrer_name',
    'referrer_type',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    // Geo
    'region',
    'country',
    'city',
    // Device
    'device',
    'brand',
    'model',
    'browser',
    'browser_version',
    'os',
    'os_version',
  ]),
});

export type IGetTopGenericInput = z.infer<typeof zGetTopGenericInput> & {
  timezone: string;
};

export const zGetTopGenericSeriesInput = zGetTopGenericInput.extend({
  interval: zTimeInterval,
});

export type IGetTopGenericSeriesInput = z.infer<
  typeof zGetTopGenericSeriesInput
> & {
  timezone: string;
};

export const zGetUserJourneyInput = z.object({
  projectId: z.string(),
  filters: z.array(z.any()),
  startDate: z.string(),
  endDate: z.string(),
  steps: z.number().min(2).max(10).default(5),
});

export type IGetUserJourneyInput = z.infer<typeof zGetUserJourneyInput> & {
  timezone: string;
};

export const zGetTopEventsInput = z.object({
  projectId: z.string(),
  filters: z.array(z.any()),
  startDate: z.string(),
  endDate: z.string(),
  excludeEvents: z.array(z.string()).optional(),
});

export type IGetTopEventsInput = z.infer<typeof zGetTopEventsInput> & {
  timezone: string;
};

type IEventAnalyticsRangeQuery = {
  projectId: string;
  filters: IChartEventFilter[];
  /** Advanced filters. Wins over `filters` when present. */
  filterGroup?: IFilterGroup;
  startDate: string;
  endDate: string;
  timezone: string;
  /** Metric columns to add. Absent means `events` and `users` only. */
  metrics?: IEventAnalyticsMetric[];
  /**
   * Comparison periods, baseline first. One period (or none) behaves exactly as
   * before; more than one splits every aggregate per period.
   */
  periods?: IEventAnalyticsPeriod[];
};

export type IGetEventAnalyticsListInput = IEventAnalyticsRangeQuery &
  Pick<IEventAnalyticsListInput, 'sort' | 'dir' | 'limit'> & {
    search?: string;
    cursor?: number;
  };

export type IGetEventAnalyticsTotalsInput = IEventAnalyticsRangeQuery;

/**
 * Every event analytics query reads the same filtered slice of the events
 * table, so the totals can never drift away from the rows of the list.
 */
function buildEventAnalyticsBaseQuery({
  projectId,
  filters,
  filterGroup,
  startDate,
  endDate,
  timezone,
  periods,
}: IEventAnalyticsRangeQuery) {
  // Comparison mode reads every period from ONE scan of their union; the
  // per-period numbers come from the `*If` aggregates in the SELECT.
  const comparison = comparisonPeriods(periods);
  if (comparison) {
    const union = eventAnalyticsPeriodUnion(comparison);
    startDate = union.startDate;
    endDate = union.endDate;
  }
  return clix(ch, timezone)
    .from(TABLE_NAMES.events, false)
    .where('project_id', '=', projectId)
    .where('created_at', 'BETWEEN', [
      clix.datetime(startDate, 'toDateTime'),
      clix.datetime(endDate, 'toDateTime'),
    ])
    .rawWhere(
      new OverviewService(ch).getEventAnalyticsWhereClause(
        filters,
        projectId,
        filterGroup
      )
    );
}

/** ClickHouse reads `%` and `_` as ILIKE wildcards; a search term is literal. */
const LIKE_WILDCARD_RE = /[\\%_]/g;

function escapeLikeTerm(term: string) {
  return term.replace(LIKE_WILDCARD_RE, '\\$&');
}

/**
 * The aggregate behind one metric column, or `null` when the metric needs none
 * of its own: `events` and `users` are always selected, and `epu`, `pctu` and
 * `epau` are ratios the renderer derives from the row and the totals.
 *
 * See docs/superpowers/specs/2026-09-16-event-analytics-phase2-design.md §5.
 */
export function eventAnalyticsMetricExpression(
  metric: IEventAnalyticsMetric,
  /**
   * When set, every aggregate is restricted to this period with the `*If`
   * family. Comparison mode scans the union of the periods once and splits the
   * numbers here, so a user active in two periods is counted once in EACH —
   * never once across the union (Phase 3 §3 D2).
   */
  periodCondition?: string
): string | null {
  const param = () => {
    if (!metric.param) {
      throw new Error(`Metric "${metric.id}" needs a parameter`);
    }
    // §3 D4: in a METRIC a missing or non-numeric value counts as 0. Filters
    // do the opposite (`toFloat64OrNull`, no fallback, so it matches nothing).
    // Do not unify the two. `coalesce` rather than `toFloat64OrZero` so the
    // zero reads as a decision.
    return `coalesce(toFloat64OrNull(properties[${sqlstring.escape(metric.param)}]), 0)`;
  };

  const where = periodCondition;
  const uniq = (expr: string) =>
    where ? `uniqExactIf(${expr}, ${where})` : `uniqExact(${expr})`;
  const total = (expr: string) =>
    where ? `sumIf(${expr}, ${where})` : `sum(${expr})`;
  const rows = () => (where ? `countIf(${where})` : 'count()');
  const users = () => uniq('profile_id');

  switch (metric.id) {
    case 'uniq_param':
      return uniq(param());
    case 'sum_param':
      return total(param());
    // Not `avg`: the denominator is every event in the node, written out so a
    // refactor cannot quietly narrow it to the events carrying the parameter.
    case 'avg_param':
      return `${total(param())} / ${rows()}`;
    // Exact, so the median does not wobble between page loads.
    case 'median_param':
      return where
        ? `quantileExactIf(0.5)(${param()}, ${where})`
        : `quantileExact(0.5)(${param()})`;
    case 'uniq_param_user':
      return `${uniq(param())} / ${users()}`;
    case 'sum_param_user':
      return `${total(param())} / ${users()}`;
    default:
      return null;
  }
}

/**
 * Metric keys such as `sum_param:day` carry free text, so the columns are
 * aliased by their position in the request instead.
 */
function eventAnalyticsMetricAlias(index: number, period?: number): string {
  return period === undefined
    ? `metric_${index}`
    : `metric_${index}_p${period}`;
}

/**
 * Comparison periods worth splitting the aggregates by: more than one. One
 * period (or none) is an ordinary report and must emit today's SQL byte for
 * byte, so everything below treats it as "no periods".
 */
function comparisonPeriods(
  periods: IEventAnalyticsPeriod[] | undefined
): IEventAnalyticsPeriod[] | undefined {
  return periods && periods.length > 1 ? periods : undefined;
}

/** A select entry: a plain column string, or raw SQL the builder must not touch. */
type SelectColumn = string | ReturnType<typeof clix.exp>;

/** `created_at` inside one period, for the `*If` aggregates. */
function eventAnalyticsPeriodCondition(period: IEventAnalyticsPeriod): string {
  return `created_at BETWEEN toDateTime(${sqlstring.escape(period.startDate)}) AND toDateTime(${sqlstring.escape(period.endDate)})`;
}

/** The union of every period, so one scan covers them all. */
export function eventAnalyticsPeriodUnion(
  periods: IEventAnalyticsPeriod[]
): { startDate: string; endDate: string } {
  const starts = periods.map((period) => period.startDate).sort();
  const ends = periods.map((period) => period.endDate).sort();
  return {
    startDate: starts[0] as string,
    endDate: ends[ends.length - 1] as string,
  };
}

/**
 * `events` and `users` — the two columns every endpoint selects. Split per
 * period in comparison mode, with the period index in the alias.
 */
function eventAnalyticsCoreSelects(
  periods: IEventAnalyticsPeriod[] | undefined
): SelectColumn[] {
  const comparison = comparisonPeriods(periods);
  if (!comparison) {
    return ['count() AS events', 'uniqExact(profile_id) AS users'];
  }

  return comparison.flatMap<SelectColumn>((period, index) => {
    const condition = eventAnalyticsPeriodCondition(period);
    // clix.exp: a plain string column runs through escapeDate(), which would
    // quote the date literals this condition already escaped and emit
    // ''2026-09-12 00:00:00''. The builder's own comment calls that out.
    return [
      clix.exp(`countIf(${condition}) AS events_p${index}`),
      clix.exp(`uniqExactIf(profile_id, ${condition}) AS users_p${index}`),
    ];
  });
}

/** The column a `sort` value orders by, accounting for comparison mode. */
function eventAnalyticsCoreColumn(
  column: 'events' | 'users',
  periods: IEventAnalyticsPeriod[] | undefined
): string {
  return comparisonPeriods(periods) ? `${column}_p0` : column;
}

function eventAnalyticsMetricSelects(
  metrics: IEventAnalyticsMetric[] | undefined,
  periods?: IEventAnalyticsPeriod[]
): SelectColumn[] {
  const comparison = comparisonPeriods(periods);

  return (metrics ?? []).flatMap<SelectColumn>((metric, index) => {
    if (!comparison) {
      const expression = eventAnalyticsMetricExpression(metric);
      return expression
        ? [`${expression} AS ${eventAnalyticsMetricAlias(index)}`]
        : [];
    }

    return comparison.flatMap<SelectColumn>((period, periodIndex) => {
      const expression = eventAnalyticsMetricExpression(
        metric,
        eventAnalyticsPeriodCondition(period)
      );
      // clix.exp for the same reason as in eventAnalyticsCoreSelects.
      return expression
        ? [
            clix.exp(
              `${expression} AS ${eventAnalyticsMetricAlias(index, periodIndex)}`
            ),
          ]
        : [];
    });
  });
}

/** Reads the aliased metric columns back, keyed by `metricKey`. */
function toEventAnalyticsMetrics(
  row: Record<string, unknown> | undefined,
  metrics: IEventAnalyticsMetric[] | undefined,
  /** Which period's columns to read; omitted outside comparison mode. */
  period?: number
): Pick<IEventAnalyticsMetricRow, 'metrics'> {
  if (!metrics) {
    return {};
  }
  const values: Record<string, number> = {};
  for (const [index, metric] of metrics.entries()) {
    if (eventAnalyticsMetricExpression(metric)) {
      // A per-user ratio over an empty range divides by zero users.
      values[metricKey(metric)] = toFiniteCount(
        row?.[eventAnalyticsMetricAlias(index, period)] as
          | number
          | string
          | undefined
      );
    }
  }
  return { metrics: values };
}

/**
 * The per-period half of a row: `events`, `users` and the metrics of each
 * requested period, baseline first. Empty outside comparison mode, so the
 * response shape is unchanged for every existing caller.
 */
function toEventAnalyticsPeriods(
  row: Record<string, unknown> | undefined,
  metrics: IEventAnalyticsMetric[] | undefined,
  periods: IEventAnalyticsPeriod[] | undefined
): Pick<IEventAnalyticsMetricRow, 'periods'> {
  const comparison = comparisonPeriods(periods);
  if (!comparison) {
    return {};
  }

  return {
    periods: comparison.map((_period, index) => ({
      events: toFiniteCount(row?.[`events_p${index}`] as number | string),
      users: toFiniteCount(row?.[`users_p${index}`] as number | string),
      ...toEventAnalyticsMetrics(row, metrics, index),
    })),
  };
}

/**
 * One row as the API returns it. In comparison mode the top-level fields repeat
 * period A, so a reader that knows nothing about periods still gets the
 * baseline rather than a number summed across them.
 */
function toEventAnalyticsRow(
  row: Record<string, unknown> | undefined,
  metrics: IEventAnalyticsMetric[] | undefined,
  periods: IEventAnalyticsPeriod[] | undefined
): IEventAnalyticsMetricRow {
  const comparison = comparisonPeriods(periods);
  const baseline = comparison ? '_p0' : '';

  return {
    events: toFiniteCount(row?.[`events${baseline}`] as number | string),
    users: toFiniteCount(row?.[`users${baseline}`] as number | string),
    ...toEventAnalyticsMetrics(row, metrics, comparison ? 0 : undefined),
    ...toEventAnalyticsPeriods(row, metrics, periods),
  };
}

/**
 * The ORDER BY expression for a sort key. The schema already rejects a key that
 * is not one of the request's own metrics, so the `events` fallback is only a
 * guard against emitting `undefined` into the SQL.
 */
function eventAnalyticsSortColumn(
  sort: IEventAnalyticsSortKey,
  metrics: IEventAnalyticsMetric[] | undefined,
  periods?: IEventAnalyticsPeriod[]
): string {
  // Clicking period B's column still sorts by that metric of period A, so the
  // rows keep one order across every period (Phase 3 §3 D7).
  sort = sortKeyWithoutPeriod(sort);

  switch (sort) {
    // `pctu` is users / totals.users and `epau` is events / totals.users. The
    // denominator is the same for every row of one query, so sorting by the
    // numerator gives the identical order without computing the ratio.
    case 'events':
    case 'epau':
      return eventAnalyticsCoreColumn('events', periods);
    case 'users':
    case 'pctu':
      return eventAnalyticsCoreColumn('users', periods);
    case 'epu':
      return `${eventAnalyticsCoreColumn('events', periods)} / ${eventAnalyticsCoreColumn('users', periods)}`;
  }
  const index = (metrics ?? []).findIndex(
    (metric) => metricKey(metric) === sort
  );
  const metric = metrics?.[index];
  if (!(metric && eventAnalyticsMetricExpression(metric))) {
    return eventAnalyticsCoreColumn('events', periods);
  }
  // Always period A's column, for the same reason as above.
  return comparisonPeriods(periods)
    ? eventAnalyticsMetricAlias(index, 0)
    : eventAnalyticsMetricAlias(index);
}

export function buildEventAnalyticsListQuery({
  search,
  sort,
  dir,
  cursor,
  limit,
  ...range
}: IGetEventAnalyticsListInput) {
  const query = buildEventAnalyticsBaseQuery(range)
    .select<IEventAnalyticsListRow>([
      'name',
      ...eventAnalyticsCoreSelects(range.periods),
      ...eventAnalyticsMetricSelects(range.metrics, range.periods),
    ])
    .groupBy(['name'])
    .orderBy(
      eventAnalyticsSortColumn(sort, range.metrics, range.periods),
      dir === 'asc' ? 'ASC' : 'DESC'
    )
    .orderBy('name', 'ASC')
    // One row past the page tells the caller whether a next page exists.
    .limit(limit + 1)
    .offset(cursor ?? 0);

  if (search) {
    query.rawWhere(
      `name ILIKE ${sqlstring.escape(`%${escapeLikeTerm(search)}%`)}`
    );
  }

  return query;
}

export function buildEventAnalyticsTotalsQuery(
  input: IGetEventAnalyticsTotalsInput
) {
  return buildEventAnalyticsBaseQuery(input).select<IEventAnalyticsMetricRow>([
    ...eventAnalyticsCoreSelects(input.periods),
    ...eventAnalyticsMetricSelects(input.metrics, input.periods),
  ]);
}

/**
 * Property keys one level below `prefix` for a single event (T2 of the event
 * analytics tree). See docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md
 */
export type IGetEventPropertyKeysInput = {
  projectId: string;
  filters: IChartEventFilter[];
  startDate: string;
  endDate: string;
  timezone: string;
  event: string;
  /** '' for top level keys, 'payload.' to list the keys inside `payload`. */
  prefix: string;
  parentPath: IEventAnalyticsParentPathItem[];
  cursor?: number;
  limit: number;
  metrics?: IEventAnalyticsMetric[];
};

/** Raw ClickHouse shape of one segment below the prefix. */
type EventPropertyKeySqlRow = {
  key: string;
  events: string | number;
  users: string | number;
  has_nested: string | number;
  non_numeric: string | number;
  [metric: `metric_${number}`]: string | number;
};

function assertEventPropertyDepth(
  parentPath: IEventAnalyticsParentPathItem[]
): void {
  // A key sits one level below its parent value, so each pair costs two levels.
  const depth = parentPath.length * 2 + 1;
  if (
    parentPath.length > EVENT_ANALYTICS_MAX_PARENT_PATH ||
    depth > EVENT_ANALYTICS_MAX_DEPTH
  ) {
    throw new Error(
      `Event analytics tree is limited to ${EVENT_ANALYTICS_MAX_DEPTH} levels below the event, requested level ${depth}`
    );
  }
}

export function buildEventPropertyKeysQuery({
  event,
  prefix,
  parentPath,
  cursor = 0,
  limit,
  metrics,
  ...range
}: IGetEventPropertyKeysInput) {
  assertEventPropertyDepth(parentPath);

  const { timezone } = range;
  const escapedPrefix = sqlstring.escape(prefix);

  // Same filtered slice as the list and the totals, narrowed to one event.
  const baseEvents = buildEventAnalyticsBaseQuery(range)
    .select(['profile_id', 'properties'])
    .where('name', '=', event);

  for (const { key, value } of parentPath) {
    baseEvents.rawWhere(
      `properties[${sqlstring.escape(key)}] = ${sqlstring.escape(value)}`
    );
  }

  const matchedKeys = clix(ch, timezone)
    .select([
      'profile_id',
      'properties',
      `arrayFilter(k -> startsWith(k, ${escapedPrefix}), mapKeys(properties)) AS matched`,
    ])
    .from('base_events');

  // One row per (event, distinct segment): an event carrying several keys under
  // the same object still counts once for that object.
  const segments = clix(ch, timezone)
    .select([
      'profile_id',
      'properties',
      'matched',
      `arrayJoin(arrayDistinct(arrayMap(k -> splitByChar('.', substring(k, length(${escapedPrefix}) + 1))[1], matched))) AS segment`,
    ])
    .from('matched_keys')
    .rawWhere('notEmpty(matched)');

  return clix(ch, timezone)
    .with('base_events', baseEvents)
    .with('matched_keys', matchedKeys)
    .with('segments', segments)
    .select<EventPropertyKeySqlRow>([
      'segment AS key',
      'count() AS events',
      'uniqExact(profile_id) AS users',
      `max(arrayExists(k -> startsWith(k, concat(${escapedPrefix}, segment, '.')), matched)) AS has_nested`,
      // Spec section 3: only non-empty values decide the type. An empty value
      // carries no type information, so it must not push the key to `str`.
      // A key whose values are all empty therefore lands on `num` -- deliberate:
      // there is nothing to parse and nothing to sort, so the rule stays simple.
      `countIf(properties[concat(${escapedPrefix}, segment)] != '' AND toFloat64OrNull(properties[concat(${escapedPrefix}, segment)]) IS NULL) AS non_numeric`,
      ...eventAnalyticsMetricSelects(metrics),
    ])
    .from('segments')
    .groupBy(['segment'])
    .orderBy('events', 'DESC')
    .orderBy('key', 'ASC')
    .limit(limit + 1)
    .offset(cursor);
}

/** Maps the raw rows onto the shared contract, applying PA1 type inference. */
export function toEventPropertyKeyRows(
  sqlRows: EventPropertyKeySqlRow[],
  {
    cursor = 0,
    limit,
    metrics,
    periods,
  }: {
    cursor?: number;
    limit: number;
    metrics?: IEventAnalyticsMetric[];
    periods?: IEventAnalyticsPeriod[];
  }
): IEventPropertyKeysOutput {
  const hasMore = sqlRows.length > limit;
  const rows: IEventPropertyKeyRow[] = sqlRows
    .slice(0, limit)
    .map((row): IEventPropertyKeyRow => {
      const isObject = Number(row.has_nested) > 0;
      return {
        key: row.key,
        kind: isObject ? 'obj' : 'key',
        // PA1: a leaf key is numeric only when every value parsed as a number.
        type: isObject ? 'unknown' : Number(row.non_numeric) === 0 ? 'num' : 'str',
        ...toEventAnalyticsRow(row, metrics, periods),
      };
    });

  return { rows, nextCursor: hasMore ? cursor + limit : null };
}

// --- Event analytics tree: property values (T3) ---------------------------
// Distinct values of one property key under one event, with the events/users
// metrics, paging and the `remaining` counter the tree's "Load more" needs.
// See docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md §4.

export const zGetEventPropertyValuesInput = z.object({
  projectId: z.string(),
  filters: z.array(z.any()),
  startDate: z.string(),
  endDate: z.string(),
  event: z.string(),
  key: z.string(),
  type: zEventAnalyticsPropertyType,
  parentPath: z
    .array(zEventAnalyticsParentPathItem)
    .max(EVENT_ANALYTICS_MAX_PARENT_PATH),
  sort: zEventAnalyticsSortKey,
  dir: zEventAnalyticsSortDir,
  cursor: z.number().int().min(0).optional(),
  limit: z.number().int().min(1),
});

export type IGetEventPropertyValuesInput = z.infer<
  typeof zGetEventPropertyValuesInput
> & {
  timezone: string;
  metrics?: IEventAnalyticsMetric[];
  periods?: IEventAnalyticsPeriod[];
};

/** ClickHouse returns the aggregates as strings. */
type EventPropertyValueQueryRow = {
  value: string;
  events: string | number;
  users: string | number;
  total_distinct: string | number;
  [metric: `metric_${number}`]: string | number;
};

export function buildEventPropertyValuesQuery({
  event,
  key,
  type,
  parentPath,
  sort,
  dir,
  cursor,
  limit,
  ...range
}: IGetEventPropertyValuesInput) {
  const valueExpression = `properties[${sqlstring.escape(key)}]`;
  const baseValues = buildEventAnalyticsBaseQuery(range)
    .select(['properties', 'profile_id'])
    .where('name', '=', event)
    .rawWhere(`mapContains(properties, ${sqlstring.escape(key)})`);

  for (const step of parentPath) {
    baseValues.rawWhere(
      `properties[${sqlstring.escape(step.key)}] = ${sqlstring.escape(step.value)}`
    );
  }

  const valueTotals = clix(ch, range.timezone)
    // uniqExact, not uniq: an approximate total would let `remaining` drift
    // away from the page the cursor actually returns.
    .select([`uniqExact(${valueExpression}) AS total_distinct`])
    .from('base_values');

  // `num` keys are stored as strings, so without the cast 10 sorts before 2.
  // The contract has no `value` sort key, so this stays the tie-breaker.
  const tieBreaker = type === 'num' ? 'toFloat64OrNull(value)' : 'value';

  return clix(ch, range.timezone)
    .with('base_values', baseValues)
    .with('value_totals', valueTotals)
    .select([
      `${valueExpression} AS value`,
      ...eventAnalyticsCoreSelects(range.periods),
      'total_distinct',
      ...eventAnalyticsMetricSelects(range.metrics, range.periods),
    ])
    .from('base_values')
    .crossJoin('value_totals')
    .groupBy(['value', 'total_distinct'])
    .orderBy(
      eventAnalyticsSortColumn(sort, range.metrics, range.periods),
      dir === 'asc' ? 'ASC' : 'DESC'
    )
    .orderBy(tieBreaker, 'ASC')
    // One row past the page tells us whether another page exists.
    .limit(limit + 1)
    .offset(cursor ?? 0);
}

export const zGetTopLinkOutInput = z.object({
  projectId: z.string(),
  filters: z.array(z.any()),
  startDate: z.string(),
  endDate: z.string(),
});

export type IGetTopLinkOutInput = z.infer<typeof zGetTopLinkOutInput> & {
  timezone: string;
};

export const zGetMapDataInput = z.object({
  projectId: z.string(),
  filters: z.array(z.any()),
  startDate: z.string(),
  endDate: z.string(),
});

export type IGetMapDataInput = z.infer<typeof zGetMapDataInput> & {
  timezone: string;
};

export class OverviewService {
  constructor(private client: typeof ch) {}

  private getFillConfig(interval: string, startDate: string, endDate: string) {
    const useDateOnly = ['month', 'week'].includes(interval);
    return {
      from: clix.toStartOf(
        clix.datetime(startDate, useDateOnly ? 'toDate' : 'toDateTime'),
        interval as any
      ),
      to: clix.datetime(endDate, useDateOnly ? 'toDate' : 'toDateTime'),
      step: clix.toInterval('1', interval as any),
    };
  }

  private createRevenueQuery({
    projectId,
    startDate,
    endDate,
    interval,
    timezone,
    filters,
  }: {
    projectId: string;
    startDate: string;
    endDate: string;
    interval: string;
    timezone: string;
    filters: IChartEventFilter[];
  }) {
    return clix(this.client, timezone)
      .select<{ date: string; total_revenue: number }>([
        `${clix.toStartOf('created_at', interval as any, timezone)} AS date`,
        'sum(revenue) AS total_revenue',
      ])
      .from(TABLE_NAMES.events)
      .where('project_id', '=', projectId)
      .where('name', '=', 'revenue')
      .where('revenue', '>', 0)
      .where('created_at', 'BETWEEN', [
        clix.datetime(startDate, 'toDateTime'),
        clix.datetime(endDate, 'toDateTime'),
      ])
      .rawWhere(this.getRawWhereClause('events', filters))
      .groupBy(['date'])
      .rollup()
      .transform({
        date: (item) => convertClickhouseDateToJs(item.date).toISOString(),
      });
  }

  private mergeRevenueIntoSeries<T extends { date: string }>(
    series: T[],
    revenueData: { date: string; total_revenue: number }[]
  ): (T & { total_revenue: number })[] {
    const revenueByDate = new Map(
      revenueData
        .filter((r) => !isClickhouseDefaultMinDate(r.date))
        .map((r) => [r.date, r.total_revenue])
    );
    return series.map((row) => ({
      ...row,
      total_revenue: revenueByDate.get(row.date) ?? 0,
    }));
  }

  private getOverallRevenue(
    revenueData: { date: string; total_revenue: number }[]
  ): number {
    return (
      revenueData.find((r) => isClickhouseDefaultMinDate(r.date))
        ?.total_revenue ?? 0
    );
  }

  private withDistinctSessionsIfNeeded<T>(
    query: ReturnType<typeof clix>,
    params: {
      filters: IChartEventFilter[];
      projectId: string;
      startDate: string;
      endDate: string;
      timezone: string;
    }
  ): ReturnType<typeof clix> {
    if (!this.isPageFilter(params.filters)) {
      query.rawWhere(this.getRawWhereClause('sessions', params.filters));
      return query;
    }

    return clix(this.client, params.timezone)
      .with('distinct_sessions', this.getDistinctSessions(params))
      .merge(query)
      .where(
        'id',
        'IN',
        clix.exp('(SELECT session_id FROM distinct_sessions)')
      );
  }

  isPageFilter(filters: IChartEventFilter[]) {
    return filters.some((filter) => filter.name === 'path' && filter.value);
  }

  async getMetrics({
    projectId,
    filters,
    startDate,
    endDate,
    interval,
    timezone,
  }: IGetMetricsInput): Promise<{
    metrics: {
      bounce_rate: number;
      unique_visitors: number;
      total_sessions: number;
      avg_session_duration: number;
      total_screen_views: number;
      views_per_session: number;
      total_revenue: number;
    };
    series: {
      date: string;
      bounce_rate: number;
      unique_visitors: number;
      total_sessions: number;
      avg_session_duration: number;
      total_screen_views: number;
      views_per_session: number;
      total_revenue: number;
    }[];
  }> {
    return this.isPageFilter(filters)
      ? this.getMetricsWithPageFilter({
          projectId,
          filters,
          startDate,
          endDate,
          interval,
          timezone,
        })
      : this.getMetricsFromSessions({
          projectId,
          filters,
          startDate,
          endDate,
          interval,
          timezone,
        });
  }

  private async getMetricsFromSessions({
    projectId,
    filters,
    startDate,
    endDate,
    interval,
    timezone,
  }: IGetMetricsInput): Promise<{
    metrics: MetricsRow & { total_revenue: number };
    series: MetricsSeriesRow[];
  }> {
    const where = this.getRawWhereClause('sessions', filters);
    const fillConfig = this.getFillConfig(interval, startDate, endDate);

    // Session metrics query
    const sessionQuery = clix(this.client, timezone)
      .select<{
        date: string;
        bounce_rate: number;
        unique_visitors: number;
        total_sessions: number;
        avg_session_duration: number;
        total_screen_views: number;
        views_per_session: number;
      }>([
        `${clix.toStartOf('created_at', interval as any, timezone)} AS date`,
        'round(sum(sign * is_bounce) * 100.0 / sum(sign), 2) as bounce_rate',
        'uniqIf(profile_id, sign > 0) AS unique_visitors',
        'sum(sign) AS total_sessions',
        'round(avgIf(duration, duration > 0 AND sign > 0), 2) / 1000 AS _avg_session_duration',
        'if(isNaN(_avg_session_duration), 0, _avg_session_duration) AS avg_session_duration',
        'sum(sign * screen_view_count) AS total_screen_views',
        'round(sum(sign * screen_view_count) * 1.0 / sum(sign), 2) AS views_per_session',
      ])
      .from('sessions')
      .where('created_at', 'BETWEEN', [
        clix.datetime(startDate, 'toDateTime'),
        clix.datetime(endDate, 'toDateTime'),
      ])
      .where('project_id', '=', projectId)
      .rawWhere(where)
      .groupBy(['date'])
      .having('sum(sign)', '>', 0)
      .rollup()
      .orderBy('date', 'ASC')
      .fill(fillConfig.from, fillConfig.to, fillConfig.step)
      .transform({
        date: (item) => new Date(item.date).toISOString(),
      });

    // Revenue query
    const revenueQuery = this.createRevenueQuery({
      projectId,
      startDate,
      endDate,
      interval,
      timezone,
      filters,
    });

    // Execute both queries in parallel and merge results
    const [sessionRes, revenueRes] = await Promise.all([
      sessionQuery.execute(),
      revenueQuery.execute(),
    ]);

    const overallRevenue = this.getOverallRevenue(revenueRes);
    const series = this.mergeRevenueIntoSeries(sessionRes.slice(1), revenueRes);

    return {
      metrics: {
        bounce_rate: sessionRes[0]?.bounce_rate ?? 0,
        unique_visitors: sessionRes[0]?.unique_visitors ?? 0,
        total_sessions: sessionRes[0]?.total_sessions ?? 0,
        avg_session_duration: sessionRes[0]?.avg_session_duration ?? 0,
        total_screen_views: sessionRes[0]?.total_screen_views ?? 0,
        views_per_session: sessionRes[0]?.views_per_session ?? 0,
        total_revenue: overallRevenue,
      },
      series,
    };
  }

  private async getMetricsWithPageFilter({
    projectId,
    filters,
    startDate,
    endDate,
    interval,
    timezone,
  }: IGetMetricsInput): Promise<{
    metrics: MetricsRow & { total_revenue: number };
    series: MetricsSeriesRow[];
  }> {
    const where = this.getRawWhereClause('sessions', filters);
    const fillConfig = this.getFillConfig(interval, startDate, endDate);

    // CTE: per-event screen_view durations via window function
    const rawScreenViewDurationsQuery = clix(this.client, timezone)
      .select([
        `${clix.toStartOf('created_at', interval as any, timezone)} AS date`,
        `dateDiff('millisecond', created_at, lead(created_at, 1, created_at) OVER (PARTITION BY session_id ORDER BY created_at)) AS duration`,
      ])
      .from(TABLE_NAMES.events)
      .where('project_id', '=', projectId)
      .where('name', '=', 'screen_view')
      .where('created_at', 'BETWEEN', [
        clix.datetime(startDate, 'toDateTime'),
        clix.datetime(endDate, 'toDateTime'),
      ])
      .rawWhere(this.getRawWhereClause('events', filters));

    // CTE: avg duration per date bucket
    const avgDurationByDateQuery = clix(this.client, timezone)
      .select([
        'date',
        'round(avgIf(duration, duration > 0), 2) / 1000 AS avg_session_duration',
      ])
      .from('raw_screen_view_durations')
      .groupBy(['date']);

    // Session aggregation with bounce rates
    const sessionAggQuery = clix(this.client, timezone)
      .select([
        `${clix.toStartOf('created_at', interval as any, timezone)} AS date`,
        'round((countIf(is_bounce = 1 AND sign = 1) * 100.) / countIf(sign = 1), 2) AS bounce_rate',
      ])
      .from(TABLE_NAMES.sessions, true)
      .where('sign', '=', 1)
      .where('project_id', '=', projectId)
      .where('created_at', 'BETWEEN', [
        clix.datetime(startDate, 'toDateTime'),
        clix.datetime(endDate, 'toDateTime'),
      ])
      .rawWhere(where)
      .groupBy(['date'])
      .rollup()
      .orderBy('date', 'ASC');

    // Overall unique visitors
    const overallUniqueVisitorsQuery = clix(this.client, timezone)
      .select([
        'uniq(profile_id) AS unique_visitors',
        'uniq(session_id) AS total_sessions',
      ])
      .from(TABLE_NAMES.events)
      .where('project_id', '=', projectId)
      .where('name', '=', 'screen_view')
      .where('created_at', 'BETWEEN', [
        clix.datetime(startDate, 'toDateTime'),
        clix.datetime(endDate, 'toDateTime'),
      ])
      .rawWhere(this.getRawWhereClause('events', filters));

    // Use toDate for month/week intervals, toDateTime for others
    const rollupDate =
      interval === 'month' || interval === 'week'
        ? clix.date(ROLLUP_DATE_PREFIX)
        : clix.datetime(`${ROLLUP_DATE_PREFIX} 00:00:00`);

    // Main metrics query (without revenue)
    const mainQuery = clix(this.client, timezone)
      .with('session_agg', sessionAggQuery)
      .with(
        'overall_bounce_rate',
        clix(this.client, timezone)
          .select(['bounce_rate'])
          .from('session_agg')
          .where('date', '=', rollupDate)
      )
      .with(
        'daily_session_stats',
        clix(this.client, timezone)
          .select(['date', 'bounce_rate'])
          .from('session_agg')
          .where('date', '!=', rollupDate)
      )
      .with('overall_unique_visitors', overallUniqueVisitorsQuery)
      .with('raw_screen_view_durations', rawScreenViewDurationsQuery)
      .with('avg_duration_by_date', avgDurationByDateQuery)
      .select<{
        date: string;
        bounce_rate: number;
        unique_visitors: number;
        total_sessions: number;
        avg_session_duration: number;
        total_screen_views: number;
        views_per_session: number;
        overall_unique_visitors: number;
        overall_total_sessions: number;
        overall_bounce_rate: number;
      }>([
        `${clix.toStartOf('e.created_at', interval as any)} AS date`,
        'dss.bounce_rate as bounce_rate',
        'uniq(e.profile_id) AS unique_visitors',
        'uniq(e.session_id) AS total_sessions',
        'coalesce(dur.avg_session_duration, 0) AS avg_session_duration',
        'count(*) AS total_screen_views',
        'round((count(*) * 1.) / uniq(e.session_id), 2) AS views_per_session',
        '(SELECT unique_visitors FROM overall_unique_visitors) AS overall_unique_visitors',
        '(SELECT total_sessions FROM overall_unique_visitors) AS overall_total_sessions',
        '(SELECT bounce_rate FROM overall_bounce_rate) AS overall_bounce_rate',
      ])
      .from(`${TABLE_NAMES.events} AS e`)
      .leftJoin(
        'daily_session_stats AS dss',
        `${clix.toStartOf('e.created_at', interval as any)} = dss.date`
      )
      .leftJoin(
        'avg_duration_by_date AS dur',
        `${clix.toStartOf('e.created_at', interval as any)} = dur.date`
      )
      .where('e.project_id', '=', projectId)
      .where('e.name', '=', 'screen_view')
      .where('e.created_at', 'BETWEEN', [
        clix.datetime(startDate, 'toDateTime'),
        clix.datetime(endDate, 'toDateTime'),
      ])
      .rawWhere(this.getRawWhereClause('events', filters))
      .groupBy(['date', 'dss.bounce_rate', 'dur.avg_session_duration'])
      .orderBy('date', 'ASC')
      .fill(fillConfig.from, fillConfig.to, fillConfig.step)
      .transform({
        date: (item) => new Date(item.date).toISOString(),
      });

    // Revenue query
    const revenueQuery = this.createRevenueQuery({
      projectId,
      startDate,
      endDate,
      interval,
      timezone,
      filters,
    });

    // Execute both queries in parallel and merge results
    const [mainRes, revenueRes] = await Promise.all([
      mainQuery.execute(),
      revenueQuery.execute(),
    ]);

    const overallRevenue = this.getOverallRevenue(revenueRes);
    const series = this.mergeRevenueIntoSeries(mainRes, revenueRes);

    const anyRowWithData = mainRes.find(
      (item) =>
        item.overall_bounce_rate !== null ||
        item.overall_total_sessions !== null ||
        item.overall_unique_visitors !== null
    );

    return {
      metrics: {
        bounce_rate: anyRowWithData?.overall_bounce_rate ?? 0,
        unique_visitors: anyRowWithData?.overall_unique_visitors ?? 0,
        total_sessions: anyRowWithData?.overall_total_sessions ?? 0,
        avg_session_duration: average(
          mainRes.map((item) => item.avg_session_duration)
        ),
        total_screen_views: sum(mainRes.map((item) => item.total_screen_views)),
        views_per_session: average(
          mainRes.map((item) => item.views_per_session)
        ),
        total_revenue: overallRevenue,
      },
      series,
    };
  }

  /**
   * Event analytics filters the raw events table, so it must not go through
   * `getRawWhereClause`: that whitelist accepts 21 fixed columns only and
   * silently discards `properties.*` filters, leaving the table showing
   * unfiltered numbers with no error. Here every filter reaches
   * `getEventFiltersWhereClause`, which already drops names it cannot resolve
   * on the events table.
   *
   * `profile.properties.*` and the profiles table's own columns compile to
   * `profile.properties['key']` / `profile.email`, which only resolve where a
   * `profile` relation exists. Event analytics only ever filters by them, so
   * instead of the chart's profile CTE the condition is wrapped in a
   * self-contained subselect that aliases the profiles table as `profile`
   * (Phase 2 spec §3 D1). The per-filter SQL is
   * therefore byte-for-byte what the chart emits — presence stays
   * `properties['k'] != ''`, never mapContains — and the clause composes
   * inside an OR group like any other condition.
   */
  getEventAnalyticsWhereClause(
    filters: IChartEventFilter[],
    projectId?: string,
    /**
     * Advanced filters (AND/OR groups). When absent the flat array is wrapped
     * into an implicit AND root, so the emitted SQL is the same conditions
     * joined by AND as before.
     */
    filterGroup?: IFilterGroup
  ) {
    const compile = (item: IChartEventFilter) =>
      compileEventAnalyticsFilter(item, projectId);

    if (!filterGroup) {
      // Keep the flat path byte-identical: the group walker parenthesises, the
      // flat loop does not, and existing SQL assertions pin the flat form.
      const where: string[] = [];
      for (const item of filters) {
        const clause = compile(item);
        if (clause !== null) {
          where.push(clause);
        }
      }
      return where.join(' AND ');
    }

    return compileFilterGroup(filterGroup, compile) ?? '';
  }

  getRawWhereClause(type: 'events' | 'sessions', filters: IChartEventFilter[]) {
    const where = getEventFiltersWhereClause(
      filters.flatMap((item) => {
        if (!WHITELISTED_FILTERS.includes(item.name)) {
          return []
        }
        if (type === 'sessions') {
          if (item.name === 'path') {
            return [{ ...item, name: 'entry_path' }];
          }
          if (item.name === 'origin') {
            return [{ ...item, name: 'entry_origin' }];
          }
          if (item.name.startsWith('properties.__query.utm_')) {
            return [
              {
                ...item,
                name: item.name.replace('properties.__query.utm_', 'utm_'),
              },
            ];
          }
          // sessions table has no `properties` map for arbitrary keys —
          // drop them instead of generating an invalid WHERE clause.
          if (item.name.startsWith('properties.')) {
            return [];
          }
          return [item];
        }
        // events table has no top-level utm_* columns — those live in the
        // properties map under the __query.utm_* keys. Route them through
        // getEventFiltersWhereClause's properties.* path so we emit
        // `properties['__query.utm_source']` instead of the bare column.
        if (UTM_COLUMNS.includes(item.name)) {
          return [{ ...item, name: `properties.__query.${item.name}` }];
        }
        return [item];
      }),
      undefined,
      undefined,
      type,
    );

    return Object.values(where).join(' AND ');
  }

  async getTopPages({
    projectId,
    filters,
    startDate,
    endDate,
    timezone,
    limit,
  }: IGetTopPagesInput) {
    const selectColumns: (string | null | undefined | false)[] = [
      'origin',
      'path',
      'uniq(session_id) as sessions',
      'count() as pageviews',
    ];

    if (INCLUDE_REVENUE) {
      selectColumns.push('sum(revenue) as revenue');
    }

    const query = clix(this.client, timezone)
      .select<{
        origin: string;
        path: string;
        sessions: number;
        pageviews: number;
        revenue?: number;
      }>(selectColumns)
      .from(TABLE_NAMES.events, false)
      .where('project_id', '=', projectId)
      .where('name', '=', 'screen_view')
      .where('path', '!=', '')
      .where('created_at', 'BETWEEN', [
        clix.datetime(startDate, 'toDateTime'),
        clix.datetime(endDate, 'toDateTime'),
      ])
      .rawWhere(this.getRawWhereClause('events', filters))
      .groupBy(['origin', 'path'])
      .orderBy('sessions', 'DESC')
      .limit(Math.min(limit ?? MAX_RECORDS_LIMIT, MAX_RECORDS_LIMIT));

    return query.execute();
  }

  async getTopEntryExit({
    projectId,
    filters,
    startDate,
    endDate,
    mode,
    timezone,
    limit,
  }: IGetTopEntryExitInput) {
    const selectColumns: (string | null | undefined | false)[] = [
      `${mode}_origin AS origin`,
      `${mode}_path AS path`,
      'sum(sign) as sessions',
      'sum(sign * screen_view_count) as pageviews',
    ];

    if (INCLUDE_REVENUE) {
      selectColumns.push('sum(revenue * sign) as revenue');
    }

    const query = clix(this.client, timezone)
      .select<{
        origin: string;
        path: string;
        sessions: number;
        pageviews: number;
        revenue?: number;
      }>(selectColumns)
      .from(TABLE_NAMES.sessions, true)
      .where('project_id', '=', projectId)
      .where('created_at', 'BETWEEN', [
        clix.datetime(startDate, 'toDateTime'),
        clix.datetime(endDate, 'toDateTime'),
      ])
      .groupBy([`${mode}_origin`, `${mode}_path`])
      .having('sum(sign)', '>', 0)
      .orderBy('sessions', 'DESC')
      .limit(Math.min(limit ?? MAX_RECORDS_LIMIT, MAX_RECORDS_LIMIT));

    const mainQuery = this.withDistinctSessionsIfNeeded(query, {
      projectId,
      filters,
      startDate,
      endDate,
      timezone,
    });

    return mainQuery.execute();
  }

  private getDistinctSessions({
    projectId,
    filters,
    startDate,
    endDate,
    timezone,
  }: {
    projectId: string;
    filters: IChartEventFilter[];
    startDate: string;
    endDate: string;
    timezone: string;
  }) {
    return clix(this.client, timezone)
      .select(['DISTINCT session_id'])
      .from(TABLE_NAMES.events)
      .where('project_id', '=', projectId)
      .where('created_at', 'BETWEEN', [
        clix.datetime(startDate, 'toDateTime'),
        clix.datetime(endDate, 'toDateTime'),
      ])
      .rawWhere(this.getRawWhereClause('events', filters));
  }

  async getTopGeneric({
    projectId,
    filters,
    startDate,
    endDate,
    column,
    timezone,
  }: IGetTopGenericInput) {
    if (!WHITELISTED_FILTERS.includes(column)) {
      return [];
    }
    
    const prefixColumn = COLUMN_PREFIX_MAP[column] ?? null;

    const selectColumns: (string | null | undefined | false)[] = [
      prefixColumn && `${prefixColumn} as prefix`,
      `nullIf(${column}, '') as name`,
      'sum(sign) as sessions',
      'sum(sign * screen_view_count) as pageviews',
    ];

    if (INCLUDE_REVENUE) {
      selectColumns.push('sum(revenue * sign) as revenue');
    }

    const query = clix(this.client, timezone)
      .select<{
        prefix?: string;
        name: string;
        sessions: number;
        pageviews: number;
        revenue?: number;
      }>(selectColumns)
      .from(TABLE_NAMES.sessions, true)
      .where('project_id', '=', projectId)
      .where('created_at', 'BETWEEN', [
        clix.datetime(startDate, 'toDateTime'),
        clix.datetime(endDate, 'toDateTime'),
      ])
      .groupBy([prefixColumn, column].filter(Boolean))
      .having('sum(sign)', '>', 0)
      .orderBy('sessions', 'DESC')
      .limit(MAX_RECORDS_LIMIT);

    const mainQuery = this.withDistinctSessionsIfNeeded(query, {
      projectId,
      filters,
      startDate,
      endDate,
      timezone,
    });

    return mainQuery.execute();
  }

  async getTopGenericSeries({
    projectId,
    filters,
    startDate,
    endDate,
    column,
    interval,
    timezone,
  }: IGetTopGenericSeriesInput): Promise<{
    items: Array<{
      name: string;
      prefix?: string;
      data: Array<{
        date: string;
        sessions: number;
        pageviews: number;
        revenue?: number;
      }>;
      total: { sessions: number; pageviews: number; revenue?: number };
    }>;
  }> {
    const prefixColumn = COLUMN_PREFIX_MAP[column] ?? null;
    const TOP_LIMIT = 500;
    const fillConfig = this.getFillConfig(interval, startDate, endDate);

    // Step 1: Get top 15 items
    const selectColumns: (string | null | undefined | false)[] = [
      prefixColumn && `${prefixColumn} as prefix`,
      `nullIf(${column}, '') as name`,
      'sum(sign) as sessions',
      'sum(sign * screen_view_count) as pageviews',
    ];

    if (INCLUDE_REVENUE) {
      selectColumns.push('sum(revenue * sign) as revenue');
    }

    const topItemsQuery = clix(this.client, timezone)
      .select<{
        prefix?: string;
        name: string;
        sessions: number;
        pageviews: number;
        revenue?: number;
      }>(selectColumns)
      .from(TABLE_NAMES.sessions, true)
      .where('project_id', '=', projectId)
      .where('created_at', 'BETWEEN', [
        clix.datetime(startDate, 'toDateTime'),
        clix.datetime(endDate, 'toDateTime'),
      ])
      .groupBy([prefixColumn, column].filter(Boolean))
      .having('sum(sign)', '>', 0)
      .orderBy('sessions', 'DESC')
      .limit(TOP_LIMIT);

    const mainTopItemsQuery = this.withDistinctSessionsIfNeeded(topItemsQuery, {
      projectId,
      filters,
      startDate,
      endDate,
      timezone,
    });

    const topItems = await mainTopItemsQuery.execute();

    if (topItems.length === 0) {
      return { items: [] };
    }

    // Step 2: Build time-series query for each top item
    const where = this.getRawWhereClause('sessions', filters);
    const timeSeriesSelectColumns: (string | null | undefined | false)[] = [
      `${clix.toStartOf('created_at', interval as any, timezone)} AS date`,
      prefixColumn && `${prefixColumn} as prefix`,
      `nullIf(${column}, '') as name`,
      'sum(sign) as sessions',
      'sum(sign * screen_view_count) as pageviews',
    ];

    if (INCLUDE_REVENUE) {
      timeSeriesSelectColumns.push('sum(revenue * sign) as revenue');
    }

    const timeSeriesQuery = clix(this.client, timezone)
      .select<{
        date: string;
        prefix?: string;
        name: string;
        sessions: number;
        pageviews: number;
        revenue?: number;
      }>(timeSeriesSelectColumns)
      .from(TABLE_NAMES.sessions, true)
      .where('project_id', '=', projectId)
      .where('created_at', 'BETWEEN', [
        clix.datetime(startDate, 'toDateTime'),
        clix.datetime(endDate, 'toDateTime'),
      ])
      .rawWhere(where)
      .groupBy(['date', prefixColumn, column].filter(Boolean))
      .having('sum(sign)', '>', 0)
      .orderBy('date', 'ASC')
      .fill(fillConfig.from, fillConfig.to, fillConfig.step)
      .transform({
        date: (item) => new Date(item.date).toISOString(),
      });

    const mainTimeSeriesQuery = this.withDistinctSessionsIfNeeded(
      timeSeriesQuery,
      {
        projectId,
        filters,
        startDate,
        endDate,
        timezone,
      }
    );

    const timeSeriesData = await mainTimeSeriesQuery.execute();

    // Step 3: Group time-series data by item and calculate totals
    const itemsMap = new Map<
      string,
      {
        name: string;
        prefix?: string;
        data: Array<{
          date: string;
          sessions: number;
          pageviews: number;
          revenue?: number;
        }>;
        total: { sessions: number; pageviews: number; revenue?: number };
      }
    >();

    // Initialize items from topItems
    for (const item of topItems) {
      const key = `${item.prefix || ''}:${item.name}`;
      itemsMap.set(key, {
        name: item.name,
        prefix: item.prefix,
        data: [],
        total: {
          sessions: item.sessions,
          pageviews: item.pageviews,
          revenue: item.revenue ?? 0,
        },
      });
    }

    // Populate time-series data
    for (const row of timeSeriesData) {
      const key = `${row.prefix || ''}:${row.name}`;
      const item = itemsMap.get(key);
      if (item) {
        item.data.push({
          date: row.date,
          sessions: row.sessions,
          pageviews: row.pageviews,
          revenue: row.revenue,
        });
      }
    }

    return {
      items: Array.from(itemsMap.values()),
    };
  }

  async getUserJourney({
    projectId,
    filters,
    startDate,
    endDate,
    steps = 5,
    timezone,
  }: IGetUserJourneyInput): Promise<{
    nodes: Array<{
      id: string;
      label: string;
      nodeColor: string;
      percentage?: number;
      value?: number;
      step?: number;
    }>;
    links: Array<{ source: string; target: string; value: number }>;
  }> {
    // Config
    const TOP_ENTRIES = 3; // Only show top 3 entry pages
    const TOP_DESTINATIONS_PER_NODE = 3; // Top 3 destinations from each node

    // Color palette - each entry page gets a consistent color
    const COLORS = chartColors.map((color) => color.main);

    // Step 1: Get session paths (deduped consecutive pages)
    const orderedEventsQuery = clix(this.client, timezone)
      .select<{
        session_id: string;
        path: string;
        created_at: string;
      }>(['session_id', 'concat(origin, path) as path', 'created_at'])
      .from(TABLE_NAMES.events)
      .where('project_id', '=', projectId)
      .where('name', '=', 'screen_view')
      .where('path', '!=', '')
      .where('path', 'IS NOT NULL')
      .where('created_at', 'BETWEEN', [
        clix.datetime(startDate, 'toDateTime'),
        clix.datetime(endDate, 'toDateTime'),
      ])
      .rawWhere(this.getRawWhereClause('events', filters))
      .orderBy('session_id', 'ASC')
      .orderBy('created_at', 'ASC');

    // Intermediate CTE to compute deduped paths
    const pathsDedupedCTE = clix(this.client, timezone)
      .with('ordered_events', orderedEventsQuery)
      .select<{
        session_id: string;
        paths_deduped: string[];
      }>([
        'session_id',
        `arraySlice(
          arrayFilter(
            (x, i) -> i = 1 OR x != paths_raw[i - 1],
            groupArray(path) as paths_raw,
            arrayEnumerate(paths_raw)
          ),
          1, ${steps}
        ) as paths_deduped`,
      ])
      .from('ordered_events')
      .groupBy(['session_id']);

    const sessionPathsQuery = clix(this.client, timezone)
      .with('paths_deduped_cte', pathsDedupedCTE)
      .select<{
        session_id: string;
        entry_page: string;
        paths: string[];
      }>([
        'session_id',
        // Truncate at first repeat
        `if(
          arrayFirstIndex(x -> x > 1, arrayEnumerateUniq(paths_deduped)) = 0,
          paths_deduped,
          arraySlice(
            paths_deduped,
            1,
            arrayFirstIndex(x -> x > 1, arrayEnumerateUniq(paths_deduped)) - 1
          )
        ) as paths`,
        // Entry page is first element
        'paths[1] as entry_page',
      ])
      .from('paths_deduped_cte')
      .having('length(paths)', '>=', 2);

    // Step 2: Find top 3 entry pages
    const topEntriesQuery = clix(this.client, timezone)
      .with('session_paths', sessionPathsQuery)
      .select<{ entry_page: string; count: number }>([
        'entry_page',
        'count() as count',
      ])
      .from('session_paths')
      .groupBy(['entry_page'])
      .orderBy('count', 'DESC')
      .limit(TOP_ENTRIES);

    const topEntries = await topEntriesQuery.execute();

    if (topEntries.length === 0) {
      return { nodes: [], links: [] };
    }

    const topEntryPages = topEntries.map((e) => e.entry_page);
    const totalSessions = topEntries.reduce((sum, e) => sum + e.count, 0);

    // Step 3: Get all transitions, but ONLY for sessions starting with top entries
    const transitionsQuery = clix(this.client, timezone)
      .with('paths_deduped_cte', pathsDedupedCTE)
      .with(
        'session_paths',
        clix(this.client, timezone)
          .select([
            'session_id',
            // Truncate at first repeat
            `if(
              arrayFirstIndex(x -> x > 1, arrayEnumerateUniq(paths_deduped)) = 0,
              paths_deduped,
              arraySlice(
                paths_deduped,
                1,
                arrayFirstIndex(x -> x > 1, arrayEnumerateUniq(paths_deduped)) - 1
              )
            ) as paths`,
          ])
          .from('paths_deduped_cte')
          .having('length(paths)', '>=', 2)
          // ONLY sessions starting with top entry pages
          .having('paths[1]', 'IN', topEntryPages)
      )
      .select<{
        source: string;
        target: string;
        step: number;
        value: number;
      }>([
        'pair.1 as source',
        'pair.2 as target',
        'pair.3 as step',
        'count() as value',
      ])
      .from(
        clix.exp(
          '(SELECT arrayJoin(arrayMap(i -> (paths[i], paths[i + 1], i), range(1, length(paths)))) as pair FROM session_paths WHERE length(paths) >= 2)'
        )
      )
      .groupBy(['source', 'target', 'step'])
      .orderBy('step', 'ASC')
      .orderBy('value', 'DESC');

    const transitions = await transitionsQuery.execute();

    if (transitions.length === 0) {
      return { nodes: [], links: [] };
    }

    // Step 4: Build the sankey progressively step by step
    // Start with entry nodes, then follow top destinations at each step
    // Use unique node IDs by combining path with step to prevent circular references
    const nodes = new Map<
      string,
      { path: string; value: number; step: number; color: string }
    >();
    const links: Array<{ source: string; target: string; value: number }> = [];

    // Helper to create unique node ID
    const getNodeId = (path: string, step: number) => `${path}::step${step}`;

    // Group transitions by step
    const transitionsByStep = new Map<number, typeof transitions>();
    for (const t of transitions) {
      if (!transitionsByStep.has(t.step)) {
        transitionsByStep.set(t.step, []);
      }
      transitionsByStep.get(t.step)!.push(t);
    }

    // Initialize with entry pages (step 1)
    const activeNodes = new Map<string, string>(); // path -> nodeId
    topEntries.forEach((entry, idx) => {
      const nodeId = getNodeId(entry.entry_page, 1);
      nodes.set(nodeId, {
        path: entry.entry_page,
        value: entry.count,
        step: 1,
        color: COLORS[idx % COLORS.length]!,
      });
      activeNodes.set(entry.entry_page, nodeId);
    });

    // Process each step: from active nodes, find top destinations
    for (let step = 1; step < steps; step++) {
      const stepTransitions = transitionsByStep.get(step) || [];
      const nextActiveNodes = new Map<string, string>();

      // For each currently active node, find its top destinations
      for (const [sourcePath, sourceNodeId] of activeNodes) {
        // Get transitions FROM this source path
        const fromSource = stepTransitions
          .filter((t) => t.source === sourcePath)
          .sort((a, b) => b.value - a.value)
          .slice(0, TOP_DESTINATIONS_PER_NODE);

        for (const t of fromSource) {
          // Skip self-loops
          if (t.source === t.target) {
            continue;
          }

          const targetNodeId = getNodeId(t.target, step + 1);

          // Add link using unique node IDs
          links.push({
            source: sourceNodeId,
            target: targetNodeId,
            value: t.value,
          });

          // Add/update target node
          const existing = nodes.get(targetNodeId);
          if (existing) {
            existing.value += t.value;
          } else {
            // Inherit color from source or assign new
            const sourceData = nodes.get(sourceNodeId);
            nodes.set(targetNodeId, {
              path: t.target,
              value: t.value,
              step: step + 1,
              color: sourceData?.color || COLORS[nodes.size % COLORS.length]!,
            });
          }

          nextActiveNodes.set(t.target, targetNodeId);
        }
      }

      // Update active nodes for next iteration
      activeNodes.clear();
      for (const [path, nodeId] of nextActiveNodes) {
        activeNodes.set(path, nodeId);
      }

      // Stop if no more nodes to process
      if (activeNodes.size === 0) {
        break;
      }
    }

    // Step 5: Filter links by threshold (0.25% of total sessions)
    const MIN_LINK_PERCENT = 0.25;
    const minLinkValue = Math.ceil((totalSessions * MIN_LINK_PERCENT) / 100);
    const filteredLinks = links.filter((link) => link.value >= minLinkValue);

    // Step 6: Find all nodes referenced by remaining links
    const referencedNodeIds = new Set<string>();
    filteredLinks.forEach((link) => {
      referencedNodeIds.add(link.source);
      referencedNodeIds.add(link.target);
    });

    // Step 7: Recompute node values from filtered links (sum of incoming links)
    const nodeValuesFromLinks = new Map<string, number>();
    filteredLinks.forEach((link) => {
      // Add to target node value
      const current = nodeValuesFromLinks.get(link.target) || 0;
      nodeValuesFromLinks.set(link.target, current + link.value);
    });

    // For entry nodes (step 1), only keep them if they have outgoing links after filtering
    nodes.forEach((nodeData, nodeId) => {
      if (nodeData.step === 1) {
        const hasOutgoing = filteredLinks.some((l) => l.source === nodeId);
        if (!hasOutgoing) {
          // No outgoing links, remove entry node
          referencedNodeIds.delete(nodeId);
        }
      }
    });

    // Step 8: Build final nodes array sorted by step then value
    // Only include nodes that are referenced by filtered links
    const finalNodes = Array.from(nodes.entries())
      .filter(([id]) => referencedNodeIds.has(id))
      .map(([id, data]) => {
        // Use value from links for non-entry nodes, or original value for entry nodes with outgoing links
        const value =
          data.step === 1
            ? data.value
            : nodeValuesFromLinks.get(id) || data.value;
        return {
          id,
          label: data.path, // Add label for display
          nodeColor: data.color,
          percentage: (value / totalSessions) * 100,
          value,
          step: data.step,
        };
      })
      .sort((a, b) => {
        // Sort by step first, then by value descending
        if (a.step !== b.step) {
          return a.step - b.step;
        }
        return b.value - a.value;
      });

    // Sanity check: Ensure all link endpoints exist in nodes
    const nodeIds = new Set(finalNodes.map((n) => n.id));
    const invalidLinks = filteredLinks.filter(
      (link) => !(nodeIds.has(link.source) && nodeIds.has(link.target))
    );
    if (invalidLinks.length > 0) {
      console.warn(
        `UserJourney: Found ${invalidLinks.length} links with missing nodes`
      );
      // Remove invalid links
      const validLinks = filteredLinks.filter(
        (link) => nodeIds.has(link.source) && nodeIds.has(link.target)
      );
      return {
        nodes: finalNodes,
        links: validLinks,
      };
    }

    // Sanity check: Ensure steps are monotonic (should always be true, but verify)
    const stepsValid = finalNodes.every((node, idx, arr) => {
      if (idx === 0) {
        return true;
      }
      return node.step! >= arr[idx - 1]!.step!;
    });
    if (!stepsValid) {
      console.warn('UserJourney: Steps are not monotonic');
    }

    return {
      nodes: finalNodes,
      links: filteredLinks,
    };
  }

  async getTopEvents({
    projectId,
    filters,
    startDate,
    endDate,
    timezone,
    excludeEvents = ['session_start', 'session_end', 'screen_view'],
  }: {
    projectId: string;
    filters: IChartEventFilter[];
    startDate: string;
    endDate: string;
    timezone: string;
    excludeEvents?: string[];
  }): Promise<Array<{ name: string; count: number }>> {
    const where = this.getRawWhereClause('events', filters);
    const excludeWhere =
      excludeEvents.length > 0
        ? `name NOT IN (${excludeEvents.map((e) => sqlstring.escape(e)).join(',')})`
        : '';

    const query = clix(this.client, timezone)
      .select<{ name: string; count: number }>(['name', 'count() as count'])
      .from(TABLE_NAMES.events, false)
      .where('project_id', '=', projectId)
      .where('created_at', 'BETWEEN', [
        clix.datetime(startDate, 'toDateTime'),
        clix.datetime(endDate, 'toDateTime'),
      ])
      .rawWhere(where)
      .rawWhere(excludeWhere)
      .groupBy(['name'])
      .orderBy('count', 'DESC')
      .limit(MAX_RECORDS_LIMIT);

    return query.execute();
  }

  async getEventAnalyticsList(
    input: IGetEventAnalyticsListInput
  ): Promise<IEventAnalyticsListOutput> {
    const rows = await buildEventAnalyticsListQuery(input).execute();
    const hasNextPage = rows.length > input.limit;
    const cursor = input.cursor ?? 0;

    return {
      rows: rows.slice(0, input.limit).map((row) => ({
        name: row.name,
        ...toEventAnalyticsRow(row, input.metrics, input.periods),
      })),
      nextCursor: hasNextPage ? cursor + input.limit : null,
    };
  }

  async getEventAnalyticsTotals(
    input: IGetEventAnalyticsTotalsInput
  ): Promise<IEventAnalyticsMetricRow> {
    const [totals] = await buildEventAnalyticsTotalsQuery(input).execute();

    return toEventAnalyticsRow(totals, input.metrics, input.periods);
  }

  async getEventPropertyKeys(
    input: IGetEventPropertyKeysInput
  ): Promise<IEventPropertyKeysOutput> {
    const rows = await buildEventPropertyKeysQuery(input).execute();

    return toEventPropertyKeyRows(rows, input);
  }

  // --- Event analytics tree: property values (T3) -------------------------
  async getEventPropertyValues(
    input: IGetEventPropertyValuesInput
  ): Promise<IEventPropertyValuesOutput> {
    const cursor = input.cursor ?? 0;
    const fetched = (await buildEventPropertyValuesQuery(
      input
    ).execute()) as EventPropertyValueQueryRow[];

    // The query asks for one row past the page, so an extra row is the only
    // proof another page exists.
    const hasMore = fetched.length > input.limit;
    const page = hasMore ? fetched.slice(0, input.limit) : fetched;
    const rows = page.map((row) => ({
      value: row.value,
      ...toEventAnalyticsRow(row, input.metrics, input.periods),
    }));

    if (!hasMore) {
      return { rows, remaining: 0, nextCursor: null };
    }

    // `remaining` and `nextCursor` are derived from the same flag on purpose:
    // a remaining count without a cursor would leave "Load more" inert.
    const totalDistinct = Number(fetched[0]?.total_distinct ?? 0);
    const consumed = cursor + rows.length;
    return {
      rows,
      remaining: Math.max(1, totalDistinct - consumed),
      nextCursor: consumed,
    };
  }

  async getTopLinkOut({
    projectId,
    filters,
    startDate,
    endDate,
    timezone,
  }: {
    projectId: string;
    filters: IChartEventFilter[];
    startDate: string;
    endDate: string;
    timezone: string;
  }): Promise<Array<{ href: string; count: number }>> {
    const where = this.getRawWhereClause('events', filters);
    const hrefKey = getSelectPropertyKey('properties.href');

    const query = clix(this.client, timezone)
      .select<{ href: string; count: number }>([
        `${hrefKey} as href`,
        'count() as count',
      ])
      .from(TABLE_NAMES.events, false)
      .where('project_id', '=', projectId)
      .where('name', '=', 'link_out')
      .where('created_at', 'BETWEEN', [
        clix.datetime(startDate, 'toDateTime'),
        clix.datetime(endDate, 'toDateTime'),
      ])
      .rawWhere(where)
      .rawWhere(`${hrefKey} IS NOT NULL AND ${hrefKey} != ''`)
      .groupBy(['href'])
      .orderBy('count', 'DESC')
      .limit(MAX_RECORDS_LIMIT);

    return query.execute();
  }

  async getMapData({
    projectId,
    filters,
    startDate,
    endDate,
    timezone,
  }: {
    projectId: string;
    filters: IChartEventFilter[];
    startDate: string;
    endDate: string;
    timezone: string;
  }): Promise<
    Array<{
      country: string;
      region?: string;
      city?: string;
      lat: number;
      lng: number;
      count: number;
    }>
  > {
    const where = this.getRawWhereClause('events', filters);

    // Note: ClickHouse doesn't have built-in lat/lng for countries/regions
    // This would typically require a lookup table or external service
    // For now, we'll return the data structure but lat/lng would need to be
    // resolved on the frontend or via a separate lookup
    const query = clix(this.client, timezone)
      .select<{
        country: string;
        region: string | null;
        city: string | null;
        count: number;
      }>([
        "nullIf(country, '') as country",
        "nullIf(region, '') as region",
        "nullIf(city, '') as city",
        'uniq(session_id) as count',
      ])
      .from(TABLE_NAMES.events, false)
      .where('project_id', '=', projectId)
      .where('created_at', 'BETWEEN', [
        clix.datetime(startDate, 'toDateTime'),
        clix.datetime(endDate, 'toDateTime'),
      ])
      .rawWhere(where)
      .rawWhere("country IS NOT NULL AND country != ''")
      .groupBy(['country', 'region', 'city'])
      .orderBy('count', 'DESC')
      .limit(MAX_RECORDS_LIMIT);

    const results = await query.execute();

    // Return with placeholder lat/lng - these should be resolved via geocoding
    // or a lookup table on the frontend/backend
    return results.map((row) => ({
      country: row.country,
      region: row.region ?? undefined,
      city: row.city ?? undefined,
      lat: 0, // Placeholder - needs geocoding
      lng: 0, // Placeholder - needs geocoding
      count: row.count,
    }));
  }
}

export const overviewService = new OverviewService(ch);

import { getSettingsForProject } from './organization.service';

export type TrafficColumn =
  | 'referrer'
  | 'referrer_name'
  | 'referrer_type'
  | 'utm_source'
  | 'utm_medium'
  | 'utm_campaign'
  | 'country'
  | 'region'
  | 'city'
  | 'device'
  | 'browser'
  | 'os';

export async function getTrafficBreakdownCore(input: {
  projectId: string;
  startDate: string;
  endDate: string;
  column: TrafficColumn;
  filters?: IChartEventFilter[];
}) {
  const { timezone } = await getSettingsForProject(input.projectId);
  return overviewService.getTopGeneric({
    projectId: input.projectId,
    filters: input.filters ?? [],
    startDate: input.startDate,
    endDate: input.endDate,
    column: input.column,
    timezone,
  });
}

// Columns whose daily series we can derive from the sessions table. Page/entry
// insights (path/origin) live on the events table and aren't covered here — the
// caller degrades to no series for those.
const SEGMENT_SERIES_COLUMNS: ReadonlySet<string> = new Set<TrafficColumn>([
  'referrer',
  'referrer_name',
  'referrer_type',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'country',
  'region',
  'city',
  'device',
  'browser',
  'os',
]);

export interface SegmentDailyPoint {
  date: string;
  sessions: number;
  pageviews: number;
}

// Daily breakdown for a single segment value (e.g. the "Twitter" referrer),
// so the explainer can see the *shape* of a change (one-off spike vs sustained
// growth) instead of only current-vs-baseline totals. Returns one point per day
// with zero-filled gaps; empty when the column isn't session-derived or the
// value never appears in the window.
export async function getSegmentDailySeriesCore(input: {
  projectId: string;
  column: string;
  value: string;
  startDate: string;
  endDate: string;
}): Promise<SegmentDailyPoint[]> {
  if (!SEGMENT_SERIES_COLUMNS.has(input.column)) {
    return [];
  }

  const { timezone } = await getSettingsForProject(input.projectId);
  const { items } = await overviewService.getTopGenericSeries({
    projectId: input.projectId,
    filters: [],
    startDate: input.startDate,
    endDate: input.endDate,
    column: input.column as TrafficColumn,
    interval: 'day',
    timezone,
  });

  // getTopGenericSeries reports empty values as null name; insights store the
  // empty referrer as "direct". Match the segment leniently.
  const target = input.value.toLowerCase();
  const matched = items.find((item) => {
    const name = (item.name ?? '').toLowerCase();
    return name === target || (name === '' && target === 'direct');
  });

  return (matched?.data ?? []).map((point) => ({
    date: point.date,
    sessions: Number(point.sessions ?? 0),
    pageviews: Number(point.pageviews ?? 0),
  }));
}

export interface GetAnalyticsOverviewInput {
  projectId: string;
  startDate: string;
  endDate: string;
  interval?: 'hour' | 'day' | 'week' | 'month';
  filters?: IChartEventFilter[];
}

export async function getAnalyticsOverviewCore(
  input: GetAnalyticsOverviewInput,
) {
  const { timezone } = await getSettingsForProject(input.projectId);
  const interval = input.interval ?? 'day';

  const result = await overviewService.getMetrics({
    projectId: input.projectId,
    filters: input.filters ?? [],
    startDate: input.startDate,
    endDate: input.endDate,
    interval,
    timezone,
  });

  return {
    summary: result.metrics,
    series: result.series,
    interval,
    startDate: input.startDate,
    endDate: input.endDate,
  };
}
