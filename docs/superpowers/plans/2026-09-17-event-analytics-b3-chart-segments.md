# B3 — Chart segments for the Event Analytics parameter metrics

P7 plots 4 of the 11 catalogue metrics. This task adds chart segments for the
parameter metrics so they plot the same number as the table (§5 SQL, §3 D4:
missing = 0).

## Findings from the code

- A segment is one expression assigned to `sb.select.count` inside the single
  scan of `getChartSql` (time series) and `getAggregateChartSql` (aggregate
  endpoint). Ratios are allowed: `user_average` already divides two
  aggregates. No client-side division is needed.
- The existing `property_*` segments add `WHERE key IS NOT NULL AND
  notEmpty(key)`, so they only see events that carry the parameter. For
  `property_average` that is the non-D4 average. For `property_sum` the value
  is the same, but a breakdown group whose events never carry the parameter
  disappears instead of plotting 0, and `total_count` counts only carrying
  users. So `sum_param` also gets a D4 segment; `property_sum` is untouched.
- `chartSegments` (constants) feeds the report builder's segment dropdown.
  The new segments are D4-specific, so they live in a separate
  `eventAnalyticsChartSegments` map that only extends the validation enum —
  the report builder and the AI agent (hard-coded enum) do not offer them.
- `epau` / `pctu` need an app-wide per-bucket denominator. Only the formula
  series can express it, and it breaks down the denominator with the report's
  breakdowns. Reported to the orchestrator; out of this change unless
  approved.
- `format.ts` sums bucket values into `metrics.sum`; for non-additive metrics
  (including `epu`, charted since P7) a multi-bucket legend total does not
  equal the table. Pre-existing, not changed.

## Changes

1. `packages/constants`: `eventAnalyticsChartSegments` (6 segments,
   `property_*_missing_zero`). `packages/validation`: segment enum = both maps.
2. `chart.service.ts`: one helper builds the D4 expression over
   `coalesce(toFloat64OrNull(<key>), 0)`; both builders assign it when the
   segment is one of the six. No WHERE on the property. Existing branches
   untouched.
3. `chart-input.ts`: the five parameter metrics map to the new segments.

## Tests

- Snapshot of every existing segment's SQL from both builders, written before
  any code change (byte-identical pin).
- New segments: SQL per segment, EXPLAIN, and the chart expression equals
  `eventAnalyticsMetricExpression` (overview) up to the table alias.
- Real data on the P8 fixture through `ChartEngine.execute`: `level_start`,
  `payload.lives_left` → avg 2.25 (not 4.5), median 3, uniq 3, sum 18,
  sum/user 4.5, uniq/user 0.75.
- `chart.test.ts` (start): each un-disabled metric maps to its segment.
