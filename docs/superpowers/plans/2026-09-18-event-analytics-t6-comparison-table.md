# T6 — Comparison table

Spec: `docs/superpowers/specs/2026-09-18-event-analytics-phase3-design.md` §3 D2/D3/D7, §5.3, §6 T6.

Files: `apps/start/src/components/event-analytics/comparison-columns.ts` (new) + test,
`tree-utils.ts`, `event-tree-table.tsx`, `tree-nodes.tsx`, the analytics route.
`chart.tsx` / `chart-input.ts` / the comparison chart belong to T7 — not touched.

## Design numbers, extracted (EventAnalyticsScreen.dc.html, states 3b / 3e)

From `renderVals` and the table markup:

- `colW = compare ? '118px' : (metrics.length > 4 ? '132px' : '158px')`
- `labelFlex = compare ? '0 0 300px' : '1 1 auto'`
- `rowMinW = compare ? 300 + metrics × compareCount × 118 : 0`
- `cardOverflowX = compare ? 'auto' : 'hidden'`
- Name cell: `flex: 1 1 auto; min-width: 48px; ellipsis` — the label never collapses to 0.
- Header cell: label plus a sub line, `display: block`, `font-weight: 400`, `#798290`,
  `margin-top: 3px`; the sub is `SEGMENT A…D` and is empty outside comparison.
- Column keys: `metricKey:A…D` (`colDefs`), one block of `compareCount` columns per metric.
- Cell: value line 13px mono, sub line 11px mono with its own colour.
- `deltaCell`: flat when `|Δ| < 0.005` -> `0.00 %` in `#798290`; otherwise
  `+x.xx %` / `-x.xx %` in `#047857` / `#dc2626`. Spec A3 overrides the design for a
  zero baseline: `—`, not `0.00 %`.
- `sortNodes` strips `/:(A|B|C|D)$/` before sorting — every period keeps one row order (§3 D7).
- Totals row in comparison uses the same cells as a data row (`cellsFor(..., '#totals')`).
- Footer: `Children load on expand — daily grain, Sep 12 — 18 vs Sep 5 — 11 vs …`.

## Steps (TDD; pure helpers in `comparison-columns.ts`)

1. `comparisonColumns(metrics, compareCount)` -> `{ key, label, sub, sortKey, period }`;
   `sortKey` is always the bare metric key. `comparisonMinWidth`, `COMPARISON_COLUMN_PX`,
   `COMPARISON_LABEL_PX`.
2. `deltaCell(value, baseline)` -> `{ text, tone }`, `—` on a zero baseline.
3. `comparisonTableCells(metrics, compareCount, row, totals, showPct)`: each column reads
   its own period from `row.periods[k]` / `totals.periods[k]` (§3 D2 — `pctu` of B divides
   by B's users). `showPct` applies to column A only: B–D use the sub line for the delta.
4. `comparisonFooterLabel(chips)` -> `Sep 12 — 18 vs …` from the period chips T5 builds.
5. Wire: the table takes `comparison` (state + chips) and `periods`; `periodsForRequest`
   goes into the four endpoint inputs unchanged (`undefined` keeps the SQL byte-identical);
   the header renders sub-headers and sorts by the stripped key; the name column pins at
   300px with the numbers in an `overflow-x` track.
6. Verify: the event-analytics vitest config and `pnpm -F start typecheck`.

The abandoned WIP branch `ao/openpanel-13/p2-t6-table-wip` (75cc083a) was read for ideas
only; nothing is cherry-picked, and every test here is written and run in this branch.
Its `showPct` reaches every period; the task requires the `#/%` toggle to apply to A only,
which is what this plan does.
