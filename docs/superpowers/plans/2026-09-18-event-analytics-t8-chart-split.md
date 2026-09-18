# T8 — Chart split view

Spec §5.2 / §5.3, design state `3f`. Follows T7 (#43), which left a placeholder
where the split view goes.

## Measurements read from the design (split block)

| Thing | Value |
|---|---|
| panel | `flex: 1 1 0`, border, radius 8, padding `10px 10px 8px`, row `gap: 12px` |
| panel chart | `viewBox 0 0 1000 132`, `y = 132 - v / max * (132 - 10)` |
| grid | 3 lines: `132.0`, `66.0`, `0.0` |
| series | solid `stroke-width: 2`, told apart by **colour** (not by period) |
| header | letter badge `19px` (A `#EEF3FE`/`#2266ec`, others `#F0F4F9`/`#4a5568`), range, mark |
| footer | `xFirst → xLast`, total, `Δ vs A`; panel A reads `baseline` |
| delta | `(sumK / sumA - 1) * 100` over **every plotted series**, `#047857` up / `#dc2626` down, A `#798290` |
| below the row | series colour swatches + `n panels · shared y axis · Δ of all plotted series vs A` |
| y scale | the same `max` as the overlay — `overlayScale` already computes it |

## Steps

1. `comparison-chart.ts`: `buildSplitPanels` (pure, tested) — per period the
   paths on the shared scale, the 3 grid lines, the period total, the delta of
   all series against A (`null` when A is 0, rendered `—`; A itself renders
   `baseline`), first/last bucket label.
2. `chart.tsx`: render the panel row instead of the placeholder; clicking a
   panel returns to overlay with `focusPeriod` on it; legend swatches + note.
3. Verify: event-analytics vitest config, `pnpm -F start typecheck`.

Collapse still wins, and the non-compare branch stays on `ReportChart`.
