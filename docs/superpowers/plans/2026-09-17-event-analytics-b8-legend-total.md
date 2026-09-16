# B8 — Legend total for non-additive metrics

## Finding: no user-visible bug on the Event Analytics screen

`format.ts` sums a serie's buckets into `metrics.sum`, which is wrong for
non-additive metrics (`epu`, averages, medians, uniques, per-user ratios) once a
serie has several buckets. The Event Analytics chart never shows such a total:

- **Line mode:** the legend (`line/chart.tsx` `CustomLegend`) shows serie names
  only, and the tooltip shows each bucket's own value. `ReportTable` (Sum /
  Average columns) renders only in edit mode; the Event Analytics chart passes
  `options={}`, so `isEditMode` is false.
- **Bar mode:** `ReportBarChart` reads `chart.aggregate`, and
  `getAggregateChartSql` selects a constant `date` (the range start) with no
  interval grouping. Each serie is one whole-period bucket, so `metrics.sum` is
  the whole-period value and matches the table (`epu` 2, not 14).

Sums over several buckets are read only by the report builder (edit-mode table,
pie, metric card, map) with the pre-existing segments. Their behaviour stays as
it is: users already read those totals.

Decision (orchestrator): do not change `format.ts`. Pin the invariant the
conclusion rests on instead.

## Changes

1. `event-analytics-aggregate-bucket.test.ts`: a 7-day fixture (one user a day,
   2 events a day, the parameter on one of them). For `user_average` (epu) and
   `property_average_missing_zero` (avg_param), the aggregate returns exactly one
   bucket equal to the table value (2), while the day series sums to 14. The P8
   fixture sits on a single day, so it cannot show a multi-bucket sum.
   Checked red by temporarily grouping the aggregate query by day.
2. `chart.service.ts`: a comment-only change at `sb.select.date` in
   `getAggregateChartSql`, naming the invariant and the test. Separate commit,
   since B7 edits the same file.
