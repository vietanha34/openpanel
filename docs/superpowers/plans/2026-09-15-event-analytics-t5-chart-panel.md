# T5 — Event analytics chart panel

Spec: `docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md` §4 (binding).
Design: Claude Design project `233791a0-310f-443c-8118-b345c9f77b7d`, `EventAnalyticsScreen.dc.html`.
Covers R3, R4 and the chart part of R7.

## Scope

New file `apps/start/src/components/event-analytics/chart.tsx` plus one mount line in
`apps/start/src/routes/_app.$organizationId.$projectId.events._tabs.analytics.tsx` (T4 owns that route file).

## Contract with T4

Selection state lives in the route component and has the shape `{ path: string; color: string }[]`,
where `path` is the design's flatten path (`/event`, `/event/key`). Only depth <= 1 rows are selectable,
so the chart never sees a deeper path.

## Behaviour

- Metric tabs: Events, Users, Events per user. They map to the existing chart segments
  `event`, `user`, `user_average`.
- Granularity tabs: Hour, Day, Week -> existing `interval` option.
- Chart type toggle: line (`linear`) / bar (`bar`).
- Series: one per distinct event in the selection. A `/event/key` path adds `key` to `breakdowns`.
- `startDate` / `endDate` are passed to the report input next to `range` (R4). The existing
  `ReportChartShortcut` drops them, so the panel renders `ReportChart` directly.
- Empty selection renders "Select rows in the table to plot them".

## Steps

1. RED: `chart.test.ts` covers `buildEventAnalyticsChartInput`:
   custom dates survive, metric -> segment, granularity -> interval, chart type,
   distinct events, breakdown from `/event/key`, empty selection.
2. GREEN: implement `buildEventAnalyticsChartInput` + `EventAnalyticsChart` in `chart.tsx`.
3. Mount in the route file (one line) after rebasing on T4.
4. Verify: `NITRO=1 npx vitest run src/components/event-analytics/chart.test.ts` in `apps/start`
   (the root vitest workspace excludes `apps/start`, and the Cloudflare vite plugin breaks the
   runner unless `NITRO=1` selects the nitro plugin), plus `pnpm typecheck`.

## Known ceilings

- `ReportChart` assigns its own series colors; the selection color from T4 is used by the table
  swatches only. Passing explicit colors would mean changing shared chart components, which is
  outside this task.
- `breakdowns` are report-wide, not per-series, so selecting `/a/key1` and `/b/key2` breaks both
  events down by both keys. Matching the design exactly would need per-series breakdowns in the
  report contract.
