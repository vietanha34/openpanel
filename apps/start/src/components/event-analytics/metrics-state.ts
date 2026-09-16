import {
  EVENT_ANALYTICS_MAX_METRICS,
  EVENT_ANALYTICS_METRICS,
  allowedSortKeys,
  metricKey,
} from '@openpanel/validation';
import type {
  IEventAnalyticsMetric,
  IEventAnalyticsMetricGroup,
  IEventAnalyticsMetricId,
  IEventAnalyticsSortDir,
} from '@openpanel/validation';

/**
 * Pure state of the Metrics dialog (design states 2a / 2b). Kept free of React
 * and of `@/` alias imports so it runs under the standalone vitest config.
 */

/** A parameter metric with no `param` yet is a pending chip (`Sum of …: —`). */
export type DraftMetric = IEventAnalyticsMetric;

export type MetricsDraft = {
  /** Column order. */
  metrics: DraftMetric[];
  /** The chip whose parameter dropdown is open. */
  editing: number | null;
};

export type MetricsSort = { key: string; dir: IEventAnalyticsSortDir };

const DEFAULT_SORT: MetricsSort = { key: 'events', dir: 'desc' };

const GROUP_TITLE: Record<IEventAnalyticsMetricGroup, string> = {
  events: 'Metrics by events',
  users: 'Metrics by users',
};

const PENDING_PARAM = '—';

export function createDraft(committed: IEventAnalyticsMetric[]): MetricsDraft {
  return { metrics: committed.map((metric) => ({ ...metric })), editing: null };
}

/**
 * The catalogue click. A parameter metric always appends a pending chip (the
 * same metric on two parameters is two columns, A5); a plain metric that is
 * already chosen is toggled off, since the catalogue shows it checked.
 */
export function addMetric(
  draft: MetricsDraft,
  id: IEventAnalyticsMetricId,
): MetricsDraft {
  const def = EVENT_ANALYTICS_METRICS[id];
  if (!def.param) {
    const index = draft.metrics.findIndex((metric) => metric.id === id);
    if (index !== -1) {
      return removeMetric(draft, index);
    }
  }
  if (draft.metrics.length >= EVENT_ANALYTICS_MAX_METRICS) {
    return draft;
  }
  const metrics = [...draft.metrics, { id }];
  return { metrics, editing: def.param ? metrics.length - 1 : draft.editing };
}

export function removeMetric(draft: MetricsDraft, index: number): MetricsDraft {
  const metric = draft.metrics[index];
  if (!metric || EVENT_ANALYTICS_METRICS[metric.id].locked) {
    return draft;
  }
  return {
    metrics: draft.metrics.filter((_, i) => i !== index),
    editing: null,
  };
}

export function moveMetric(
  draft: MetricsDraft,
  from: number,
  to: number,
): MetricsDraft {
  const { length } = draft.metrics;
  if (from === to || from < 0 || to < 0 || from >= length || to >= length) {
    return draft;
  }
  const metrics = [...draft.metrics];
  const [moved] = metrics.splice(from, 1);
  metrics.splice(to, 0, moved as DraftMetric);
  return { metrics, editing: null };
}

/** Clicking an existing parameter chip reopens its dropdown. */
export function openParam(draft: MetricsDraft, index: number): MetricsDraft {
  const metric = draft.metrics[index];
  if (!metric || !EVENT_ANALYTICS_METRICS[metric.id].param) {
    return draft;
  }
  return { ...draft, editing: index };
}

/** Leaves a pending chip in place; `canApply` keeps it from being committed. */
export function closeParam(draft: MetricsDraft): MetricsDraft {
  return { ...draft, editing: null };
}

export function setParam(
  draft: MetricsDraft,
  index: number,
  param: string,
): MetricsDraft {
  const metric = draft.metrics[index];
  if (!metric || !EVENT_ANALYTICS_METRICS[metric.id].param) {
    return draft;
  }
  return {
    metrics: draft.metrics.map((item, i) =>
      i === index ? { id: item.id, param } : item,
    ),
    editing: null,
  };
}

/**
 * A pending chip is never sent (A2), and the same metric on the same parameter
 * twice is a duplicate column the contract rejects.
 */
export function canApply(draft: MetricsDraft): boolean {
  const keys = new Set<string>();
  for (const metric of draft.metrics) {
    if (EVENT_ANALYTICS_METRICS[metric.id].param && !metric.param) {
      return false;
    }
    const key = metricKey(metric);
    if (keys.has(key)) {
      return false;
    }
    keys.add(key);
  }
  return true;
}

/**
 * What `Apply` commits. A sort naming a metric the draft no longer holds would
 * fail the stored-preferences check (`allowedSortKeys`), so it resets to the
 * default instead.
 */
export function applyDraft(
  draft: MetricsDraft,
  sort: MetricsSort,
): { metrics: IEventAnalyticsMetric[]; sort: MetricsSort } | null {
  if (!canApply(draft)) {
    return null;
  }
  const metrics = draft.metrics.map((metric) => ({ ...metric }));
  return {
    metrics,
    sort: allowedSortKeys(metrics).includes(sort.key) ? sort : DEFAULT_SORT,
  };
}

export function chipLabel(metric: DraftMetric): string {
  const def = EVENT_ANALYTICS_METRICS[metric.id];
  return def.param ? `${def.label}: ${metric.param ?? PENDING_PARAM}` : def.label;
}

export function counterLabel(count: number): string {
  return `${count} of ${EVENT_ANALYTICS_MAX_METRICS} metrics selected`;
}

export function toolbarLabel(metrics: DraftMetric[]): string {
  const [first] = metrics;
  if (!first) {
    return 'Metrics';
  }
  const rest = metrics.length > 1 ? `, +${metrics.length - 1}` : '';
  return `Metrics · ${EVENT_ANALYTICS_METRICS[first.id].label}${rest}`;
}

export type CatalogueItem = {
  id: IEventAnalyticsMetricId;
  label: string;
  help: string;
};

/** The catalogue panel's groups, filtered by label; empty groups are dropped. */
export function catalogueGroups(
  query: string,
): { group: IEventAnalyticsMetricGroup; title: string; items: CatalogueItem[] }[] {
  const needle = query.trim().toLowerCase();
  const groups = (Object.keys(GROUP_TITLE) as IEventAnalyticsMetricGroup[]).map(
    (group) => ({
      group,
      title: GROUP_TITLE[group],
      items: (
        Object.entries(EVENT_ANALYTICS_METRICS) as [
          IEventAnalyticsMetricId,
          (typeof EVENT_ANALYTICS_METRICS)[IEventAnalyticsMetricId],
        ][]
      )
        .filter(
          ([, def]) =>
            def.group === group && def.label.toLowerCase().includes(needle),
        )
        .map(([id, def]) => ({ id, label: def.label, help: def.help })),
    }),
  );
  return groups.filter((group) => group.items.length > 0);
}

const EVENT_PROPERTY_PREFIX = 'properties.';

/**
 * The parameter dropdown's options: every event property in the project (A6),
 * taken from the chart property list. Profile and built-in columns are dropped
 * because a parameter metric reads `properties['p']`, and array keys (`[*]`,
 * `.*.`) are dropped because they name no single map entry.
 */
export function parameterOptions(propertyNames: string[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  return propertyNames
    .filter((name) => name.startsWith(EVENT_PROPERTY_PREFIX))
    .map((name) => name.slice(EVENT_PROPERTY_PREFIX.length))
    .filter((key) => !key.includes('*') && key.toLowerCase().includes(needle));
}
