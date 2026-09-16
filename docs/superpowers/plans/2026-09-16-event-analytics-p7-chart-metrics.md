# P7 — Chart follows the chosen metrics

Spec: `docs/superpowers/specs/2026-09-16-event-analytics-phase2-design.md` §8 P7.

## Constraint found while reading

The chart plots through `ReportChart`, whose segments are fixed
(`packages/constants` `chartSegments`). Only some catalogue metrics have an
exact segment:

| metric | segment | exact? |
|---|---|---|
| `events` | `event` | yes |
| `users` | `user` | yes |
| `epu` | `user_average` (`COUNT(*) / COUNT(DISTINCT profile_id)`) | yes |
| `sum_param` | `property_sum` on `properties.<param>` | yes — a missing value adds nothing, which equals adding 0 |
| `avg_param` | `property_average` | **no** — `avg` skips events without the parameter, the opposite of §3 D4 |
| `uniq_param`, `median_param`, `epau`, `pctu`, `uniq_param_user`, `sum_param_user` | none | — |

P7 is scoped to `chart.tsx` / `chart-input.ts`, so no new chart segments.
Decision (reported as a spec gap): the select lists exactly the metrics in
`prefs.metrics`, with non-chartable ones shown disabled. `events` is locked in
the set and always chartable, so a valid choice always exists.

## Steps

1. Pure helpers in `chart-input.ts` (tested):
   - `chartSegmentFor(metric)` → `{ segment, property? } | null`.
   - `resolveChartMetric(metrics, storedKey)` → the stored metric when it is
     still in the set and chartable, else the first chartable metric.
   - `buildEventAnalyticsChartInput` takes an `IEventAnalyticsMetric`.
2. `chart.tsx`: props `metrics`, `metric` (stored key), `onMetricChange`;
   `Select` of the set with catalogue labels; plots the resolved metric.
3. Route: pass the three props (a few lines).
4. Verify: event-analytics vitest config, `pnpm -F start typecheck`.
