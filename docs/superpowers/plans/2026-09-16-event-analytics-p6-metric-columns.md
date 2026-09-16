# Event Analytics P6 — table columns per metric

Spec: `docs/superpowers/specs/2026-09-16-event-analytics-phase2-design.md` §3 D2/D5, §4.4, §5 notes, §8 P6.

Files: `apps/start/src/components/event-analytics/{tree-utils.ts,tree-utils.test.ts,event-tree-table.tsx,tree-nodes.tsx}`,
the analytics route (wire `prefs.metrics` / `prefs.sort`). `chart.tsx` / `chart-input.ts` are P7's — not touched.

## Design 2c, extracted (EventAnalyticsScreen.dc.html)

- Column width: `colW = metrics.length > 4 ? '132px' : '158px'`, `flex: 0 0 colW`.
- Header cell: `padding: 6px 18px 6px 6px`, flex end, gap 5px, 11px / 500, letter-spacing .02em,
  label `text-align:right; line-height:1.3` (wraps), arrow span mono 10px, 8px wide.
  Colour `#0C162A` when sorted, `#798290` otherwise. Header row `min-height: 38px`, height auto.
- Header label: `mLabel(mt).toUpperCase()` = catalogue label, plus `: <param>` for parameter metrics.
- Header click: same key toggles desc -> asc, a new key starts at desc.
- Row cell: `padding-right: 18px`, right aligned, value mono 13px, sub mono 11px muted, 2px gap.
  - `events`, `users`: count, sub `x.xx %` of the totals when `%` is on.
  - `pctu`: `x.xx %`. `uniq_param`: count. `sum_param`: 2 decimals, sub `%` of the total when `%` is on.
  - Everything else (`epu`, `epau`, `avg_param`, `median_param`, `*_user`): `toFixed(2)`.
- Totals row cells: `events` -> `100.00 %`; `users` -> `unique · not a sum`; `epu` -> `average`;
  `pctu` -> `of tracked users`; parameter metrics -> `100.00 %` for `sum_param`, otherwise `average`.

## Steps (TDD, pure helpers in tree-utils.ts)

1. `metricColumnWidth(count)` (158 / 132) and `tableMinWidth(count)` (label track 228px + columns;
   today's 860px = 228 + 4 × 158).
2. `metricColumnLabel(metric)` — uppercase catalogue label (reuses `chipLabel`).
3. `metricCell(metric, row, totals, showPct)` — reads `row.metrics[metricKey]` for parameter metrics,
   `events` / `users` from their own fields, derives `epu` (row users), `pctu` and `epau`
   (`totals.users`, query-level denominator). Missing value -> `—`.
4. `totalsCell(metric, totals)` — reads only the totals response; never touches rows, so a
   non-additive metric can never be summed from branches. `100.00 %` sub only for `additive` metrics.
5. `resolveSort(sort, metrics)` — keeps the invariant `sort.key ∈ allowedSortKeys(metrics)`, otherwise
   falls back to `events desc`. `nextSort` / `sortArrow` take metric keys; the `pctu -> users` client
   mapping goes (P1 maps it server-side).
6. Wire: table renders `metrics.map(...)`; sort lives in `prefs.sort` via `onSortChange`; `metrics`
   join the list / totals / keys / values inputs (not the chart's input). The route's cold-start
   query mirrors the table's first request so they still share one fetch.
7. Verify: event-analytics vitest config, `pnpm -F start typecheck`.
