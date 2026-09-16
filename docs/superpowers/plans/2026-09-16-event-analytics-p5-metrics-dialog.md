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
