# P3 — Chart cold start and collapse (R1)

Spec: `docs/superpowers/specs/2026-09-16-event-analytics-phase2-design.md` §6 (relationship with R1), §7, §8 P3.
Design: `Event Analytics Metrics.dc.html` state `2d`; chart head and pill in `EventAnalyticsScreen.dc.html` lines 208-237.

## Scope

- `apps/start/src/components/event-analytics/chart-cold-start.ts` (new, pure) + `chart-cold-start.test.ts`
- `apps/start/src/components/event-analytics/chart.tsx`
- `apps/start/src/routes/_app.$organizationId.$projectId.events._tabs.analytics.tsx`

## Behaviour

- `coldStartSelection({ names, selectedCount, hasPersistedSelection })` returns the first
  `min(5, names.length)` event paths (`/name`, list order), or `null` when a selection exists,
  a persisted selection exists (even an empty one), or the list is empty.
- The route decides once per mount: while pending, it reads the first page of the event list with
  the table's default request (same query key, so React Query shares the table's fetch). As soon as
  the decision is made the query is disabled, so later filter changes neither refetch it nor
  re-select rows.
- Until P4's `useEventAnalyticsPrefs` lands, `hasPersistedSelection` is `false` and `collapsed` is
  route state. After P4 merges, rebase and wire both to the hook.
- Chart head gains a 32x30 icon button, `title="Hide chart"`, `minimize-2` icon.
- Collapsed: the whole chart card is replaced by a centred `Show chart` pill with a `move-diagonal`
  icon. `ReportChart` is not rendered, so its query does not run.

## Steps

1. Red: tests for `coldStartSelection`. Green: implement. Commit.
2. Chart collapse props + pill. Route wiring. `pnpm -F start typecheck`. Commit.
