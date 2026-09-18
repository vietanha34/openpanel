# Phase 3 P2 — Comparison toolbar, state and table

Spec: `docs/superpowers/specs/2026-09-18-event-analytics-phase3-design.md` §5.3, task T5 + T6.
Chart overlay (T7) ships in a stacked PR on top of this one.

## Số đo trích từ design (đọc trước khi code)

Nguồn: canvas `Event Analytics Comparison.dc.html` (3a–3f) + component `EventAnalyticsScreen.dc.html`.

**Nút Comparison** — 32px, icon `git-compare-arrows`, chevron-up opacity .6. Khi menu mở hoặc đang compare: nền `#0C162A`, chữ `#fff`, viền `#0C162A`.

**Menu** (3a) — 330px, `top: 38px`, padding 8, gap 2.
- Item 1 `With previous period`: icon `undo-2`, tiêu đề 13px/500, mô tả 12px `#798290`, nhãn `How many previous periods` 11px/500, 3 pill cao 24px bo 99px, note `Up to 3 previous periods — 4 columns per metric` 11px `#B3BDC7`.
- Item 2 `With existing or new segment`: `opacity: .5`, `cursor: not-allowed`, badge `SOON` cao 17px nền `#E7ECF2`, **vẫn giữ** `chevron-right`.

**Chip period** (3b) — cao 32px, badge tròn 17px (A `#EEF3FE`/`#2266ec`, B–D `#F0F4F9`/`#0C162A`), range, ký hiệu nét mono 10px, `chevron-down`. Nút `✕` chỉ hiện khi `i >= 2 && i === compareCount - 1`.
- `marks = ['—', '– –', '·-·', '-·-']`, A hiển thị `baseline`.
- Chip dashed `+ Add previous period`, ẩn khi `compareCount === 4`.
- Note `n periods · max 4`. Nút swap 32×32 icon `arrow-left-right`, title `Reverse period order`.
- Chip `Segment · Not selected` — placeholder, không bấm được gì.
- `✕ Cancel comparison` nằm cuối hàng, sau `flex: 1`.

**Bảng** (3b) — `colW = 118px` khi compare (`132px`/`158px` như cũ khi không), `labelFlex = 0 0 300px`, `rowMinW = 300 + metrics * compareCount * 118`, `cardOverflowX = auto`.
- Cột sinh theo `metricKey + ':' + letter`, sub-header `SEGMENT A…D`.
- Delta: xanh `#047857`, đỏ `#dc2626`, xám `#798290` khi `|d| < 0.005` (hiển thị `0.00 %`). Baseline 0 → `—` (spec A3, **lệch design có chủ đích**).

## Các bước

1. `comparison-state.ts` thuần + test: bật/tắt, `compareCount` 2..4, add/remove/swap, `focusPeriod`, cancel (reset sort + metric chart), sinh `periods` qua `periodsFrom`.
2. Param URL `cmp`, `cmpn`, `cmpv`, `cmpf`, `cmpp` trong `use-event-query-filters.ts`.
3. `comparison-toolbar.tsx` — nút, menu, dãy chip, swap, cancel.
4. Bảng: cột theo period, sub-header, delta, layout ghim 300px.
5. Verify: vitest UI + typecheck `start`.
