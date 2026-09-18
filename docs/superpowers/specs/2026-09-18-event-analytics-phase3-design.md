# Event Analytics Phase 3 — Design & Task Plan

Date: 2026-09-18
Base: `feature/event-analytics` @ `482b5e31`
Requirements gốc: `/tmp/op-phase3/requirements.md` (nguyên văn của user, chép vào Appendix A)
Design: Claude Design project `233791a0-310f-443c-8118-b345c9f77b7d`
- `Event Analytics Comparison.dc.html` (7,311 bytes) — canvas 6 artboard `3a`–`3f`. Đã đọc đủ.
- `EventAnalyticsScreen.dc.html` (105,661 bytes, 1,494 dòng) — đã đọc: khối props, state compare, `periodWidths` / `periodOpacity` / `periodStart` / `periodDays`, `shiftDays` / `axisLabel` / `longDate` / `periodRange`, `deltaCell` / `compareCells` / `sortNodes` / `cellsFor`, `rowMinW`, pill chọn số period. **Chưa đọc hết**: phần markup vẽ SVG overlay/split và nav trái.

Tiền nhiệm: spec Phase 1 (advanced filters), Phase 2 (metrics), và `docs/event-analytics/ARCHITECTURE.md` — 9 bất biến I1–I9 ở đó là ràng buộc của spec này.

> Spec only. Chưa implement cho tới khi user duyệt.

## 0. Ghi chú về tin giao việc bị cắt

Tin giao task đứt giữa chừng ở hai chỗ:

1. Id design chỉ còn `233791a0-310f-443c-813`. Đã đối chiếu: khớp tiền tố project cũ `233791a0-310f-443c-8118-b345c9f77b7d`, và project đó có đúng page `Event Analytics Comparison` như requirements mô tả. Dùng project này.
2. Câu hỏi backend mất chữ: *"mỗi period một lượt query 4 endpoint hay nới input nhận mảng periods? Cân nhắc chi phí n query song song vs contract mới; Users/un…"*. Spec trả lời câu đó ở §3 D1 (quyết định: **nới contract nhận mảng periods cho bảng, n query cho chart**), và xử lý phần "Users/unique" ở D2. Nếu đoạn mất chữ còn ý khác, báo lại.

## 1. Goal

Ba yêu cầu:

- **R1** — dãy chip filter xuống dòng riêng, tách khỏi hàng nút.
- **R2** — cold-start 5 event phải chạy lại khi người dùng apply filter mới: xoá lựa chọn cũ, chọn top 5 của danh sách đã lọc.
- **R3** — **Comparison mode**: so cùng một report giữa khoảng hiện tại và 1–3 khoảng trước. R3 là toàn bộ khối lượng của phase này.

R1 và R2 nhỏ, độc lập, không đụng contract. R3 đổi contract của cả 4 endpoint và đổi cả bảng lẫn chart.

## 2. Current state

| Vùng | Hiện tại | Nguồn |
|---|---|---|
| Hàng toolbar | `<div className="row flex-wrap gap-2">` chứa `OverviewRange`, `OverviewFilterButton`, `OverviewFiltersButtons` (chip filter phẳng), `MetricsDialog`, `AdvancedFiltersPanel` | route `…events._tabs.analytics.tsx` |
| Chip advanced filter | `AdvancedFiltersPanel` tự render chip ngay dưới nút của nó (`col gap-2`) | `advanced-filters-panel.tsx` |
| Cold start | `coldStartSelection` chạy **một lần mỗi mount**, khoá bằng `coldStartPending`, chỉ khi `prefsStatus === 'absent'` | `chart-cold-start.ts`, route |
| Contract | `zEventAnalyticsRange` mang **một** khoảng: `range`, `startDate?`, `endDate?` | `packages/validation/src/event-analytics.ts` |
| Metric row | `{ events, users, metrics?: Record<string, number> }` | cùng file |
| Sort | string, kiểm bằng `refineSort` theo `metrics` của request | cùng file |
| SQL bảng | `buildEventAnalyticsBaseQuery` lọc `created_at BETWEEN start AND end`, các builder `GROUP BY` rồi `LIMIT n+1` | `overview.service.ts` |
| Chart | `ReportChart` → `trpc.chart.chart` / `chart.aggregate` → engine. Engine hỗ trợ **đúng một** previous period qua `input.previous` + `getChartPrevStartEndDate` | `packages/db/src/engine/index.ts`, `date.service.ts` |
| Persist | `op:event-analytics:v1:<projectId>` trong localStorage: metrics, sort, pct, chart, selected. Filter nằm trên URL (`f`, `fg`) | `use-event-analytics-prefs.ts` |

Hai điều trong current state quyết định thiết kế §3:

- **Engine chart chỉ biết một previous period.** Muốn 3 previous phải hoặc sửa engine, hoặc gọi nhiều lượt.
- **Bảng có phân trang.** Mỗi period query riêng sẽ trả **tập dòng khác nhau** (top 10 của B không trùng top 10 của A), trong khi R3 §6 bắt buộc mọi period **giữ cùng thứ tự dòng**.

## 3. Decisions

### D1 — Bảng: nới contract nhận mảng `periods`. Chart: n query, không đổi contract.

Đây là câu hỏi backend trong tin giao việc. Hai vế trả lời khác nhau vì hai vấn đề khác nhau.

**Bảng — bắt buộc nới contract.** Không phải vì chi phí, mà vì **căn dòng**. Danh sách event phân trang và sắp theo metric; nếu client gọi 4 lượt riêng thì mỗi period tự chọn top 10 của nó, và bảng không thể ghép dòng cho một cột `Δ vs A` nào cả. Quy tắc R3 §6 — "giữ CÙNG thứ tự row mọi period" — chỉ thoả khi **server chọn dòng theo period A rồi tính mọi period trên đúng tập dòng đó**.

Thêm nữa, một query trên khoảng hợp nhất rẻ hơn n query: cùng số dòng đọc, nhưng một lần quét, một `GROUP BY`, một vòng mạng.

```ts
// Thay cho startDate/endDate đơn lẻ, nhưng KHÔNG bỏ chúng đi.
periods: z.array(z.object({ startDate: z.string(), endDate: z.string() }))
  .min(1).max(EVENT_ANALYTICS_MAX_PERIODS /* 4 */).optional()
```

SQL: quét `created_at BETWEEN min(start) AND max(end)`, mỗi period một biểu thức có điều kiện:

| Metric | Một period (hôm nay) | Nhiều period, period k |
|---|---|---|
| `events` | `count()` | `countIf(<in_k>)` |
| `users` | `uniqExact(profile_id)` | `uniqExactIf(profile_id, <in_k>)` |
| `sum_param` | `sum(coalesce(toFloat64OrNull(p), 0))` | `sumIf(coalesce(toFloat64OrNull(p), 0), <in_k>)` |
| `avg_param` | `sum(…) / count()` | `sumIf(…, <in_k>) / countIf(<in_k>)` |
| `median_param` | `quantileExact(0.5)(…)` | `quantileExactIf(0.5)(…, <in_k>)` |
| `uniq_param` | `uniqExact(coalesce(…, 0))` | `uniqExactIf(coalesce(…, 0), <in_k>)` |
| `*_per_user` | `… / uniqExact(profile_id)` | `…If(<in_k>) / uniqExactIf(profile_id, <in_k>)` |

`<in_k>` là `created_at BETWEEN toDateTime(start_k) AND toDateTime(end_k)`.

Phương án bị loại: (a) client gọi 4 lượt — vỡ căn dòng, đã nói trên; (b) `JOIN` n subquery theo `name` — cùng kết quả nhưng n lần quét và một `JOIN` thừa; (c) `GROUP BY name, period` rồi pivot ở client — dòng của period B không nằm trong top 10 của A vẫn trả về, phải cắt ở client, và `LIMIT` không còn nghĩa.

**Chart — không đổi contract, client gọi n lượt.** Chart không phân trang và không cần căn dòng: các series căn theo **chỉ số bucket**, không theo tên dòng. Panel chart gọi `ReportChart` thêm `n - 1` lần với `startDate` / `endDate` đã dịch, rồi xếp chồng ở client. Không sửa engine, không đụng `input.previous` (đường đó chỉ biết một previous và các surface khác đang dùng), mỗi period là một cache entry riêng của react-query.

Giá phải trả, ghi rõ: **n query cho chart**. Chấp nhận vì n ≤ 4, mỗi query đã được cache riêng, và cách còn lại là sửa engine — vùng dùng chung với mọi report khác, đúng loại thay đổi Phase 1/2 đã cố tránh.

### D2 — Users và mọi tỷ số tính riêng cho từng period, không bao giờ cộng

`uniqExactIf(profile_id, <in_k>)` đếm user riêng trong từng period. Một user hoạt động ở cả A và B được đếm **một lần ở mỗi period**, và tổng hai period **không** bằng `uniqExact` trên khoảng hợp nhất. Đây là I2 của `ARCHITECTURE.md` áp cho chiều period.

Mẫu số của `pctu` và `epau` là `totals.users` — cũng phải **theo từng period**. Endpoint totals vì thế cũng nhận `periods` và trả mảng.

### D3 — Delta luôn so với A, và baseline 0 hiện `—`

`delta_k = (value_k / value_A - 1) * 100`. Khi `value_A = 0`: requirements §7 yêu cầu hiện `—`.

**Design nói khác**: `deltaCell(c.value, va ? (vk / va - 1) * 100 : 0)` — tức vẽ `0.00 %` màu xám khi baseline bằng 0. Spec theo **requirements**, vì `0.00 %` nói "không đổi" trong khi sự thật là "không so được": A không có gì để so. Xem A3.

Tính delta ở **renderer**, không ở SQL: server trả giá trị từng period, client chia. Lý do: delta là tỷ số của hai metric đã có, tính ở SQL thì phải nhân đôi biểu thức và vẫn phải xử lý chia 0 ở client.

### D4 — Period sinh từ một mốc, mọi phép ngày dùng `Date`

Theo design: `periodStart` (ngày đầu của A) + `periodDays`. Period k = `[shiftDays(periodStart, -periodDays * k), + periodDays - 1]`, dùng `Date.setDate()`.

Requirements §3 ghi rõ bug đã gặp: **cộng trừ số trên chuỗi ngày** cho ra `15 - 21 = -6 Sep`. Mọi nhãn (trục x, crosshair, tooltip header, chip A–D, footer bảng) phải đọc từ đối tượng `Date`, và phép dịch ngày chỉ được làm bằng `shiftDays`. Spec đặt một helper thuần duy nhất và cấm mọi nơi khác tự tính (§6, T3.1).

### D5 — Bất biến I10: mọi period cùng độ dài, chặn ở UI và ở contract

R3 §7 cho hai lựa chọn: chuẩn hoá theo ngày, hoặc chặn không cho chọn khác độ dài. Chọn **chặn**.

Period sinh từ một mốc nên mặc định đã cùng độ dài; chỉ date picker riêng của từng chip (§4) mới phá được. **Date picker của chip chỉ chọn ngày bắt đầu; độ dài khoá theo `periodDays` của A** — không có ô chọn ngày kết thúc. `superRefine` của contract từ chối lần nữa ở server, nên một payload viết tay cũng không lách được.

Đây là **bất biến I10**, xếp cạnh I1–I9 của `docs/event-analytics/ARCHITECTURE.md`: *mọi period trong một lần so sánh có cùng số ngày.* Chuẩn hoá theo ngày nghe tổng quát hơn nhưng làm mọi con số thành "trung bình mỗi ngày" — người dùng đang đọc `Events`, không đọc `Events/ngày`, và đổi ý nghĩa cột mà không nói là thứ tệ nhất có thể làm với một dashboard.

### D6 — Trạng thái comparison nằm trên URL, không vào localStorage

Phase 2 D6 chia: cái gì chia sẻ được thì lên URL (filter), cái gì là sở thích cá nhân thì vào localStorage (metrics, sort, pct, chart). Comparison thuộc vế đầu: R3 §9 yêu cầu persist vào URL và saved report, và một link so sánh gửi cho đồng nghiệp phải mở ra đúng khoảng đó.

Param URL:

```
cmp=1                 // bật
cmpn=2|3|4            // compareCount
cmpv=overlay|split    // compareView
cmpf=-1|0..3          // focusPeriod
cmpp=<ISO A start>    // mốc period, độ dài lấy từ range hiện tại
```

`sortKey` có hậu tố period (`events:B`) vẫn nằm trong prefs như hôm nay, vì nó là sở thích đọc bảng; khi thoát compare thì strip hậu tố (§5 Cancel).

### D7 — Sort luôn theo metric gốc, bỏ hậu tố period

Design: `sortKey.replace(/:(A|B|C|D)$/, '')`. Bấm cột `Δ` của B vẫn sắp theo metric ấy **của A**, nên thứ tự dòng không đổi khi bấm sang cột period khác — đúng R3 §6.

Hệ quả cho contract: `refineSort` phải chấp nhận hậu tố. Quy tắc: strip `:A|:B|:C|:D` rồi mới đối chiếu với `metrics` của request.

## 4. Contract changes

`packages/validation/src/event-analytics.ts`.

```ts
export const EVENT_ANALYTICS_MAX_PERIODS = 4;

export const zEventAnalyticsPeriod = z.object({
  startDate: z.string(),
  endDate: z.string(),
});

// Trên zEventAnalyticsRange, cạnh startDate/endDate đang có:
periods: z.array(zEventAnalyticsPeriod)
  .min(1)
  .max(EVENT_ANALYTICS_MAX_PERIODS)
  .optional(),
```

Luật kiểm (`superRefine`, cùng chỗ với luật metrics):

- `periods[0]` là **A**, baseline. Các period sau xếp lùi dần về quá khứ.
- Mọi period **cùng số ngày** (D5). Lệch → từ chối.
- Period không được chồng nhau.
- Vắng `periods` = hành vi hôm nay, một khoảng, SQL **byte-identical**.

Output — thêm trường, không đổi trường cũ:

```ts
export type IEventAnalyticsMetricRow = {
  events: number;                      // period A
  users: number;                       // period A
  metrics?: Record<string, number>;    // period A
  /** Chỉ có khi request gửi >1 period. `periods[0]` trùng với 3 trường trên. */
  periods?: Array<{
    events: number;
    users: number;
    metrics?: Record<string, number>;
  }>;
};
```

`events` / `users` / `metrics` **vẫn là của A**, nên mọi reader hiện tại (bảng một chiều, chart, integration test) không đổi một dòng. Đây đúng khuôn D2 của Phase 2 khi thêm `metrics`.

`sort`: `refineSort` strip hậu tố `:A|:B|:C|:D` trước khi đối chiếu (D7).

## 5. UI

### 5.1 R1 — chip filter xuống dòng

Route tách làm hai hàng:

```
row 1: OverviewRange · Filters · Metrics · Advanced filters · (Comparison) · (✕ Cancel comparison)
row 2: chip filter đang áp (phẳng + group) · "No property filters — showing all traffic"
```

`OverviewFiltersButtons` và dãy chip của `AdvancedFiltersPanel` chuyển xuống hàng 2. `AdvancedFiltersPanel` phải tách phần chip ra khỏi component (trả chip qua props hoặc tách `<AdvancedFilterChips>`), vì hiện chip nằm trong cùng `col` với nút.

### 5.2 R2 — cold start chạy lại khi apply filter

Hôm nay `coldStartPending` khoá cold start sau lần đầu, có chủ đích: đổi filter không được chọn lại những dòng người dùng đã bỏ.

R2 đổi quy tắc: **apply filter là hành động rõ ràng của người dùng**, nên nó *mở khoá* cold start đúng một lần. Cụ thể:

- Khi `filters` / `filterGroup` đổi (so sánh giá trị đã serialize, không so tham chiếu), đặt `coldStartPending = true` và **xoá** `selected`.
- Lượt cold start kế tiếp chọn top `min(5, n)` của danh sách **đã lọc**.
- Điều kiện `prefsStatus === 'absent'` bị bỏ cho nhánh này: người dùng đã có prefs lưu vẫn phải được chọn lại theo filter mới. Cold start lúc mount vẫn giữ nguyên luật cũ (chỉ khi `absent`).

`coldStartSelection` giữ nguyên chữ ký; chỗ đổi là điều kiện kích hoạt ở route. Khác biệt "mount" vs "apply filter" phải nằm trong một helper thuần để test được (§6, T2).

### 5.3 R3 — Comparison

Bám design 3a–3f và requirements §2, §4, §5, §6. Những điểm dễ làm sai, ghi thành ràng buộc:

- **Menu** (3a): 2 item. "With previous period" hoạt động, mang khối pill 1/2/3 previous (= tổng 2/3/4 period), mặc định 1. "With existing or new segment" **disabled**, badge `SOON`, `opacity .5`, `cursor: not-allowed`, **vẫn giữ mũi tên submenu**.
- **Toolbar khi compare** (3b): chip date đơn đổi thành dãy chip period. Mỗi chip: badge letter (A màu brand, B–D xám), range ngày, ký hiệu nét, chevron mở date picker riêng (D5: chỉ đổi vị trí). Từ chip C có `✕`. Chip dashed `+ Add previous period` ẩn khi đủ 4. Text `n periods · max 4`. Nút swap đảo thứ tự. Chip `Segment · Not selected` giữ làm placeholder. **Hàng 2 toolbar không đổi** — tức dãy chip filter của R1 nằm nguyên chỗ.
- **Nét theo bậc tuổi**, lấy đúng số của design: width `[2.4, 1.9, 1.6, 1.4]`, opacity `[1, .68, .46, .30]`, dash `liền / 5 4 / 1 3 / 9 3 2 3`. **Không dùng màu để phân biệt period** — màu đã mã hoá series (R3 §8).
- **Overlay** (3c, 3e): hàng `PERIODS` chip A–D, click để isolate (`focusPeriod`), period được chọn `2.6px` opacity 1, phần còn lại `.12`; click lại bỏ. Tooltip crosshair: header `Compare periods`, n cột ngày, mỗi series một dòng với giá trị từng period và `Δ%` vs A **đặt trước** con số (xanh `#34d399` tăng, đỏ `#f87171` giảm), footer + width `200 + n*96` px.
- **Split** (3f): một panel mỗi period, `flex: 1 1 0`, chart cao 132px, **chung thang y với overlay** (cùng max), series nét liền phân biệt bằng màu, footer panel có tổng và `Δ vs A` (panel A ghi `baseline`), click panel quay về Overlay với `focusPeriod` đó.
- **Collapse** (3d): ẩn chart, pill `Show chart ↗`, comparison giữ nguyên.
- **Bảng** (3b): `metrics × compareCount` cột, sub-header `SEGMENT A…D`. Cột A chỉ giá trị; B–D có dòng `Δ%` (xanh `#047857` / đỏ `#dc2626` / xám `#798290` khi `0.00%`). Cột tên **ghim 300px** `flex: 0 0 300px`, vùng số `overflow-x: auto`, `row min-width = 300 + metrics * n * 118`, cột số `118px`, tên ellipsis. **Không để cột tên bóp về 0** — đây là lỗi layout thường gặp nhất khi thêm cột.
- **Cancel**: `compare = false`, reset `sortKey` (strip hậu tố) và metric chart về `Events`, tắt tooltip, bảng + chart về một chiều.

## 6. Tasks

Ưu tiên: **P0 = R1 + R2** (nhỏ, độc lập, ship ngay được), **P1 = contract + SQL comparison**, **P2 = UI comparison**, **P3 = hoàn thiện**.

### Wave 0 — R1, R2 (song song, không phụ thuộc gì)

| Task | Ưu tiên | Phạm vi | File |
|---|---|---|---|
| **T1 — R1 chip xuống dòng** | P0 | Tách dãy chip ra hàng riêng; tách chip khỏi `AdvancedFiltersPanel` | route, `advanced-filters-panel.tsx` |
| **T2 — R2 cold start theo filter** | P0 | Helper thuần quyết định khi nào seed lại + nối vào route | `chart-cold-start.ts`, route |

### Wave 1 — nền comparison (tuần tự, chặn mọi thứ sau)

| Task | Ưu tiên | Phạm vi | File |
|---|---|---|---|
| **T3 — Contract periods** | P1 | §4 đầy đủ: `zEventAnalyticsPeriod`, `periods`, luật kiểm, `periods` trên `IEventAnalyticsMetricRow`, `refineSort` strip hậu tố | `packages/validation/src/event-analytics.ts` |
| **T3.1 — Period helper thuần** | P1 | `shiftDays`, `periodsFrom(anchor, days, count)`, `axisLabel`, `longDate`, `periodRange`, `deltaPercent` (baseline 0 → `null`) | `apps/start/src/components/event-analytics/periods.ts` (mới) |
| **T4 — SQL nhiều period** | P1 | Biểu thức có điều kiện (D1) cho cả 4 builder, alias `metric_<i>_p<k>`, `LIMIT`/sort vẫn theo A | `overview.service.ts` |

### Wave 2 — UI comparison (sau T3/T4)

| Task | Ưu tiên | Phạm vi | File |
|---|---|---|---|
| **T5 — Trạng thái + toolbar** | P2 | Param URL (D6), menu 3a, dãy chip period, swap, add/remove, Cancel | route, `comparison-state.ts` + `comparison-toolbar.tsx` (mới) |
| **T6 — Bảng comparison** | P2 | Cột × period, sub-header, delta, layout ghim 300px + scroll ngang, sort strip hậu tố | `event-tree-table.tsx`, `tree-nodes.tsx`, `tree-utils.ts` |
| **T7 — Chart overlay** | P2 | n query dịch ngày, nét theo bậc tuổi, hàng PERIODS + isolate, tooltip compare | `chart.tsx`, `chart-input.ts`, `comparison-chart.ts` (mới) |
| **T8 — Chart split** | P3 | Panel mỗi period, chung thang y, footer Δ, click về overlay | `chart.tsx` |

### Wave 3

| Task | Ưu tiên | Phạm vi |
|---|---|---|
| **T9 — Integration test nhiều period** | P3 | Fixture có user trùng giữa A và B; khẳng định `users` từng period **không** bằng tổng, và delta đúng |
| **T10 — Soát thị giác** | P3 | Đối chiếu `render_preview` 3a–3f |

Conflict notes: T1 và T2 cùng sửa route, T1 merge trước. T5–T8 đều đụng route và `chart.tsx`: T5 → T7 → T8, T6 chạy song song được vì chỉ đụng bảng.

### Prompt từng task

Preamble chung:

> Làm trên `feature/event-analytics`. Đọc `docs/superpowers/specs/2026-09-18-event-analytics-phase3-design.md` trước; §3, §4, §5 là ràng buộc, và 9 bất biến trong `docs/event-analytics/ARCHITECTURE.md` vẫn có hiệu lực. Requirements gốc ở Appendix A của spec. Design: project `233791a0-310f-443c-8118-b345c9f77b7d`, page `Event Analytics Comparison.dc.html` + `EventAnalyticsScreen.dc.html` (đọc bằng claude_design MCP). Dùng `superpowers:test-driven-development`. Theo `.claude/CLAUDE.md`; KHÔNG chạy `pnpm format`; chạy `pnpm codegen` trước typecheck; không commit `packages/geo/src/datacenter-asns.ts`. Typecheck hẹp `pnpm -F <package> typecheck`. Verify bằng output thật, đọc cả dòng `Test Files` lẫn `Tests`, báo test skip. `apps/start` không có setup React testing — logic phải nằm trong helper thuần và test ở đó. Chỉ commit file của task mình. Lệch spec thì dừng và báo, không tự sửa spec.

**T1:**
> Tách dãy chip filter xuống hàng riêng dưới hàng nút (§5.1). `AdvancedFiltersPanel` hiện render chip ngay dưới nút của nó — tách phần chip thành component riêng hoặc đưa lên route, sao cho hàng 1 chỉ còn nút và hàng 2 chỉ còn chip (cả chip phẳng của `OverviewFiltersButtons` lẫn chip của group). Giữ nguyên hành vi xoá chip và `Clear all`. Empty state `No property filters — showing all traffic` nằm ở hàng 2.

**T2:**
> Cold start phải chạy lại khi apply filter (§5.2). Thêm hàm thuần vào `chart-cold-start.ts` quyết định có seed lại hay không, nhận: filter đã serialize của lượt trước và lượt này, `prefsStatus`, số path đang chọn. Luật: lúc mount giữ nguyên hôm nay (chỉ seed khi `absent`); khi chuỗi filter đổi thì **xoá** `selected` rồi seed top `min(5, n)` của danh sách đã lọc, **kể cả khi prefs đã `stored`**. Test: đổi filter hai lần liên tiếp seed hai lần; filter không đổi thì không seed lại; người dùng bỏ chọn hết rồi không đổi filter thì lựa chọn rỗng được giữ.

**T3:**
> Implement §4 trong `packages/validation/src/event-analytics.ts`: `EVENT_ANALYTICS_MAX_PERIODS = 4` (hằng khai TRƯỚC schema dùng nó), `zEventAnalyticsPeriod`, `periods` optional 1–4 phần tử trên `zEventAnalyticsRange`, `superRefine` từ chối period lệch độ dài và period chồng nhau, `periods?` trên `IEventAnalyticsMetricRow`, `refineSort` strip hậu tố `:A|:B|:C|:D` trước khi đối chiếu. Chỉ đụng `packages/validation`. Test đủ các ca từ chối, và ca vắng `periods` vẫn parse như cũ.

**T3.1:**
> Tạo `apps/start/src/components/event-analytics/periods.ts` thuần: `shiftDays(date, n)` dùng `Date.setDate()`, `periodsFrom(anchorStart, days, count)` trả mảng `{ startDate, endDate }` với phần tử 0 là A và các phần tử sau lùi dần, `axisLabel`, `longDate`, `periodRange` theo đúng design, `deltaPercent(value, baseline)` trả `null` khi `baseline === 0` (§3 D3). Test ca bắc cầu tháng (`Sep 12` lùi 7 ngày ra `Sep 5`, lùi 21 ngày ra `Aug 22`) — requirements §3 ghi bug cũ là cộng trừ số trên chuỗi ngày cho ra `-6 Sep`, test phải chặn đúng lỗi đó.

**T4:**
> Sinh SQL nhiều period trong `overview.service.ts` theo §3 D1. Khi `periods` có mặt và dài hơn 1: quét khoảng hợp nhất, mỗi period một biểu thức có điều kiện (`countIf`, `uniqExactIf`, `sumIf`, `quantileExactIf`, và tỷ số per-user chia cho `uniqExactIf(profile_id, <in_k>)`), alias `metric_<i>_p<k>`. Chọn dòng và `LIMIT`/`ORDER BY` vẫn theo **period A**, để mọi period trả đúng cùng tập dòng theo cùng thứ tự. Totals cũng trả mảng period. Khi `periods` vắng hoặc chỉ 1 phần tử, SQL phải **byte-identical** với hôm nay — thêm test khẳng định. Test thêm: `users` của A và B tính riêng, không phải `uniqExact` trên khoảng hợp nhất.

**T5:**
> Trạng thái + toolbar comparison (§5.3, design 3a/3b). Param URL theo §3 D6, mọi logic chuyển trạng thái nằm trong `comparison-state.ts` thuần và test ở đó: bật/tắt, đổi `compareCount` (min 2, max 4), thêm/bớt period, swap, `focusPeriod` toggle, Cancel (reset sortKey strip hậu tố + metric chart về `events`). Ngày lấy từ `periods.ts` của T3.1, không tự tính. Item segment disabled kèm badge `SOON` và **vẫn giữ mũi tên submenu**.

**T6:**
> Bảng comparison (§5.3, design 3b). `metrics × compareCount` cột, sub-header `SEGMENT A…D`, cột A chỉ giá trị, B–D thêm dòng Δ% với đúng bộ màu. Layout: cột tên `flex: 0 0 300px` không bao giờ bị bóp, vùng số `overflow-x: auto`, `row min-width = 300 + metrics * n * 118`, cột số 118px. Sort strip hậu tố period rồi sắp theo metric của A (§3 D7) — test khẳng định bấm cột B không đổi thứ tự dòng. Totals chia theo period kèm delta, một dòng `nowrap`. Footer bảng `Sep 12 — 18 vs Sep 5 — 11 vs …`.

**T7:**
> Chart overlay (§5.3, design 3c/3e). Gọi `ReportChart` thêm `n - 1` lần với ngày đã dịch (§3 D1 vế chart), xếp chồng theo **chỉ số bucket**. Nét theo bậc tuổi đúng số design, không phân biệt period bằng màu. Hàng `PERIODS` với isolate. Tooltip compare: Δ% đặt trước giá trị, width `200 + n*96`. Logic ghép series và tính Δ nằm trong helper thuần, test ở đó; phần vẽ để T10 soát.

**T8:**
> Chart split (design 3f). Một panel mỗi period, `flex: 1 1 0`, cao 132px, **chung thang y với overlay** (cùng max trên mọi period), footer panel có tổng và Δ vs A, panel A ghi `baseline`, click panel quay về Overlay với `focusPeriod` đó.

**T9:**
> Mở rộng fixture ClickHouse: một user hoạt động ở **cả** A và B. Khẳng định `periods[0].users + periods[1].users` **khác** `uniqExact` trên khoảng hợp nhất, delta tính đúng, và `metrics` cấp cao nhất trùng `periods[0]`.

**T10:**
> So dashboard đang chạy với `render_preview` của 3a–3f. Sửa lệch trong `apps/start/src/components/event-analytics/`. Kiểm ở ~1440px và ~400px.

## 7. Assumptions

**A1 — Chart gọi n query, bảng dùng một query nhiều period.**
Lựa chọn khác: sửa engine cho nhận nhiều previous period. Bỏ vì engine là vùng dùng chung của mọi report; Phase 1 và 2 đã đặt nguyên tắc không đổi hành vi surface khác. Giá: n query chart, n ≤ 4.

**A2 — `periods[0]` là A và cũng là `events`/`users`/`metrics` cấp cao nhất.**
Lựa chọn khác: bỏ trường cũ, chỉ trả mảng. Bỏ vì làm vỡ mọi reader hiện tại để đổi lấy một chút gọn gàng.

**A3 — CHỐT: baseline 0 hiện `—`.**
Theo requirements §7. **Lệch design là có chủ đích**: design tính `0.00 %` (`deltaCell(…, va ? … : 0)`), nhưng `0.00 %` nói "không đổi" trong khi sự thật là "không so được" — A không có gì để làm mẫu số. Người implement T3.1/T6 phải giữ lệch này, đừng "sửa cho khớp design".

**A4 — CHỐT: chặn period khác độ dài.** Xem D5 (đã nâng thành bất biến I10). Chuẩn hoá theo ngày làm đổi ý nghĩa cột mà nhãn không đổi.

**A5 — Trạng thái compare nằm trên URL, không vào localStorage.**
Theo R3 §9 và nhất quán với Phase 2 D6. `sortKey` vẫn ở prefs.

**A6 — Period không được chồng nhau, và server từ chối nếu chồng.**
Period sinh từ một mốc nên không chồng; chỉ picker riêng mới phá được. Chồng nhau làm một event rơi vào hai period và mọi tổng mất nghĩa.

**A7 — CHỐT: chặn ở client, nguồn ngày là `trpc.project.activationStatus`. Không cần endpoint mới.**
Đã điều tra: procedure `project.activationStatus` (`packages/trpc/src/routers/project.ts:47`) trả sẵn `firstEventAt` (cột `Project.firstEventAt`, set một lần khi event đầu tiên về) và `projectCreatedAt`. Dùng `firstEventAt` làm mốc, fallback `projectCreatedAt` khi `firstEventAt` null — comment trong chính procedure ghi rõ cột này chỉ có với project tạo sau khi thêm cột. Period nằm hoàn toàn trước mốc đó, hoặc nằm ở tương lai → chip disabled + `No data for this period` (requirements §7). Chỉ khi task implement phát hiện procedure này không dùng được ở route analytics mới đề xuất endpoint nhỏ thành task riêng — và phải báo, không tự thêm.

**A8 — Không bật đồng thời compare-period và compare-segment.**
Theo R3 §8. Segment comparison là phase sau; item trong menu chỉ là placeholder disabled.

**A9 — `pctu` và `epau` vẫn không vẽ được trên chart khi compare.**
Giới hạn L1 của `ACCEPTANCE.md` không đổi: mẫu số là toàn bộ user theo từng bucket. Compare không làm nó dễ hơn — giờ cần theo từng bucket **và** từng period.

**A10 — CHỐT: apply filter xoá cả lựa chọn người dùng tự tay chọn.**
Theo R2, nguyên văn "XOÁ lựa chọn trước và ADD lựa chọn mới". **Hệ quả phải biết trước**: người dùng tick tay 8 event, đổi một filter, thì 8 lựa chọn đó mất và chart về top 5 của danh sách mới. Đây là hành vi được yêu cầu, không phải tác dụng phụ. Hai thứ vẫn giữ nguyên: cold start lúc mount vẫn chỉ chạy khi chưa có prefs lưu, và lựa chọn rỗng do người dùng tự bỏ hết **khi filter không đổi** vẫn được tôn trọng.

## 8. Decisions on the open questions

Sáu câu hỏi của bản trước đã được chủ dự án chốt khi duyệt spec. Ghi lại để lúc implement không mở lại.

1. **Baseline A = 0 hiện `—`** (A3). Lệch design là có chủ đích.
2. **Apply filter xoá cả lựa chọn người dùng tự tay chọn** (A10), kèm hệ quả đã ghi.
3. **Chặn period khác độ dài** (D5 / A4), nâng thành bất biến I10.
4. **Date picker từng chip chỉ chọn ngày bắt đầu**, độ dài khoá theo A (D5).
5. **Ngày bắt đầu tracking lấy từ `trpc.project.activationStatus`** — `firstEventAt`, fallback `projectCreatedAt`. Không cần endpoint mới; nếu task implement thấy không dùng được thì dừng và báo (A7).
6. **Thiết kế hai vế được duyệt**: bảng nới contract vì căn dòng, chart gọi n query và giữ nguyên engine (D1). Tin giao việc gốc không còn ý nào khác.

## 9. Appendix A — requirements nguyên văn

Chép nguyên văn từ `/tmp/op-phase3/requirements.md` (2026-09-18). Không sửa chữ nào.

> # Phase 3 requirements (nguyên văn từ user, 2026-09-18)
>
> ## R1 — Filter xuống dòng
> Phần filter (dãy chip active) để xuống dòng: hiện đang cùng dòng với nút Filters, cần tách xuống dòng riêng.
>
> ## R2 — Cold-start 5 event phải áp lại khi apply filter mới
> Lựa chọn 5 event đầu cho chart đang KHÔNG áp dụng khi apply 1 filter mới — nó ăn với 5 event của lượt đầu. Mong muốn: khi apply filter thì XOÁ lựa chọn event trước và ADD lựa chọn mới (top 5 của danh sách đã lọc).
>
> ## R3 — Comparison mode (spec user cung cấp nguyên văn)
> 1. Mục tiêu: so sánh cùng report (dimension + metrics + filters giữ nguyên) giữa khoảng hiện tại và 1–3 khoảng trước. Chỉ so theo time period; segment để phase sau.
> 2. Vào/ra mode: nút Comparison trên toolbar cạnh Filters, dropdown 2 item: "With previous period" (active, block config "How many previous periods" 3 pill: 1/2/3 previous = tổng 2/3/4 period, default 1 previous; note "Up to 3 previous periods — 4 columns per metric"); "With existing or new segment" disabled badge SOON opacity .5 cursor not-allowed giữ mũi tên submenu. Click pill chọn số period rồi click item apply; click item áp luôn với số đang chọn. Thoát: nút ✕ Cancel comparison cuối hàng toolbar (chỉ hiện khi compare). Cancel: compare=false, reset sortKey và metric chart về Events, tắt tooltip, bảng+chart về 1 chiều.
> 3. Mô hình dữ liệu: compare: boolean; compareCount: 2|3|4 (A là baseline); compareView: 'overlay'|'split'; focusPeriod: -1|0..3. Period sinh từ MỘT mốc: periodStart (ngày đầu A) + periodDays (7). Period k = [periodStart - 7k, periodStart - 7k + 6]. Mọi chỗ hiển thị ngày (trục x, crosshair, tooltip header, chip A–D, footer bảng) đọc từ chuỗi Date, tính bằng Date.setDate(), KHÔNG cộng trừ số trên string (bug đã gặp: 15 - 21 = -6 Sep). Letter A/B/C/D; A baseline; mọi delta so với A, không so period liền trước.
> 4. Toolbar khi compare: chip date đơn thay bằng dãy chip period — mỗi period 1 chip: badge letter (A xanh brand, B–D xám), range ngày, ký hiệu nét (baseline, – –, ·-·, -·-), chevron mở date picker riêng. Chip cuối (từ C) có ✕ bỏ period (compareCount--, min 2). Chip dashed "+ Add previous period" (ẩn khi đủ 4). Text "n periods · max 4". Nút swap (arrow-left-right) đảo thứ tự. Chip "Segment · Not selected" giữ (placeholder). Hàng 2 toolbar không đổi.
> 5. Chart: header thêm segmented Overlay|Split (chỉ hiện khi compare).
> 5.1 Overlay (default): mỗi series vẽ n đường cùng màu, phân biệt bậc tuổi: A stroke 2.4px op 1 liền; B 1.9px .68 dash 5 4; C 1.6px .46 dash 1 3; D 1.4px .30 dash 9 3 2 3. Hàng PERIODS: chip A–D kèm nét + range; click chip -> focusPeriod=k (period đó 2.6px op 1, khác .12); click lại bỏ. Hint "Click a period to isolate it · line weight fades with age". Legend: mỗi series 1 dòng, tổng từng period kèm nét. Tooltip (crosshair): header "Compare periods" + n cột ngày; mỗi dòng series với giá trị từng period và Δ% vs A (xanh #34d399 tăng, đỏ #f87171 giảm) TRƯỚC con số; footer ngày crosshair + "A solid, earlier periods dashed · Δ vs A"; width = 200 + n*96 px.
> 5.2 Split (khuyến nghị >=3 period): 1 panel/period hàng ngang flex:1 1 0; header panel badge letter + range + nét; chart nhỏ 132px, CHUNG thang y với overlay (cùng max); series nét liền phân biệt màu; footer panel: ngày đầu->cuối, tổng, Δ vs A (panel A ghi baseline); click panel -> Overlay với focusPeriod đó. Legend màu dưới dãy + note "n panels · shared y axis · Δ of all plotted series vs A".
> 5.3 Collapse: minimize ẩn chart, pill "Show chart ↗" giữa; comparison giữ nguyên khi ẩn.
> 6. Table: số cột = metrics × compareCount; mỗi metric n cột cùng tiêu đề, sub-header SEGMENT A…D. Cột A chỉ giá trị; B–D giá trị + dòng Δ% vs A (xanh #047857/đỏ #dc2626/xám #798290 nếu 0.00%). Totals chia A–D kèm delta, 1 dòng nowrap. Layout: cột tên ghim 300px (flex:0 0 300px), vùng số overflow-x:auto trên card, row min-width = 300 + metrics*n*118, cột số 118px, tên ellipsis, badge co, KHÔNG để tên bóp về 0. Sort: click bất kỳ cột A–D sort theo metric gốc (strip :A|:B|:C|:D), giữ CÙNG thứ tự row mọi period. Footer bảng: "Sep 12 — 18 vs Sep 5 — 11 vs …". Toggle #/% áp cột A; delta luôn % tương đối.
> 7. Backend: Users / % of all users KHÔNG cộng dồn giữa period — mỗi period query unique riêng. Delta = (value_k/value_A - 1)*100; value_A=0 thì hiện — thay vì Infinity. Period độ dài khác nhau (custom range) phải chuẩn hoá theo ngày trước khi so HOẶC chặn không cho chọn khác độ dài. Period tương lai / trước ngày bắt đầu tracking -> disable chip + "No data for this period".
> 8. Giới hạn: max 4 period (4 metrics × 4 = 16 cột đã scroll ngang). Không bật đồng thời compare-period và compare-segment. Không dùng màu khác cho period (màu mã hoá series; period = weight+opacity+dash). Dash một mình không đủ >=3 period -> lý do có Split + isolate.
> 9. Persist vào URL / saved report: compare, compareCount, compareView, focusPeriod, range từng period, sortKey (gồm hậu tố segment), metric đang plot.
> Design: page 'Event Analytics Comparison' (3a menu, 3b active 2 period, 3c chart+tooltip, 3d collapsed, 3e 4 period overlay, 3f 4 period split). Props: comparisonStage, comparePeriods, compareView, chartTooltip, chartCollapsed.
