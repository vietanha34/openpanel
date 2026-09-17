/** biome-ignore-all lint/style/useDefaultSwitchClause: switch cases are exhaustive by design */
import { stripLeadingAndTrailingSlashes } from '@openpanel/common';
import {
  type CohortDefinition,
  flattenConditions,
  getCohortIds,
  type IChartBreakdown,
  type IChartEventFilter,
  type IGetChartDataInput,
  type IReportInput,
} from '@openpanel/validation';
import sqlstring from 'sqlstring';
import { formatClickhouseDate, TABLE_NAMES } from '../clickhouse/client';
import { getFilterGroupWhere } from './filter-group.service';
import { db } from '../prisma-client';
import { createSqlBuilder } from '../sql-builder';
import { buildTypedClause, hasTypedCast, isTypedOperator } from './filter-cast';

// Top-level columns on the events table. Derived from the migration in
// packages/db/code-migrations/3-init-ch.ts (+ revenue added in 6-add-revenue-
// column.ts). Used by `resolveEventColumn` to distinguish real columns from
// property keys and reject unknown identifiers before they reach ClickHouse.
const EVENT_TOP_LEVEL_COLUMNS = new Set<string>([
  'id',
  'name',
  'sdk_name',
  'sdk_version',
  'device_id',
  'profile_id',
  'project_id',
  'session_id',
  'path',
  'origin',
  'referrer',
  'referrer_name',
  'referrer_type',
  'duration',
  'revenue',
  'created_at',
  'country',
  'city',
  'region',
  'longitude',
  'latitude',
  'os',
  'os_version',
  'browser',
  'browser_version',
  'device',
  'brand',
  'model',
  'imported_at',
]);

// Older clients / saved reports send some field names in camelCase. Map them
// to the canonical snake_case ClickHouse column so they don't fall through as
// unknown identifiers. The bare values (`utm_source` etc.) actually live in
// the `properties` map — `normalizeEventField` rewrites those into the
// `properties.__query.utm_*` form.
const EVENT_FIELD_ALIASES: Record<string, string> = {
  referrerName: 'referrer_name',
  referrerType: 'referrer_type',
  sessionId: 'session_id',
  deviceId: 'device_id',
  profileId: 'profile_id',
  projectId: 'project_id',
  osVersion: 'os_version',
  browserVersion: 'browser_version',
  sdkName: 'sdk_name',
  sdkVersion: 'sdk_version',
  createdAt: 'created_at',
  importedAt: 'imported_at',
};

const EVENT_UTM_BARE_COLUMNS = new Set<string>([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
]);

// Normalize an incoming field name into its canonical form. Returns a string
// suitable for `getSelectPropertyKey` / `getEventFiltersWhereClause` — i.e.
// either a top-level column name (`referrer_name`), a `properties.foo` /
// `profile.foo` / `group.foo` path, or `has_profile`. Unknown names are
// returned unchanged; callers must guard with `isKnownEventField` before
// inlining into SQL.
export function normalizeEventField(name: string): string {
  if (EVENT_FIELD_ALIASES[name]) {
    return EVENT_FIELD_ALIASES[name]!;
  }
  if (EVENT_UTM_BARE_COLUMNS.has(name)) {
    return `properties.__query.${name}`;
  }
  return name;
}

// Returns true if `name` resolves to something we can inline into SQL safely:
// a known top-level events column, a properties / profile / group path, a
// cohort breakdown, or `has_profile`. Used to drop unknown filters/breakdowns
// instead of emitting invalid `SELECT cohort` / `SELECT temple_name` queries.
export function isKnownEventField(name: string): boolean {
  if (name === 'has_profile') return true;
  if (isAllCohortsBreakdown(name)) return true;
  if (extractCohortId(name)) return true;
  if (name.startsWith('properties.')) return true;
  if (name.startsWith('profile.')) return true;
  if (name.startsWith('group.')) return true;
  const normalized = normalizeEventField(name);
  if (normalized.startsWith('properties.')) return true;
  if (EVENT_TOP_LEVEL_COLUMNS.has(normalized)) return true;
  return false;
}

export type CohortMetadata = {
  id: string;
  name: string;
};

export async function fetchCohortsMetadata(
  cohortIds: string[],
): Promise<Map<string, CohortMetadata>> {
  if (cohortIds.length === 0) {
    return new Map();
  }

  const cohorts = await db.cohort.findMany({
    where: { id: { in: cohortIds } },
    select: { id: true, name: true },
  });

  return new Map(
    cohorts.map((c) => [c.id, { id: c.id, name: c.name }]),
  );
}

export function getCohortCteName(cohortId: string): string {
  return `\`cohort-${cohortId}\``;
}

export function getCohortAlias(cohortId: string): string {
  return `cohort_${cohortId.replace(/-/g, '_')}`;
}

export function buildCohortMembershipQuery(
  cohortId: string,
  projectId: string,
): string {
  return `
    SELECT profile_id
    FROM ${TABLE_NAMES.cohort_members} FINAL
    WHERE cohort_id = ${sqlstring.escape(cohortId)}
      AND project_id = ${sqlstring.escape(projectId)}
  `;
}

export function buildInlineCohortJoin(
  cohortId: string,
  projectId: string,
  tableAlias: string,
): string {
  const cohortAlias = getCohortAlias(cohortId);
  const cohortQuery = buildCohortMembershipQuery(cohortId, projectId);
  return `LEFT ANY JOIN (${cohortQuery}) AS ${cohortAlias} ON ${cohortAlias}.profile_id = ${tableAlias}.profile_id`;
}

export function extractCohortId(breakdownName: string): string | null {
  if (breakdownName.startsWith('cohort:')) {
    return breakdownName.split(':')[1] ?? null;
  }
  return null;
}

export function isAllCohortsBreakdown(breakdownName: string): boolean {
  return breakdownName === 'cohort';
}

export async function fetchProjectCohorts(
  projectId: string,
): Promise<CohortMetadata[]> {
  return db.cohort.findMany({
    where: { projectId },
    select: { id: true, name: true },
  });
}

export function buildAllCohortsMembershipQuery(
  projectId: string,
): string {
  return `
    SELECT profile_id, cohort_id
    FROM ${TABLE_NAMES.cohort_members} FINAL
    WHERE project_id = ${sqlstring.escape(projectId)}
  `;
}

export function buildAllCohortsLabelExpr(
  cohorts: CohortMetadata[],
  alias = '_all_cohorts',
): string {
  if (cohorts.length === 0) {
    return "'Unknown'";
  }
  const ids = cohorts.map((c) => sqlstring.escape(c.id)).join(', ');
  const names = cohorts.map((c) => sqlstring.escape(c.name)).join(', ');
  return `transform(${alias}.cohort_id, [${ids}], [${names}], 'Unknown')`;
}

/**
 * Cohort IDs that need a `cohort_<id>` JOIN alias to be wired up by the
 * caller. After filter SQL became self-contained, only cohort *breakdowns*
 * require the JOIN — they reference `cohort_<id>.profile_id` in their
 * SELECT expression via `getSelectPropertyKey`.
 */
export function collectBreakdownCohortIds(
  breakdowns: IChartBreakdown[],
): string[] {
  const ids = new Set<string>();
  for (const breakdown of breakdowns) {
    const id = extractCohortId(breakdown.name);
    if (id) {
      ids.add(id);
    }
  }
  return Array.from(ids);
}

export function transformPropertyKey(property: string) {
  const propertyPatterns = ['properties', 'profile.properties'];
  const match = propertyPatterns.find((pattern) =>
    property.startsWith(`${pattern}.`)
  );

  if (!match) {
    return property;
  }

  // Wildcard grammar. A wildcard segment names every nested key at that
  // position, and the whole key becomes a LIKE pattern over the map's keys —
  // relative to that map, so the matched `properties.` / `profile.properties.`
  // prefix is dropped by length (an events key like `properties.profile_type.*`
  // keeps its name). The `chart.properties` router writes array indexes as
  // `.*.` (between segments) and `[*]` (otherwise), so `[*]` is the same
  // segment as `.*`:
  //
  //   items.*.name     -> items.%.name    middle
  //   items.*          -> items.%         trailing
  //   tags[*]          -> tags.%          array
  //   a.*.b.*.c        -> a.%.b.%.c       several: every one, not the first
  //   a.*[*].c         -> a.%.%.c         adjacent (router output for a.0.1.c)
  //   *.sku            -> %.sku           leading: no dot before it
  //   *                -> %               bare: every key of the map
  //
  // A `*` is a segment when it starts the key or follows a dot, and ends the
  // key or precedes a dot. Both replacements are global, and the lookahead
  // leaves the next segment's dot unconsumed so adjacent wildcards (`.*.*.`)
  // are both matched. A `*` that is not a whole segment stays literal.
  if (property.includes('*')) {
    return property
      .slice(match.length + 1)
      .replace(/\[\*\]/g, '.*')
      .replace(/(^|\.)\*(?=\.|$)/g, '$1%');
  }

  return `${match}['${property.replace(new RegExp(`^${match}.`), '')}']`;
}

// Returns a SQL expression for a group property via the _g JOIN alias
// property format: "group.name", "group.type", "group.properties.plan"
export function getGroupPropertySql(property: string): string {
  const withoutPrefix = property.replace(/^group\./, '');
  if (withoutPrefix === 'name') {
    return '_g.name';
  }
  if (withoutPrefix === 'type') {
    return '_g.type';
  }
  if (withoutPrefix.startsWith('properties.')) {
    const propKey = withoutPrefix.replace(/^properties\./, '');
    return `_g.properties[${sqlstring.escape(propKey)}]`;
  }
  return '_group_id';
}

// Returns the SELECT expression when querying the groups table directly (no join alias).
// Use for fetching distinct values for group.* properties.
export function getGroupPropertySelect(property: string): string {
  const withoutPrefix = property.replace(/^group\./, '');
  if (withoutPrefix === 'name') {
    return 'name';
  }
  if (withoutPrefix === 'type') {
    return 'type';
  }
  if (withoutPrefix === 'id') {
    return 'id';
  }
  if (withoutPrefix.startsWith('properties.')) {
    const propKey = withoutPrefix.replace(/^properties\./, '');
    return `properties[${sqlstring.escape(propKey)}]`;
  }
  return 'id';
}

// Returns the SELECT expression when querying the profiles table directly (no join alias).
// Use for fetching distinct values for profile.* properties.
// Lists the same profiles columns as PROFILE_COLUMNS in filter-where.service.ts,
// which resolves profile.* on the filter side; keep the two in sync.
export function getProfilePropertySelect(property: string): string {
  const withoutPrefix = property.replace(/^profile\./, '');
  if (withoutPrefix === 'id') {
    return 'id';
  }
  if (withoutPrefix === 'first_name') {
    return 'first_name';
  }
  if (withoutPrefix === 'last_name') {
    return 'last_name';
  }
  if (withoutPrefix === 'email') {
    return 'email';
  }
  if (withoutPrefix === 'avatar') {
    return 'avatar';
  }
  if (withoutPrefix === 'created_at') {
    return 'created_at';
  }
  if (withoutPrefix === 'last_seen_at') {
    return 'last_seen_at';
  }
  if (withoutPrefix.startsWith('properties.')) {
    const propKey = withoutPrefix.replace(/^properties\./, '');
    return `properties[${sqlstring.escape(propKey)}]`;
  }
  return 'id';
}

export function getSelectPropertyKey(
  rawProperty: string,
  projectId?: string,
  cohortId?: string,
  cohortName?: string,
  /**
   * When set, the events table's `properties` map is qualified with this
   * alias (e.g. `e.properties[...]`). Required in any query where another
   * joined table also exposes a `properties` column (such as the groups
   * `_g` join), otherwise ClickHouse rejects with "ambiguous identifier".
   */
  eventsAlias?: string,
) {
  // Map camelCase aliases (`referrerName` → `referrer_name`) and bare UTM
  // names (`utm_source` → `properties.__query.utm_source`) into their
  // canonical form before doing any pattern matching. The fallback at the
  // bottom of this function returns `property` verbatim, so without this
  // normalization an alias would leak into the generated SQL and fail with
  // UNKNOWN_IDENTIFIER.
  const property = normalizeEventField(rawProperty);
  const extractedCohortId = cohortId || extractCohortId(property);

  if (extractedCohortId && projectId) {
    const cohortAlias = getCohortAlias(extractedCohortId);
    const inLabel = cohortName
      ? sqlstring.escape(cohortName)
      : "'In Cohort'";
    const notInLabel = cohortName
      ? sqlstring.escape(`Not ${cohortName}`)
      : "'Not In Cohort'";
    return `if(notEmpty(${cohortAlias}.profile_id), ${inLabel}, ${notInLabel})`;
  }

  if (property === 'has_profile') {
    return `if(profile_id != device_id, 'true', 'false')`;
  }

  // Handle group properties — requires ARRAY JOIN + _g JOIN to be present in query
  if (property.startsWith('group.') && projectId) {
    return getGroupPropertySql(property);
  }

  const propertyPatterns = ['properties', 'profile.properties'];

  const match = propertyPatterns.find((pattern) =>
    property.startsWith(`${pattern}.`)
  );
  if (!match) {
    return property;
  }

  // Only the events table's bare `properties` map needs aliasing —
  // `profile.properties` already routes through the profile join alias.
  const aliasPrefix = match === 'properties' && eventsAlias
    ? `${eventsAlias}.`
    : '';

  if (property.includes('*')) {
    return `arrayMap(x -> trim(x), mapValues(mapExtractKeyLike(${aliasPrefix}${match}, ${sqlstring.escape(
      transformPropertyKey(property)
    )})))`;
  }

  return `${aliasPrefix}${match}[${sqlstring.escape(
    property.slice(match.length + 1)
  )}]`;
}


// --- profile-property CTE narrowing (perf) ---------------------------------
// profile.properties.<key> refs render as Map lookups `profile.properties['<key>']`.
// Pulling the whole `properties` Map into the profile CTE makes the LEFT ANY
// JOIN hash carry the full Map per profile — roughly a kilobyte each on real
// data — and OOMs at scale. Instead we project ONLY the referenced keys as
// scalar columns in the CTE and rewrite the refs to those columns — identical
// results at a fraction of the memory. Wildcard refs (mapExtractKeyLike) still
// need the full Map, so those fall back to selecting it.

const PROFILE_PROP_PREFIX = 'profile.properties.';

export function collectProfilePropertyKeys(refs: { name: string }[]): {
  keys: string[];
  needsFullMap: boolean;
} {
  const keys = new Set<string>();
  let needsFullMap = false;
  for (const { name } of refs) {
    if (!name.startsWith(PROFILE_PROP_PREFIX)) {
      continue;
    }
    // Wildcard refs render as mapExtractKeyLike over the whole Map.
    if (name.includes('*')) {
      needsFullMap = true;
      continue;
    }
    const key = name.slice(PROFILE_PROP_PREFIX.length);
    // A backtick or backslash in the key can't be embedded in the
    // backtick-quoted scalar alias. Such keys are never narrowed: the full
    // Map stays selected and their refs keep the original Map access.
    if (/[`\\]/.test(key)) {
      needsFullMap = true;
      continue;
    }
    keys.add(key);
  }
  return { keys: Array.from(keys), needsFullMap };
}

// The profile-CTE SELECT expression for the `properties` field: one scalar
// column per referenced key, plus the full Map only when a wildcard ref needs
// it (or when nothing specific was referenced).
export function profilePropertiesCteSelect(
  keys: string[],
  needsFullMap: boolean,
): string {
  const cols = keys.map(
    (k) => `properties[${sqlstring.escape(k)}] as \`profile.properties.${k}\``,
  );
  if (needsFullMap || cols.length === 0) {
    cols.push('properties as "profile.properties"');
  }
  return cols.join(', ');
}

// Rewrite `profile.properties['<key>']` -> `` `profile.properties.<key>` ``
// for the narrowed keys. Matches the raw render from getSelectPropertyKey /
// the filter builders; never matches the CTE's own `properties['<key>']`,
// which has no `profile.` prefix. No-op when keys is empty.
// The Map-access text a `profile.properties.<key>` ref renders as. Must stay
// identical to what `getSelectPropertyKey` emits for that key: a key whose
// quotes are escaped there but not here would be searched for in a form the
// query never contains, leaving the ref pointing at a Map the CTE dropped.
function profilePropertyRef(key: string): string {
  return `profile.properties[${sqlstring.escape(key)}]`;
}

export function rewriteProfilePropertyRefs(sql: string, keys: string[]): string {
  let out = sql;
  for (const k of keys) {
    out = out
      .split(profilePropertyRef(k))
      .join(`\`profile.properties.${k}\``);
  }
  return out;
}

export async function getChartSql({
  event,
  breakdowns: initialBreakdowns,
  interval,
  startDate,
  endDate,
  projectId,
  timezone,
}: IGetChartDataInput & { timezone: string }) {
  const {
    sb,
    join,
    getWhere,
    getFrom,
    getJoins,
    getSelect,
    getOrderBy,
    getGroupBy,
    getFill,
    getWith,
    with: addCte,
  } = createSqlBuilder();

  // Drop breakdowns whose field name doesn't resolve to a known events
  // column, properties path, profile path, group path, or cohort. The chart
  // service used to inline whatever the dashboard sent — saved reports with
  // fields like `temple_name` (a property, not a column) reached the _uc CTE
  // as `SELECT temple_name as _uc_label_1 FROM events`, failing parse.
  let breakdowns = initialBreakdowns.filter((b) => isKnownEventField(b.name));
  const requestedAllCohortsBreakdown = breakdowns.some((b) =>
    isAllCohortsBreakdown(b.name),
  );
  const allCohorts = requestedAllCohortsBreakdown
    ? await fetchProjectCohorts(projectId)
    : [];
  // Drop the all-cohorts breakdown when the project has no cohorts: the label
  // expression collapses to the literal 'Unknown', making the _uc JOIN ON it
  // a constant comparison with no join key (ClickHouse rejects with
  // "Cannot determine join keys").
  if (requestedAllCohortsBreakdown && allCohorts.length === 0) {
    breakdowns = breakdowns.filter((b) => !isAllCohortsBreakdown(b.name));
  }
  const hasAllCohortsBreakdown =
    requestedAllCohortsBreakdown && allCohorts.length > 0;

  const cohortIds = collectBreakdownCohortIds(breakdowns);
  const cohortMetadata = await fetchCohortsMetadata(cohortIds);

  // Event Analytics sends its AND/OR filter group; every other caller sends
  // the flat array only, which keeps its SQL byte-identical. With a group,
  // `profile.*` conditions compile to their own subselect (see
  // compileEventAnalyticsFilter), so they must NOT reach the profile join or
  // its key narrowing below.
  //
  // ponytail: rewriteProfilePropertyRefs rewrites every `profile.properties['k']`
  // in the finished SQL, subselects included. A group condition on a profile
  // key that a breakdown or metric ALSO reads would be rewritten to the CTE's
  // scalar alias inside the subselect and fail loudly (ClickHouse code 48).
  // The Event Analytics chart never breaks down or measures by a profile
  // property; protect the group clause from the rewrite if a caller ever does.
  const filterGroup = event.filterGroup;
  const scopeFilters = filterGroup
    ? flattenConditions(filterGroup).filter(
        (filter) => !filter.name.startsWith('profile.'),
      )
    : event.filters;

  const profileProps = collectProfilePropertyKeys([
    ...scopeFilters,
    ...breakdowns,
    // Math metrics (property_sum/avg/min/max) reference event.property too —
    // missing it here would strip the Map the metric still reads from.
    ...(event.property ? [{ name: event.property }] : []),
  ]);

  // Add CTE + JOIN for "all cohorts" breakdown
  if (hasAllCohortsBreakdown) {
    addCte('_all_cohorts', buildAllCohortsMembershipQuery(projectId));
    sb.joins._all_cohorts =
      'INNER JOIN _all_cohorts ON _all_cohorts.profile_id = e.profile_id';
  }

  // Add individual cohort CTEs (for single-cohort filters)
  for (const cohortId of cohortIds) {
    addCte(
      getCohortCteName(cohortId),
      buildCohortMembershipQuery(cohortId, projectId),
    );
    sb.joins[`cohort_${cohortId}`] =
      `LEFT ANY JOIN ${getCohortCteName(cohortId)} AS ${getCohortAlias(cohortId)} ON ${getCohortAlias(cohortId)}.profile_id = e.profile_id`;
  }

  sb.where = filterGroup
    ? getFilterGroupWhere(filterGroup, (filter) =>
        compileEventAnalyticsFilter(filter, projectId, 'e'),
      )
    : getEventFiltersWhereClause(event.filters, projectId, 'e');
  sb.where.projectId = `project_id = ${sqlstring.escape(projectId)}`;

  if (event.name !== '*') {
    sb.select.label_0 = `${sqlstring.escape(event.name)} as label_0`;
    sb.where.eventName = `e.name = ${sqlstring.escape(event.name)}`;
  } else {
    sb.select.label_0 = `'*' as label_0`;
  }

  const anyFilterOnProfile = scopeFilters.some((filter) =>
    filter.name.startsWith('profile.')
  );
  const anyBreakdownOnProfile = breakdowns.some((breakdown) =>
    breakdown.name.startsWith('profile.')
  );
  // Math metrics (property_sum/avg/min/max) can target a profile property
  // too — the join must exist for the metric alone, not only for filters
  // and breakdowns.
  const anyMetricOnProfile = !!event.property?.startsWith('profile.');
  const anyFilterOnGroup = scopeFilters.some((filter) =>
    filter.name.startsWith('group.')
  );
  const anyBreakdownOnGroup = breakdowns.some((breakdown) =>
    breakdown.name.startsWith('group.')
  );
  const anyMetricOnGroup = !!event.property?.startsWith('group.');
  const needsGroupArrayJoin =
    anyFilterOnGroup ||
    anyBreakdownOnGroup ||
    anyMetricOnGroup ||
    event.segment === 'group';

  if (needsGroupArrayJoin) {
    addCte(
      '_g',
      `SELECT id, name, type, properties FROM ${TABLE_NAMES.groups} FINAL WHERE project_id = ${sqlstring.escape(projectId)}`
    );
    sb.joins.groups = 'ARRAY JOIN groups AS _group_id';
    sb.joins.groups_table = 'LEFT ANY JOIN _g ON _g.id = _group_id';
  }

  // Collect all profile fields used in filters and breakdowns
  // Extract top-level field names (e.g., 'properties' from 'profile.properties.os')
  const getProfileFields = () => {
    const fields = new Set<string>();

    // Always need id for the join
    fields.add('id');

    // Collect from filters
    scopeFilters
      .filter((f) => f.name.startsWith('profile.'))
      .forEach((f) => {
        const fieldName = f.name.replace('profile.', '').split('.')[0];
        if (fieldName && fieldName === 'properties') {
          fields.add('properties');
        } else if (
          fieldName &&
          [
            'email',
            'first_name',
            'last_name',
            'created_at',
            'last_seen_at',
          ].includes(fieldName)
        ) {
          fields.add(fieldName);
        }
      });

    // Collect from breakdowns
    breakdowns
      .filter((b) => b.name.startsWith('profile.'))
      .forEach((b) => {
        const fieldName = b.name.replace('profile.', '').split('.')[0];
        if (fieldName && fieldName === 'properties') {
          fields.add('properties');
        } else if (
          fieldName &&
          [
            'email',
            'first_name',
            'last_name',
            'created_at',
            'last_seen_at',
          ].includes(fieldName)
        ) {
          fields.add(fieldName);
        }
      });

    // Collect from the math metric
    if (event.property?.startsWith('profile.')) {
      const fieldName = event.property.replace('profile.', '').split('.')[0];
      if (fieldName && fieldName === 'properties') {
        fields.add('properties');
      } else if (
        fieldName &&
        [
          'email',
          'first_name',
          'last_name',
          'created_at',
          'last_seen_at',
        ].includes(fieldName)
      ) {
        fields.add(fieldName);
      }
    }

    return Array.from(fields);
  };

  // Create profiles CTE if profiles are needed (to avoid duplicating the heavy profile join)
  // Only select the fields that are actually used
  const profilesJoinRef =
    anyFilterOnProfile || anyBreakdownOnProfile || anyMetricOnProfile
      ? 'LEFT ANY JOIN profile ON profile.id = profile_id'
      : '';

  if (anyFilterOnProfile || anyBreakdownOnProfile || anyMetricOnProfile) {
    const profileFields = getProfileFields();
    const selectFields = profileFields.map((field) => {
      if (field === 'id') {
        return 'id as "profile.id"';
      }
      if (field === 'properties') {
        return profilePropertiesCteSelect(
          profileProps.keys,
          profileProps.needsFullMap,
        );
      }
      if (field === 'email') {
        return 'email as "profile.email"';
      }
      if (field === 'first_name') {
        return 'first_name as "profile.first_name"';
      }
      if (field === 'last_name') {
        return 'last_name as "profile.last_name"';
      }
      if (field === 'created_at') {
        return 'created_at as "profile.created_at"';
      }
      if (field === 'last_seen_at') {
        return 'last_seen_at as "profile.last_seen_at"';
      }
      return field;
    });

    // Add profiles CTE using the builder
    addCte(
      'profile',
      `SELECT ${selectFields.join(', ')}
      FROM ${TABLE_NAMES.profiles} FINAL
      WHERE project_id = ${sqlstring.escape(projectId)}`
    );

    // Use the CTE reference in the main query
    sb.joins.profiles = profilesJoinRef;
  }

  sb.select.count = 'count(*) as count';
  // ClickHouse rejects WITH FILL when TO < FROM, so only emit a fill clause
  // for a valid range. The SELECT bucket truncation is always safe.
  const hasValidFillRange =
    !!startDate && !!endDate && new Date(endDate) >= new Date(startDate);
  switch (interval) {
    case 'minute': {
      if (hasValidFillRange) {
        sb.fill = `FROM toStartOfMinute(toDateTime('${startDate}')) TO toStartOfMinute(toDateTime('${endDate}')) STEP toIntervalMinute(1)`;
      }
      sb.select.date = 'toStartOfMinute(created_at) as date';
      break;
    }
    case 'hour': {
      if (hasValidFillRange) {
        sb.fill = `FROM toStartOfHour(toDateTime('${startDate}')) TO toStartOfHour(toDateTime('${endDate}')) STEP toIntervalHour(1)`;
      }
      sb.select.date = 'toStartOfHour(created_at) as date';
      break;
    }
    case 'day': {
      if (hasValidFillRange) {
        sb.fill = `FROM toStartOfDay(toDateTime('${startDate}')) TO toStartOfDay(toDateTime('${endDate}')) STEP toIntervalDay(1)`;
      }
      sb.select.date = 'toStartOfDay(created_at) as date';
      break;
    }
    case 'week': {
      if (hasValidFillRange) {
        sb.fill = `FROM toStartOfWeek(toDateTime('${startDate}'), 1, '${timezone}') TO toStartOfWeek(toDateTime('${endDate}'), 1, '${timezone}') STEP toIntervalWeek(1)`;
      }
      sb.select.date = `toStartOfWeek(created_at, 1, '${timezone}') as date`;
      break;
    }
    case 'month': {
      if (hasValidFillRange) {
        sb.fill = `FROM toStartOfMonth(toDateTime('${startDate}'), '${timezone}') TO toStartOfMonth(toDateTime('${endDate}'), '${timezone}') STEP toIntervalMonth(1)`;
      }
      sb.select.date = `toStartOfMonth(created_at, '${timezone}') as date`;
      break;
    }
  }
  sb.groupBy.date = 'date';
  sb.orderBy.date = 'date ASC';

  if (startDate) {
    sb.where.startDate = `created_at >= toDateTime('${formatClickhouseDate(startDate)}')`;
  }

  if (endDate) {
    sb.where.endDate = `created_at <= toDateTime('${formatClickhouseDate(endDate)}')`;
  }

  breakdowns.forEach((breakdown, index) => {
    // Breakdowns start at label_1 (label_0 is reserved for event name)
    const key = `label_${index + 1}`;

    if (isAllCohortsBreakdown(breakdown.name)) {
      sb.select[key] = `${buildAllCohortsLabelExpr(allCohorts)} as ${key}`;
    } else {
      const breakdownCohortId = extractCohortId(breakdown.name);
      const breakdownCohortName = breakdownCohortId
        ? cohortMetadata.get(breakdownCohortId)?.name
        : undefined;
      sb.select[key] =
        `${getSelectPropertyKey(breakdown.name, projectId, breakdownCohortId ?? undefined, breakdownCohortName, 'e')} as ${key}`;
    }
    sb.groupBy[key] = `${key}`;
  });

  if (event.segment === 'user') {
    sb.select.count = 'countDistinct(profile_id) as count';
  }

  if (event.segment === 'session') {
    sb.select.count = 'countDistinct(session_id) as count';
  }

  if (event.segment === 'group') {
    sb.select.count = 'countDistinct(_group_id) as count';
  }

  if (event.segment === 'user_average') {
    sb.select.count =
      'COUNT(*)::float / COUNT(DISTINCT profile_id)::float as count';
  }

  const mathFunction = {
    property_sum: 'sum',
    property_average: 'avg',
    property_max: 'max',
    property_min: 'min',
  }[event.segment as string];

  if (mathFunction && event.property) {
    const propertyKey = getSelectPropertyKey(
      event.property,
      undefined,
      undefined,
      undefined,
      'e',
    );

    if (isNumericColumn(event.property)) {
      sb.select.count = `${mathFunction}(${propertyKey}) as count`;
      sb.where.property = `${propertyKey} IS NOT NULL`;
    } else {
      sb.select.count = `${mathFunction}(toFloat64OrNull(${propertyKey})) as count`;
      sb.where.property = `${propertyKey} IS NOT NULL AND notEmpty(${propertyKey})`;
    }
  }

  const eventAnalyticsExpression = eventAnalyticsSegmentExpression(event, 'e');
  if (eventAnalyticsExpression) {
    sb.select.count = `${eventAnalyticsExpression} as count`;
  }

  if (event.segment === 'one_event_per_user') {
    sb.from = `(
      SELECT DISTINCT ON (profile_id) * from ${TABLE_NAMES.events} e ${getJoins()} WHERE ${join(
        sb.where,
        ' AND '
      )}
        ORDER BY profile_id, created_at DESC
      ) as subQuery`;
    sb.joins = {};
    // Filters were already applied inside the subquery, and the outer query
    // selects from `subQuery` — the `e` alias used in sb.where is no longer
    // in scope, so re-emitting WHERE would produce
    // "Unknown identifier `e.name`". Clear it.
    sb.where = {};

    const sql = rewriteProfilePropertyRefs(
      `${getWith()}${getSelect()} ${getFrom()} ${getJoins()} ${getWhere()} ${getGroupBy()} ${getOrderBy()} ${getFill()}`,
      profileProps.keys,
    );
    console.log('-- Report --');
    console.log(sql.replaceAll(/[\n\r]/g, ' '));
    console.log('-- End --');
    return sql;
  }

  // Single-pass total_count: aggregate uniqState(profile_id) alongside the
  // series in the same scan, then merge the per-group states with a window
  // aggregate in an outer select — PARTITION BY the breakdown labels, or an
  // empty partition for the global total. The previous shape re-ran the
  // chart's entire WHERE in a second full scan (a `_uc` CTE joined back per
  // label / injected as a scalar subquery), doubling every chart's read
  // cost. uniq states merge losslessly, so the result matches the two-scan
  // form exactly. (The old _uc scan nominally excluded a `bar` filter, but
  // nothing sets sb.where.bar anymore — the exclusion was dead code.)
  sb.select.uc_state = 'uniqState(profile_id) as _uc_state';

  const totalCountPartition = breakdowns
    .map((_, index) => `label_${index + 1}`)
    .join(', ');
  const totalCountSelect = `uniqMerge(_uc_state) OVER (${totalCountPartition ? `PARTITION BY ${totalCountPartition}` : ''}) as total_count`;

  const sql = rewriteProfilePropertyRefs(
    `${getWith()}SELECT * EXCEPT (_uc_state), ${totalCountSelect} FROM (${getSelect()} ${getFrom()} ${getJoins()} ${getWhere()} ${getGroupBy()}) ${getOrderBy()} ${getFill()}`,
    profileProps.keys,
  );
  console.log('-- Report --');
  console.log(sql.replaceAll(/[\n\r]/g, ' '));
  console.log('-- End --');
  return sql;
}

export async function getAggregateChartSql({
  event,
  breakdowns: initialBreakdowns,
  startDate,
  endDate,
  projectId,
  limit,
}: Omit<IGetChartDataInput, 'interval' | 'chartType'> & {
  timezone: string;
}) {
  const { sb, join, getJoins, with: addCte, getSql } = createSqlBuilder();

  // Drop breakdowns whose field name doesn't resolve to a known events
  // column, properties path, profile path, group path, or cohort. The chart
  // service used to inline whatever the dashboard sent — saved reports with
  // fields like `temple_name` (a property, not a column) reached the _uc CTE
  // as `SELECT temple_name as _uc_label_1 FROM events`, failing parse.
  let breakdowns = initialBreakdowns.filter((b) => isKnownEventField(b.name));
  const requestedAllCohortsBreakdown = breakdowns.some((b) =>
    isAllCohortsBreakdown(b.name),
  );
  const allCohorts = requestedAllCohortsBreakdown
    ? await fetchProjectCohorts(projectId)
    : [];
  // See getChartSql for rationale.
  if (requestedAllCohortsBreakdown && allCohorts.length === 0) {
    breakdowns = breakdowns.filter((b) => !isAllCohortsBreakdown(b.name));
  }
  const hasAllCohortsBreakdown =
    requestedAllCohortsBreakdown && allCohorts.length > 0;

  const cohortIds = collectBreakdownCohortIds(breakdowns);
  const cohortMetadata = await fetchCohortsMetadata(cohortIds);

  // Event Analytics sends its AND/OR filter group; every other caller sends
  // the flat array only, which keeps its SQL byte-identical. With a group,
  // `profile.*` conditions compile to their own subselect (see
  // compileEventAnalyticsFilter), so they must NOT reach the profile join or
  // its key narrowing below.
  //
  // ponytail: rewriteProfilePropertyRefs rewrites every `profile.properties['k']`
  // in the finished SQL, subselects included. A group condition on a profile
  // key that a breakdown or metric ALSO reads would be rewritten to the CTE's
  // scalar alias inside the subselect and fail loudly (ClickHouse code 48).
  // The Event Analytics chart never breaks down or measures by a profile
  // property; protect the group clause from the rewrite if a caller ever does.
  const filterGroup = event.filterGroup;
  const scopeFilters = filterGroup
    ? flattenConditions(filterGroup).filter(
        (filter) => !filter.name.startsWith('profile.'),
      )
    : event.filters;

  const profileProps = collectProfilePropertyKeys([
    ...scopeFilters,
    ...breakdowns,
    // Math metrics (property_sum/avg/min/max) reference event.property too —
    // missing it here would strip the Map the metric still reads from.
    ...(event.property ? [{ name: event.property }] : []),
  ]);

  // Add CTE + JOIN for "all cohorts" breakdown
  if (hasAllCohortsBreakdown) {
    addCte('_all_cohorts', buildAllCohortsMembershipQuery(projectId));
    sb.joins._all_cohorts =
      'INNER JOIN _all_cohorts ON _all_cohorts.profile_id = e.profile_id';
  }

  // Add individual cohort CTEs (for single-cohort filters)
  for (const cohortId of cohortIds) {
    addCte(
      getCohortCteName(cohortId),
      buildCohortMembershipQuery(cohortId, projectId),
    );
    sb.joins[`cohort_${cohortId}`] =
      `LEFT ANY JOIN ${getCohortCteName(cohortId)} AS ${getCohortAlias(cohortId)} ON ${getCohortAlias(cohortId)}.profile_id = e.profile_id`;
  }

  sb.where = filterGroup
    ? getFilterGroupWhere(filterGroup, (filter) =>
        compileEventAnalyticsFilter(filter, projectId, 'e'),
      )
    : getEventFiltersWhereClause(event.filters, projectId, 'e');
  sb.where.projectId = `project_id = ${sqlstring.escape(projectId)}`;

  if (event.name !== '*') {
    sb.select.label_0 = `${sqlstring.escape(event.name)} as label_0`;
    sb.where.eventName = `e.name = ${sqlstring.escape(event.name)}`;
  } else {
    sb.select.label_0 = `'*' as label_0`;
  }

  const anyFilterOnProfile = scopeFilters.some((filter) =>
    filter.name.startsWith('profile.')
  );
  const anyBreakdownOnProfile = breakdowns.some((breakdown) =>
    breakdown.name.startsWith('profile.')
  );
  // Math metrics (property_sum/avg/min/max) can target a profile property
  // too — the join must exist for the metric alone, not only for filters
  // and breakdowns.
  const anyMetricOnProfile = !!event.property?.startsWith('profile.');
  const anyFilterOnGroup = scopeFilters.some((filter) =>
    filter.name.startsWith('group.')
  );
  const anyBreakdownOnGroup = breakdowns.some((breakdown) =>
    breakdown.name.startsWith('group.')
  );
  const anyMetricOnGroup = !!event.property?.startsWith('group.');
  const needsGroupArrayJoin =
    anyFilterOnGroup ||
    anyBreakdownOnGroup ||
    anyMetricOnGroup ||
    event.segment === 'group';

  if (needsGroupArrayJoin) {
    addCte(
      '_g',
      `SELECT id, name, type, properties FROM ${TABLE_NAMES.groups} FINAL WHERE project_id = ${sqlstring.escape(projectId)}`
    );
    sb.joins.groups = 'ARRAY JOIN groups AS _group_id';
    sb.joins.groups_table = 'LEFT ANY JOIN _g ON _g.id = _group_id';
  }

  // Collect all profile fields used in filters and breakdowns
  const getProfileFields = () => {
    const fields = new Set<string>();

    // Always need id for the join
    fields.add('id');

    // Collect from filters
    scopeFilters
      .filter((f) => f.name.startsWith('profile.'))
      .forEach((f) => {
        const fieldName = f.name.replace('profile.', '').split('.')[0];
        if (fieldName && fieldName === 'properties') {
          fields.add('properties');
        } else if (
          fieldName &&
          [
            'email',
            'first_name',
            'last_name',
            'created_at',
            'last_seen_at',
          ].includes(fieldName)
        ) {
          fields.add(fieldName);
        }
      });

    // Collect from breakdowns
    breakdowns
      .filter((b) => b.name.startsWith('profile.'))
      .forEach((b) => {
        const fieldName = b.name.replace('profile.', '').split('.')[0];
        if (fieldName && fieldName === 'properties') {
          fields.add('properties');
        } else if (
          fieldName &&
          [
            'email',
            'first_name',
            'last_name',
            'created_at',
            'last_seen_at',
          ].includes(fieldName)
        ) {
          fields.add(fieldName);
        }
      });

    // Collect from the math metric
    if (event.property?.startsWith('profile.')) {
      const fieldName = event.property.replace('profile.', '').split('.')[0];
      if (fieldName && fieldName === 'properties') {
        fields.add('properties');
      } else if (
        fieldName &&
        [
          'email',
          'first_name',
          'last_name',
          'created_at',
          'last_seen_at',
        ].includes(fieldName)
      ) {
        fields.add(fieldName);
      }
    }

    return Array.from(fields);
  };

  // Create profiles CTE if profiles are needed
  const profilesJoinRef =
    anyFilterOnProfile || anyBreakdownOnProfile || anyMetricOnProfile
      ? 'LEFT ANY JOIN profile ON profile.id = profile_id'
      : '';

  if (anyFilterOnProfile || anyBreakdownOnProfile || anyMetricOnProfile) {
    const profileFields = getProfileFields();
    const selectFields = profileFields.map((field) => {
      if (field === 'id') {
        return 'id as "profile.id"';
      }
      if (field === 'properties') {
        return profilePropertiesCteSelect(
          profileProps.keys,
          profileProps.needsFullMap,
        );
      }
      if (field === 'email') {
        return 'email as "profile.email"';
      }
      if (field === 'first_name') {
        return 'first_name as "profile.first_name"';
      }
      if (field === 'last_name') {
        return 'last_name as "profile.last_name"';
      }
      if (field === 'created_at') {
        return 'created_at as "profile.created_at"';
      }
      if (field === 'last_seen_at') {
        return 'last_seen_at as "profile.last_seen_at"';
      }
      return field;
    });

    addCte(
      'profile',
      `SELECT ${selectFields.join(', ')}
      FROM ${TABLE_NAMES.profiles} FINAL
      WHERE project_id = ${sqlstring.escape(projectId)}`
    );

    sb.joins.profiles = profilesJoinRef;
  }

  // Date range filters
  if (startDate) {
    sb.where.startDate = `created_at >= toDateTime('${formatClickhouseDate(startDate)}')`;
  }

  if (endDate) {
    sb.where.endDate = `created_at <= toDateTime('${formatClickhouseDate(endDate)}')`;
  }

  // Add a constant date field for aggregate charts (groupByLabels expects it)
  // Use startDate as the date value since we're aggregating across the entire range
  // Invariant: one bucket per serie. Totals of non-additive metrics (epu, averages) are only correct because of it; pinned by event-analytics-aggregate-bucket.test.ts.
  sb.select.date = `${sqlstring.escape(startDate)} as date`;

  // Add breakdowns to SELECT and GROUP BY
  breakdowns.forEach((breakdown, index) => {
    // Breakdowns start at label_1 (label_0 is reserved for event name)
    const key = `label_${index + 1}`;

    if (isAllCohortsBreakdown(breakdown.name)) {
      sb.select[key] = `${buildAllCohortsLabelExpr(allCohorts)} as ${key}`;
    } else {
      const breakdownCohortId = extractCohortId(breakdown.name);
      const breakdownCohortName = breakdownCohortId
        ? cohortMetadata.get(breakdownCohortId)?.name
        : undefined;
      sb.select[key] =
        `${getSelectPropertyKey(breakdown.name, projectId, breakdownCohortId ?? undefined, breakdownCohortName, 'e')} as ${key}`;
    }
    sb.groupBy[key] = `${key}`;
  });

  // Always group by label_0 (event name) for aggregate charts
  sb.groupBy.label_0 = 'label_0';

  // Default count aggregation
  sb.select.count = 'count(*) as count';

  // Handle different segments
  if (event.segment === 'user') {
    sb.select.count = 'countDistinct(profile_id) as count';
  }

  if (event.segment === 'session') {
    sb.select.count = 'countDistinct(session_id) as count';
  }

  if (event.segment === 'group') {
    sb.select.count = 'countDistinct(_group_id) as count';
  }

  if (event.segment === 'user_average') {
    sb.select.count =
      'COUNT(*)::float / COUNT(DISTINCT profile_id)::float as count';
  }

  const mathFunction = {
    property_sum: 'sum',
    property_average: 'avg',
    property_max: 'max',
    property_min: 'min',
  }[event.segment as string];

  if (mathFunction && event.property) {
    const propertyKey = getSelectPropertyKey(
      event.property,
      projectId,
      undefined,
      undefined,
      'e',
    );

    if (isNumericColumn(event.property)) {
      sb.select.count = `${mathFunction}(${propertyKey}) as count`;
      sb.where.property = `${propertyKey} IS NOT NULL`;
    } else {
      sb.select.count = `${mathFunction}(toFloat64OrNull(${propertyKey})) as count`;
      sb.where.property = `${propertyKey} IS NOT NULL AND notEmpty(${propertyKey})`;
    }
  }

  const eventAnalyticsExpression = eventAnalyticsSegmentExpression(event, 'e');
  if (eventAnalyticsExpression) {
    sb.select.count = `${eventAnalyticsExpression} as count`;
  }

  if (event.segment === 'one_event_per_user') {
    sb.from = `(
      SELECT DISTINCT ON (profile_id) * from ${TABLE_NAMES.events} e ${getJoins()} WHERE ${join(
        sb.where,
        ' AND '
      )}
        ORDER BY profile_id, created_at DESC
      ) as subQuery`;
    sb.joins = {};

    const sql = rewriteProfilePropertyRefs(getSql(), profileProps.keys);
    console.log('-- Aggregate Chart --');
    console.log(sql.replaceAll(/[\n\r]/g, ' '));
    console.log('-- End --');
    return sql;
  }

  // Order by count DESC (biggest first) for aggregate charts
  sb.orderBy.count = 'count DESC';

  // Apply limit if specified
  if (limit) {
    sb.limit = limit;
  }

  const sql = rewriteProfilePropertyRefs(getSql(), profileProps.keys);
  console.log('-- Aggregate Chart --');
  console.log(sql.replaceAll(/[\n\r]/g, ' '));
  console.log('-- End --');
  return sql;
}

/**
 * The count expression of an Event Analytics parameter segment, or null for
 * any other segment. Mirrors `eventAnalyticsMetricExpression` in
 * overview.service.ts (spec 2026-09-16 §5): a missing or non-numeric value is
 * 0 (§3 D4), so there is no WHERE on the property and `avg` is spelled out as
 * `sum / count()`. `coalesce(toFloat64OrNull(...), 0)`, never
 * `toFloat64OrZero`, so the zero reads as a decision.
 */
function eventAnalyticsSegmentExpression(
  event: IGetChartDataInput['event'],
  eventsAlias: string,
): string | null {
  if (!event.property) {
    return null;
  }
  const key = getSelectPropertyKey(
    event.property,
    undefined,
    undefined,
    undefined,
    eventsAlias,
  );
  const value = `coalesce(toFloat64OrNull(${key}), 0)`;
  switch (event.segment) {
    case 'property_sum_missing_zero':
      return `sum(${value})`;
    case 'property_average_missing_zero':
      return `sum(${value}) / count()`;
    case 'property_median_missing_zero':
      return `quantileExact(0.5)(${value})`;
    case 'property_unique_missing_zero':
      return `uniqExact(${value})`;
    case 'property_sum_per_user_missing_zero':
      return `sum(${value}) / uniqExact(profile_id)`;
    case 'property_unique_per_user_missing_zero':
      return `uniqExact(${value}) / uniqExact(profile_id)`;
    default:
      return null;
  }
}

function isNumericColumn(columnName: string): boolean {
  const numericColumns = ['duration', 'revenue', 'longitude', 'latitude'];
  return numericColumns.includes(columnName);
}

// Matches the events `properties` map access that getSelectPropertyKey emits:
// `properties['key']`, optionally qualified with a table alias. Deliberately
// excludes `profile.properties['key']` — rewriteProfilePropertyRefs narrows
// those refs to scalar CTE columns and drops the full map, so a
// `mapContains(profile.properties, ...)` term would survive the rewrite
// untouched and reference a column the CTE no longer selects.
const EVENTS_PROPERTY_MAP_ACCESS = /^(?:([A-Za-z_]\w*)\.)?(properties)\[(.+)\]$/;

/**
 * The map an absence guard would test, or null when `whereFrom` is not an
 * events-map access (a wildcard array, a scalar column, a profile CTE ref).
 */
function getPropertyMapAccess(
  whereFrom: string,
): { map: string; key: string } | null {
  const match = EVENTS_PROPERTY_MAP_ACCESS.exec(whereFrom);
  if (!match) {
    return null;
  }
  const [, alias, map, key] = match;
  if (alias === 'profile') {
    return null;
  }
  return { map: alias ? `${alias}.${map}` : map!, key: key! };
}

/**
 * Numeric comparison (`gt`/`lt`/`gte`/`lte`) on an untyped property.
 *
 * Uses `toFloat64OrNull`, never `toFloat64OrZero`: a missing map key reads as
 * the empty string and a non-numeric value cannot be parsed, and coercing
 * either to 0 made them satisfy comparisons like `< 1` or `> -1` (spec §5.2).
 * `toFloat64OrNull` yields NULL for both, and every comparison with NULL is
 * NULL, which WHERE treats as no match.
 */
function buildNumericComparison(
  whereFrom: string,
  sqlOperator: '>' | '<' | '>=' | '<=',
  value: (string | number | boolean | null)[],
  isWildcard: boolean,
): string {
  const compare = (operand: string, val: string | number | boolean | null) =>
    `toFloat64OrNull(${operand}) ${sqlOperator} toFloat64(${sqlstring.escape(String(val).trim())})`;

  if (isWildcard) {
    // An absent wildcard match yields an empty array, and arrayExists over an
    // empty array is already false — no absence guard needed.
    return `arrayExists(x -> ${value
      .map((val) => compare('x', val))
      .join(' OR ')}, ${whereFrom})`;
  }

  const clause = `(${value.map((val) => compare(whereFrom, val)).join(' OR ')})`;
  const mapAccess = getPropertyMapAccess(whereFrom);
  return mapAccess
    ? `(mapContains(${mapAccess.map}, ${mapAccess.key}) AND ${clause})`
    : clause;
}

/**
 * Compile ONE filter into a WHERE-clause fragment, or null when it contributes
 * nothing (empty value list, unknown cohort, unsupported name for the table).
 *
 * Lifted verbatim out of `getEventFiltersWhereClause` so the AND/OR group
 * walker can reuse exactly the same per-filter SQL. Behaviour is unchanged:
 * fragments are NOT parenthesised here, because the flat caller joins them with
 * AND, where grouping cannot change the meaning. The group walker adds its own
 * parentheses.
 */
export function compileEventFilter(
  filter: IChartEventFilter,
  projectId?: string,
  eventsAlias?: string,
  tableScope: 'events' | 'sessions' = 'events',
): string | null {
  let clause: string | null = null;
    const { value, operator } = filter;
    // Normalize camelCase aliases (`referrerName` → `referrer_name`) on both
    // tables — both events and sessions schemas use snake_case. The bare-
    // utm rewrite only applies to events because sessions stores utm_* as
    // real top-level columns; doing it for sessions would emit
    // `properties['__query.utm_source']` against a table that has no
    // `properties` column.
    const name =
      tableScope === 'sessions'
        ? EVENT_FIELD_ALIASES[filter.name] ?? filter.name
        : normalizeEventField(filter.name);

    if (operator === 'advancedFilterGroup') {
      throw new Error(
        'advancedFilterGroup is a storage sentinel and must never reach SQL compilation',
      );
    }

    // Presence checks run before the empty-value guard below: they legitimately
    // carry no values, like isNull / isNotNull.
    if (operator === 'hasProperty' || operator === 'missingProperty') {
      if (!name) return clause;

      const has = operator === 'hasProperty';
      const expr = getSelectPropertyKey(
        name,
        projectId,
        undefined,
        undefined,
        eventsAlias,
      );

      if (name.includes('*')) {
        clause = has
          ? `arrayExists(x -> x != '', ${expr})`
          : `NOT arrayExists(x -> x != '', ${expr})`;
        return clause;
      }

      // Map-backed keys render as `map['key']`, and that is the ONLY form safe
      // for profile.properties.*: the profile CTE narrows those keys to scalar
      // columns and drops the Map entirely, so mapContains(profile.properties,
      // ...) would survive rewriteProfilePropertyRefs untouched and reference a
      // column that no longer exists. An absent key reads as '', so the lookup
      // answers presence on its own. See the advanced filters spec §5.4.
      clause = expr.includes('[')
        ? has
          ? `${expr} != ''`
          : `${expr} = ''`
        : has
          ? `(${expr} IS NOT NULL AND ${expr} != '')`
          : `(${expr} IS NULL OR ${expr} = '')`;
      return clause;
    }

    if (
      (operator === 'inCohort' || operator === 'notInCohort') &&
      projectId
    ) {
      // Self-contained membership subselect — no caller JOIN wiring needed.
      // Cohort filters and cohort breakdowns are decoupled: the breakdown
      // path (getSelectPropertyKey) still uses a JOIN alias for SELECT
      // expressions, but filters never depend on it.
      const cohortIds = getCohortIds(filter);
      if (cohortIds.length === 0) return clause;
      const profileIdExpr = eventsAlias
        ? `${eventsAlias}.profile_id`
        : 'profile_id';
      const op = operator === 'notInCohort' ? 'NOT IN' : 'IN';
      const escapedIds = cohortIds
        .map((c) => sqlstring.escape(c))
        .join(', ');
      clause = `${profileIdExpr} ${op} (SELECT profile_id FROM ${TABLE_NAMES.cohort_members} FINAL WHERE cohort_id IN (${escapedIds}) AND project_id = ${sqlstring.escape(projectId)})`;
      return clause;
    }

    if (
      value.length === 0 &&
      operator !== 'isNull' &&
      operator !== 'isNotNull'
    ) {
      return clause;
    }

    if (name === 'has_profile') {
      if (value.includes('true')) {
        clause = 'profile_id != device_id';
      } else {
        clause = 'profile_id = device_id';
      }
      return clause;
    }

    // Handle group. prefixed filters (requires ARRAY JOIN + _g JOIN in query)
    if (name.startsWith('group.') && projectId) {
      const whereFrom = getGroupPropertySql(name);
      if (hasTypedCast(filter.type) && isTypedOperator(operator)) {
        clause = buildTypedClause(whereFrom, operator, value, filter.type);
        return clause;
      }
      switch (operator) {
        case 'is': {
          if (value.length === 1) {
            clause =
              `${whereFrom} = ${sqlstring.escape(String(value[0]).trim())}`;
          } else {
            clause =
              `${whereFrom} IN (${value.map((val) => sqlstring.escape(String(val).trim())).join(', ')})`;
          }
          break;
        }
        case 'isNot': {
          if (value.length === 1) {
            clause =
              `${whereFrom} != ${sqlstring.escape(String(value[0]).trim())}`;
          } else {
            clause =
              `${whereFrom} NOT IN (${value.map((val) => sqlstring.escape(String(val).trim())).join(', ')})`;
          }
          break;
        }
        case 'contains': {
          clause =
            `(${value.map((val) => `${whereFrom} LIKE ${sqlstring.escape(`%${String(val).trim()}%`)}`).join(' OR ')})`;
          break;
        }
        case 'doesNotContain': {
          clause =
            `(${value.map((val) => `${whereFrom} NOT LIKE ${sqlstring.escape(`%${String(val).trim()}%`)}`).join(' OR ')})`;
          break;
        }
        case 'startsWith': {
          clause =
            `(${value.map((val) => `${whereFrom} LIKE ${sqlstring.escape(`${String(val).trim()}%`)}`).join(' OR ')})`;
          break;
        }
        case 'endsWith': {
          clause =
            `(${value.map((val) => `${whereFrom} LIKE ${sqlstring.escape(`%${String(val).trim()}`)}`).join(' OR ')})`;
          break;
        }
        case 'isNull': {
          clause = `(${whereFrom} = '' OR ${whereFrom} IS NULL)`;
          break;
        }
        case 'isNotNull': {
          clause = `(${whereFrom} != '' AND ${whereFrom} IS NOT NULL)`;
          break;
        }
        case 'regex': {
          clause =
            `(${value.map((val) => `match(${whereFrom}, ${sqlstring.escape(String(val).trim())})`).join(' OR ')})`;
          break;
        }
      }
      return clause;
    }

    if (
      name.startsWith('properties.') ||
      name.startsWith('profile.properties.')
    ) {
      const propertyKey = getSelectPropertyKey(
        name,
        undefined,
        undefined,
        undefined,
        eventsAlias,
      );
      const isWildcard = propertyKey.includes('%');
      const whereFrom = propertyKey;

      // Typed cast (number/date/datetime/boolean) short-circuit. Casts both the
      // column and each value so e.g. `>= '2019-01-01'` compares as dates
      // instead of crashing `toFloat64('2019-01-01')`. Untyped/string filters
      // fall through to the legacy switch below.
      if (hasTypedCast(filter.type) && isTypedOperator(operator)) {
        clause = isWildcard
          ? `arrayExists(x -> ${buildTypedClause('x', operator, value, filter.type)}, ${whereFrom})`
          : buildTypedClause(whereFrom, operator, value, filter.type);
        return clause;
      }

      switch (operator) {
        case 'is': {
          if (isWildcard) {
            clause = `arrayExists(x -> ${value
              .map((val) => `x = ${sqlstring.escape(String(val).trim())}`)
              .join(' OR ')}, ${whereFrom})`;
          } else if (value.length === 1) {
            clause =
              `${whereFrom} = ${sqlstring.escape(String(value[0]).trim())}`;
          } else {
            clause = `${whereFrom} IN (${value
              .map((val) => sqlstring.escape(String(val).trim()))
              .join(', ')})`;
          }
          break;
        }
        case 'isNot': {
          if (isWildcard) {
            clause = `arrayExists(x -> ${value
              .map((val) => `x != ${sqlstring.escape(String(val).trim())}`)
              .join(' OR ')}, ${whereFrom})`;
          } else if (value.length === 1) {
            clause =
              `${whereFrom} != ${sqlstring.escape(String(value[0]).trim())}`;
          } else {
            clause = `${whereFrom} NOT IN (${value
              .map((val) => sqlstring.escape(String(val).trim()))
              .join(', ')})`;
          }
          break;
        }
        case 'contains': {
          if (isWildcard) {
            clause = `arrayExists(x -> ${value
              .map(
                (val) => `x LIKE ${sqlstring.escape(`%${String(val).trim()}%`)}`
              )
              .join(' OR ')}, ${whereFrom})`;
          } else {
            clause = `(${value
              .map(
                (val) =>
                  `${whereFrom} LIKE ${sqlstring.escape(`%${String(val).trim()}%`)}`
              )
              .join(' OR ')})`;
          }
          break;
        }
        case 'doesNotContain': {
          if (isWildcard) {
            clause = `arrayExists(x -> ${value
              .map(
                (val) =>
                  `x NOT LIKE ${sqlstring.escape(`%${String(val).trim()}%`)}`
              )
              .join(' OR ')}, ${whereFrom})`;
          } else {
            clause = `(${value
              .map(
                (val) =>
                  `${whereFrom} NOT LIKE ${sqlstring.escape(`%${String(val).trim()}%`)}`
              )
              .join(' OR ')})`;
          }
          break;
        }
        case 'startsWith': {
          if (isWildcard) {
            clause = `arrayExists(x -> ${value
              .map(
                (val) => `x LIKE ${sqlstring.escape(`${String(val).trim()}%`)}`
              )
              .join(' OR ')}, ${whereFrom})`;
          } else {
            clause = `(${value
              .map(
                (val) =>
                  `${whereFrom} LIKE ${sqlstring.escape(`${String(val).trim()}%`)}`
              )
              .join(' OR ')})`;
          }
          break;
        }
        case 'endsWith': {
          if (isWildcard) {
            clause = `arrayExists(x -> ${value
              .map(
                (val) => `x LIKE ${sqlstring.escape(`%${String(val).trim()}`)}`
              )
              .join(' OR ')}, ${whereFrom})`;
          } else {
            clause = `(${value
              .map(
                (val) =>
                  `${whereFrom} LIKE ${sqlstring.escape(`%${String(val).trim()}`)}`
              )
              .join(' OR ')})`;
          }
          break;
        }
        case 'regex': {
          if (isWildcard) {
            clause = `arrayExists(x -> ${value
              .map((val) => `match(x, ${sqlstring.escape(String(val).trim())})`)
              .join(' OR ')}, ${whereFrom})`;
          } else {
            clause = `(${value
              .map(
                (val) =>
                  `match(${whereFrom}, ${sqlstring.escape(String(val).trim())})`
              )
              .join(' OR ')})`;
          }
          break;
        }
        case 'isNull': {
          if (isWildcard) {
            clause = `arrayExists(x -> x = '' OR x IS NULL, ${whereFrom})`;
          } else {
            clause = `(${whereFrom} = '' OR ${whereFrom} IS NULL)`;
          }
          break;
        }
        case 'isNotNull': {
          if (isWildcard) {
            clause =
              `arrayExists(x -> x != '' AND x IS NOT NULL, ${whereFrom})`;
          } else {
            clause = `(${whereFrom} != '' AND ${whereFrom} IS NOT NULL)`;
          }
          break;
        }
        case 'gt': {
          clause = buildNumericComparison(
            whereFrom,
            '>',
            value,
            isWildcard,
          );
          break;
        }
        case 'lt': {
          clause = buildNumericComparison(
            whereFrom,
            '<',
            value,
            isWildcard,
          );
          break;
        }
        case 'gte': {
          clause = buildNumericComparison(
            whereFrom,
            '>=',
            value,
            isWildcard,
          );
          break;
        }
        case 'lte': {
          clause = buildNumericComparison(
            whereFrom,
            '<=',
            value,
            isWildcard,
          );
          break;
        }
      }
    } else {
      // Bare-column branch. For events queries: enforce that `name` is one
      // of the known top-level columns (anything else would crash parse with
      // UNKNOWN_IDENTIFIER). For sessions queries: skip the guard because
      // the sessions table has its own column set (utm_*, entry_path, etc.)
      // that OverviewService.getRawWhereClause already vets via its
      // WHITELISTED_FILTERS pre-pass.
      if (tableScope === 'events' && !EVENT_TOP_LEVEL_COLUMNS.has(name)) {
        return clause;
      }
      // Typed cast short-circuit (see property branch above). Supersedes the
      // `isNumericColumn` auto-detect when the user declared an explicit type.
      if (hasTypedCast(filter.type) && isTypedOperator(operator)) {
        clause = buildTypedClause(name, operator, value, filter.type);
        return clause;
      }
      switch (operator) {
        case 'is': {
          if (value.length === 1) {
            clause =
              `${name} = ${sqlstring.escape(String(value[0]).trim())}`;
          } else {
            clause = `${name} IN (${value
              .map((val) => sqlstring.escape(String(val).trim()))
              .join(', ')})`;
          }
          break;
        }
        case 'isNull': {
          clause = `(${name} = '' OR ${name} IS NULL)`;
          break;
        }
        case 'isNotNull': {
          clause = `(${name} != '' AND ${name} IS NOT NULL)`;
          break;
        }
        case 'isNot': {
          if (value.length === 1) {
            clause =
              `${name} != ${sqlstring.escape(String(value[0]).trim())}`;
          } else {
            clause = `${name} NOT IN (${value
              .map((val) => sqlstring.escape(String(val).trim()))
              .join(', ')})`;
          }
          break;
        }
        case 'contains': {
          clause = `(${value
            .map(
              (val) =>
                `${name} LIKE ${sqlstring.escape(`%${String(val).trim()}%`)}`
            )
            .join(' OR ')})`;
          break;
        }
        case 'doesNotContain': {
          clause = `(${value
            .map(
              (val) =>
                `${name} NOT LIKE ${sqlstring.escape(`%${String(val).trim()}%`)}`
            )
            .join(' OR ')})`;
          break;
        }
        case 'startsWith': {
          clause = `(${value
            .map(
              (val) =>
                `${name} LIKE ${sqlstring.escape(`${String(val).trim()}%`)}`
            )
            .join(' OR ')})`;
          break;
        }
        case 'endsWith': {
          clause = `(${value
            .map(
              (val) =>
                `${name} LIKE ${sqlstring.escape(`%${String(val).trim()}`)}`
            )
            .join(' OR ')})`;
          break;
        }
        case 'regex': {
          clause = `(${value
            .map(
              (val) =>
                `match(${name}, ${sqlstring.escape(stripLeadingAndTrailingSlashes(String(val)).trim())})`
            )
            .join(' OR ')})`;
          break;
        }
        case 'gt': {
          if (isNumericColumn(name)) {
            clause = `(${value
              .map(
                (val) =>
                  `toFloat64(${name}) > toFloat64(${sqlstring.escape(String(val).trim())})`
              )
              .join(' OR ')})`;
          } else {
            clause = `(${value
              .map((val) => `${name} > ${sqlstring.escape(String(val).trim())}`)
              .join(' OR ')})`;
          }
          break;
        }
        case 'lt': {
          if (isNumericColumn(name)) {
            clause = `(${value
              .map(
                (val) =>
                  `toFloat64(${name}) < toFloat64(${sqlstring.escape(String(val).trim())})`
              )
              .join(' OR ')})`;
          } else {
            clause = `(${value
              .map((val) => `${name} < ${sqlstring.escape(String(val).trim())}`)
              .join(' OR ')})`;
          }
          break;
        }
        case 'gte': {
          if (isNumericColumn(name)) {
            clause = `(${value
              .map(
                (val) =>
                  `toFloat64(${name}) >= toFloat64(${sqlstring.escape(String(val).trim())})`
              )
              .join(' OR ')})`;
          } else {
            clause = `(${value
              .map(
                (val) => `${name} >= ${sqlstring.escape(String(val).trim())}`
              )
              .join(' OR ')})`;
          }
          break;
        }
        case 'lte': {
          if (isNumericColumn(name)) {
            clause = `(${value
              .map(
                (val) =>
                  `toFloat64(${name}) <= toFloat64(${sqlstring.escape(String(val).trim())})`
              )
              .join(' OR ')})`;
          } else {
            clause = `(${value
              .map(
                (val) => `${name} <= ${sqlstring.escape(String(val).trim())}`
              )
              .join(' OR ')})`;
          }
          break;
        }
      }
    }

  return clause;
}

// Columns that exist on the sessions table but not on events — on events
// they're stored inside the properties map under __query.utm_*.
export const UTM_COLUMNS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
];

/** Columns of the profiles table a `profile.<column>` filter may name. */
const EVENT_ANALYTICS_PROFILE_COLUMNS = new Set([
  'id',
  'first_name',
  'last_name',
  'email',
  'avatar',
  'created_at',
  'last_seen_at',
]);

/**
 * One Event Analytics filter condition, compiled the way BOTH the Event
 * Analytics table and its chart apply it. Shared so the two can never disagree
 * about which events a filter keeps.
 *
 * `profile.*` conditions become a self-contained subselect over the profiles
 * table rather than a reference through the chart's `profile` join (Phase 2
 * spec §3 D1). The two are not equivalent: through a LEFT ANY JOIN an event
 * whose profile has no row reads every profile column as '', so it satisfies
 * `missingProperty` or `isNot`, while the subselect excludes it. Presence stays
 * `properties['k'] != ''`, never mapContains.
 *
 * `eventsAlias` qualifies the events table's own columns; the chart aliases
 * events as `e` because other joined tables also carry a `properties` column.
 */
export function compileEventAnalyticsFilter(
  item: IChartEventFilter,
  projectId: string | undefined,
  eventsAlias?: string,
): string | null {
  if (item.name.startsWith('profile.')) {
    if (!projectId) {
      return null;
    }
    const field = item.name.slice('profile.'.length);
    const isProperty = field.startsWith('properties.');
    if (!(isProperty || EVENT_ANALYTICS_PROFILE_COLUMNS.has(field))) {
      return null;
    }
    // Profile columns are not events columns, so the events scope would
    // drop them; the sessions scope skips that check and changes nothing
    // else for a `profile.*` name. Both resolve against the alias below.
    const clause = compileEventFilter(
      item,
      projectId,
      undefined,
      isProperty ? 'events' : 'sessions',
    );
    return clause
      ? `profile_id IN (SELECT id FROM ${TABLE_NAMES.profiles} AS profile FINAL WHERE project_id = ${sqlstring.escape(projectId)} AND ${clause})`
      : null;
  }

  // The events table has no top-level utm_* columns — those live in the
  // properties map under the __query.utm_* keys.
  const resolved = UTM_COLUMNS.includes(item.name)
    ? { ...item, name: `properties.__query.${item.name}` }
    : item;

  return compileEventFilter(resolved, projectId, eventsAlias, 'events');
}

export function getEventFiltersWhereClause(
  filters: IChartEventFilter[],
  projectId?: string,
  /**
   * See `getSelectPropertyKey`. When the surrounding query joins another
   * table that has a `properties` column (e.g. the `_g` groups join), the
   * events table must be aliased and passed here so we can emit
   * `e.properties[...]` instead of the ambiguous `properties[...]`.
   */
  eventsAlias?: string,
  /**
   * Which physical table the WHERE clause is being built for. Affects which
   * names count as "top-level columns" and whether bare `utm_*` gets routed
   * into the events-specific `properties.__query.utm_*` map. Defaults to
   * 'events' because that's where the vast majority of callers (chart,
   * funnel, conversion, sankey, event services) target — OverviewService
   * sets it to 'sessions' when querying the sessions table.
   */
  tableScope: 'events' | 'sessions' = 'events',
) {
  const where: Record<string, string> = {};
  filters.forEach((filter, index) => {
    const clause = compileEventFilter(
      filter,
      projectId,
      eventsAlias,
      tableScope,
    );
    if (clause !== null) {
      where[`f${index}`] = clause;
    }
  });

  return where;
}
