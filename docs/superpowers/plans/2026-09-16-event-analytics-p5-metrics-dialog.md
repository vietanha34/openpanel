# P5 — Metrics dialog

Spec: `docs/superpowers/specs/2026-09-16-event-analytics-phase2-design.md` §4, §6, §8 P5, §9 A2/A5/A6.
Design: `Event Analytics Metrics.dc.html` states `2a` (catalogue) and `2b` (parameter step).

## Scope

- `apps/start/src/components/event-analytics/metrics-state.ts` (pure) + `metrics-state.test.ts`
- `apps/start/src/components/event-analytics/metrics-dialog.tsx`
- One mount point for the toolbar button (table toolbar or route — whichever is less invasive; decided
  after reading the design).

## Part 1 — pure state (no design dependency)

Draft: `{ metrics: DraftMetric[]; editing: number | null }`, where a parameter metric with no
`param` is a pending chip and `editing` is the chip whose parameter dropdown is open.

- `addMetric(id)`: no-op at 10. A parameter metric always appends a pending chip and opens its
  dropdown (A5: same metric on two parameters is allowed). A plain metric already in the draft is
  toggled off instead (the catalogue check mark), unless locked.
- `removeMetric(index)`: no-op on a locked metric; keeps `editing` pointing at the same chip.
- `moveMetric(from, to)`: reorder; `editing` follows its chip.
- `openParam(index)` / `closeParam()` / `setParam(index, param)`.
- `canApply(draft)`: false with a pending chip (A2) or a duplicate metric key.
- `applyDraft(draft, sort)`: the committed metrics plus a sort that is still in
  `allowedSortKeys(metrics)`; otherwise sort resets to `events desc`.
- Labels: `chipLabel`, `counterLabel` (`<n> of 10 metrics selected`), `toolbarLabel`
  (`Metrics · <first>, +<n-1>`), `catalogueGroups(query)` (two groups, filtered by label).

## Part 2 — dialog UI (blocked on Claude Design access)

Chip frame, `+` tile, 458px catalogue panel, 212px parameter dropdown, Apply / Cancel, wired to
`useEventAnalyticsPrefs().update({ metrics, sort })`. Parameter list from `overview.eventPropertyKeys`.

## Verify

`pnpm exec vitest run --config apps/start/src/components/event-analytics/vitest.config.ts`,
`pnpm -F start typecheck`.

## Design notes (EventAnalyticsScreen.dc.html, read 2026-09-16)

Toolbar button (toolbar row, after the dim filters, before Filters): h32, border #E8EBF1, radius 6,
px10, gap7, 13px/500, `columns-3` icon 15 + `Metrics · {summary}` + `chevron-down` 14 at opacity .6.
Summary = first metric's catalogue label (no parameter) + `, +{n-1}`. Open state: dark (#0C162A bg, white).

Modal: overlay rgba(12,22,42,.34), aligned top, padding-top 120, centred horizontally.
- Main card: w470, radius 10, p22, gap14, shadow 0 20px 50px rgba(12,22,42,.22).
  - Title `Metrics` 19px/600; sub 13px muted: `Select metrics to customize` **`which columns to display`** `in the table`.
  - Chip frame: border, radius 8, p10, flex-wrap gap8, position relative.
    - Chip: h32, radius 6, px7, gap6, 13px, bg #F7F8FA / border #E8EBF1; when its param dropdown is
      open bg #EEF3FE / border #CFE0FB. `grip-vertical` 13 (#B3BDC7), label, remove `x` 13 in an
      18x18 box (hidden for locked). Click chip = open param dropdown (param metrics only, closes catalogue).
    - `+` tile: 32x32, radius 6, bg #F0F4F9, `plus` 15, title `Add metric`, opacity .4 at 10.
      Click toggles the catalogue and closes the param dropdown.
    - Param dropdown: absolute top calc(100%+6px) left 20, w212, max-h420, radius 8, shadow
      0 16px 40px rgba(12,22,42,.18). Search row h40 (placeholder `Search`), list p6, items h34
      radius 5, mono 12px label + `check` 14 on the current param. Picking sets param, closes the
      dropdown, reopens the catalogue.
  - Bullet list 13px muted, gap9:
    1. Some metrics can't be removed from the list, but you can reorder them.
    2. You can manually select up to 10 metrics, but some report types may display more than 10 metrics in the table.
    3. Drag metrics in the list above to reorder columns.
  - Footer (margin-top 38): `Apply` primary h38 px22 14px/500; `Cancel` outline h38 px20; spacer;
    counter 12px #B3BDC7 `{n} of 10 metrics selected`.
- Catalogue panel: right of card, w458, max-h620, margin-left -12, margin-top -22, radius 10.
  Search row h48 px16 with `search` 15. Body p 10/8/14. Group header h34 px10 13px/600 with
  `chevron-down` 14. Item h36 radius 6, pl31 pr10, label, `circle-help` 14 (#B3BDC7, help text as
  tooltip), `check` 15 visible when any draft chip has that id. Opens by default with the dialog.
  Clicking a parameter metric appends a pending chip, opens its dropdown and closes the catalogue.

Design deviations taken from the spec: Apply with a pending chip is disabled (A2) instead of silently
dropping it; the sort resets to `events desc` (design: first key).
