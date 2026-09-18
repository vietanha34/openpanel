# T7 — Chart overlay comparison

Spec: `docs/superpowers/specs/2026-09-18-event-analytics-phase3-design.md` §5.3, task T7.

## Measurements read from the design

`EventAnalyticsScreen.dc.html` (105KB, the compare/SVG block) and the canvas
`Event Analytics Comparison.dc.html` (3c, 3e). Every number matches the spec —
no deviation to report.

| Thing | Value |
|---|---|
| `periodWidths` | `[2.4, 1.9, 1.6, 1.4]` |
| `periodOpacity` | `[1, 0.68, 0.46, 0.3]` |
| `periodDashes` | `['0', '5 4', '1 3', '9 3 2 3']` |
| marks | `['—', '– –', '·-·', '-·-']` (already in `comparison-state.ts`) |
| isolate | focused `2.6px` opacity `1`; the rest opacity `0.12` |
| overlay svg | `viewBox 0 0 1000 236`, 5 grid lines, crosshair `#798290` |
| y scale | `max(values) * 1.15`, `yAt(v) = H - v / max * (H - 12)` |
| x scale | `xAt(i) = i / (n - 1) * W`, centred when `n === 1` |
| tooltip | header `Compare periods`, width `200 + n*96`, column `92px`, delta **before** the value, `#34d399` up / `#f87171` down, footer `<date> · A solid, earlier periods dashed · Δ vs A` |
| PERIODS row | chip letter + mark + range, hint `Click a period to isolate it · line weight fades with age` |
| legend | one row per series: colour, label, then one value per period prefixed with its mark (`#798290` for A, `#B3BDC7` for the rest) |
| view toggle | `Overlay` (layers icon) / `Split` (columns-3 icon), only while comparing |

Split (`132px` panels) is T8; this task renders the toggle and leaves the split
view showing a placeholder.

## Why a local renderer

`ReportChart`'s `options` cannot set stroke width, dash or opacity per series
and cannot replace the tooltip, and `ReportLineChart` fetches and renders
internally. Overlaying n periods on one axis is therefore impossible through
it. Orchestrator approved a compare-only renderer inside
`apps/start/src/components/event-analytics/`, with conditions:

1. The data path stays shared: every period's query input comes from
   `buildEventAnalyticsChartInput`, identical to the non-compare branch except
   for the dates. Pinned by a test.
2. The non-compare branch keeps using `ReportChart`, unchanged.
3. All geometry lives in `comparison-chart.ts` (pure, tested), including
   alignment by **bucket index** — the x axis is A's dates.
4. Crosshair from basic pointer events, no new dependency.
5. One y scale shared by every period (T8 reuses it).

## Steps

1. `comparison-chart.ts` + test: period line style (with focus/dim), shared
   scale, path builder aligned by bucket index, tooltip rows/columns/width,
   legend rows, PERIODS chips (reusing `comparison-state.ts`).
2. `chart-input.ts`: build the n inputs from one anchor via `periods.ts`.
3. `chart.tsx`: compare branch renders the SVG overlay, PERIODS row, legend,
   crosshair tooltip and the Overlay|Split toggle; collapse still wins.
4. Route: pass comparison state and the baseline period down.
5. Verify: event-analytics vitest config, `pnpm -F start typecheck`.
