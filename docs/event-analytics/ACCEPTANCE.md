# Event Analytics — Biên bản nghiệm thu

Nhánh: `feature/event-analytics` @ `1b80807b` (merge PR #49)
Ngày đo: 2026-09-18 (mục Phase 3 và §3); các mục Phase 1–2 đo ngày 2026-09-17
Tài liệu kiến trúc đi kèm: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## 1. Tóm tắt

Tab **Events › Analytics** là báo cáo sự kiện kiểu AppMetrica: một **chart** và một **bảng dạng cây** cùng đọc một tập event đã lọc. Từ gốc event, người dùng mở dần xuống property key → value → nested key, tối đa 4 tầng. Mỗi tầng tải lười (chỉ query khi được mở) và có phân trang.

Tính năng đi từ spec tới ship qua **49 PR** merge vào `feature/event-analytics` trong 2026-09-15 → 2026-09-18, chia ba giai đoạn:

- **Phase 1** — cây sự kiện, chart, advanced filter AND/OR hai cấp.
- **Phase 2** — metric catalogue 11 cột (có metric theo parameter), lọc theo user property, lưu lựa chọn vào trình duyệt, chart khởi động nguội + thu gọn. Sau đó thêm một đợt sửa lỗi B1–B8.
- **Phase 3** — chip filter xuống dòng riêng, cold start áp lại khi đổi filter, và **Comparison mode**: so cùng một report giữa khoảng hiện tại và 1–3 khoảng trước, trên cả bảng lẫn chart.

Nguồn chân lý thiết kế:

| Tài liệu | Nội dung |
|---|---|
| `docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md` | Cây, contract §4, quyết định PA1 / R10 |
| `docs/superpowers/specs/2026-09-15-event-analytics-advanced-filters-design.md` | Advanced filter group, §5.4 quy tắc `map['key']` cho profile |
| `docs/superpowers/specs/2026-09-16-event-analytics-phase2-design.md` | Metrics, profile filter qua subselect, persistence, Appendix A định nghĩa AppMetrica |
| `docs/superpowers/specs/2026-09-18-event-analytics-phase3-design.md` | Comparison mode, contract `periods`, bất biến I10, Appendix A requirements nguyên văn |

> **Ghi chú về đánh số.** Bảng dưới lấy PR# từ `gh pr list --base feature/event-analytics --state merged`, không theo trí nhớ. Mã task (T0…T14, P0…P8, B1…B8) là mã orchestrator giao việc; một vài task không có PR riêng hoặc gộp vào PR khác, như ghi ở từng dòng.

## 2. Bảng công việc chi tiết

Cột **Bằng chứng** là file test đi kèm PR, lấy từ danh sách file của chính PR đó. Mọi test trong cột này đều chạy ở mục 3.

### 2.1 Wave 0 — contract

| PR | Task | Nội dung | File chính | Bằng chứng |
|---|---|---|---|---|
| #1 | T0 | Contract §4: 4 endpoint (list, totals, property keys, property values) bằng zod, cùng router stub trả dữ liệu mock tất định theo mẫu `tree` của design | `packages/validation/src/event-analytics.ts`, `packages/trpc/src/routers/overview.ts`, `overview.event-analytics-mock.ts` | `event-analytics.test.ts`, `overview.event-analytics-mock.test.ts` |
| #2 | T0.1 | Siết độ sâu: `EVENT_ANALYTICS_MAX_PARENT_PATH = 1` (key=1, value=2, nested key=3, value=4). Tách `zChartEventFilter` / `zRange` sang `chart-primitives.ts` để phá vòng import trong `packages/validation` | `chart-primitives.ts`, `event-analytics.ts` | `event-analytics.test.ts` |

### 2.2 Wave 1 — cây sự kiện (Phase 1)

| PR | Task | Nội dung | File chính | Bằng chứng |
|---|---|---|---|---|
| #9 | T1 | List + totals thật: phân trang `LIMIT n+1` để tính `nextCursor`, sort động, search `ILIKE` có escape `%` `_` `\`, totals `uniqExact` trên cùng lát event đã lọc (không bao giờ cộng nhánh) | `overview.service.ts` → `buildEventAnalyticsListQuery`, `buildEventAnalyticsTotalsQuery` | `event-analytics-sql.test.ts` |
| #6 | T2 | Property keys: `arrayJoin` + tách segment theo `.`, gom `kind: 'obj'` cho key còn tầng con, suy luận kiểu PA1 bằng `countIf` | `buildEventPropertyKeysQuery` | `event-property-keys-sql.test.ts` |
| #4 | T3 | Property values: `mapContains` + `parentPath`, tie-break `toFloat64OrNull(value)` cho kiểu `num`, `remaining` + `nextCursor` | `buildEventPropertyValuesQuery` | `event-property-values-sql.test.ts`, `event-property-values-paging.test.ts` |
| #5 | T4 | Bảng cây + toolbar: mở lười, load-more, icon/badge, header sort, search debounce, toggle `pct`, empty state, totals row + nhãn DEDUPLICATED | `event-tree-table.tsx`, `tree-nodes.tsx`, `tree-utils.ts` | `tree-utils.test.ts` |
| #8 | T5 | Chart panel: chọn metric, granularity, line/bar, series từ dòng được tick, giữ `startDate`/`endDate` đi cùng `range` | `chart.tsx`, `chart-input.ts` | `chart.test.ts` |
| #7 | T6 | R10: filter so sánh số dùng `toFloat64OrNull` kèm `mapContains`, nên giá trị thiếu hoặc không phải số **không bao giờ** khớp | `chart.service.ts` | `numeric-filter-sql.test.ts`, `chart-sql.test.ts` |
| #10 | T10 | Event Analytics bỏ `getRawWhereClause` (whitelist 21 cột âm thầm vứt `properties.*`), chuyển sang `getEventFiltersWhereClause` | `overview.service.ts` → `getEventAnalyticsWhereClause` | `event-analytics-filters.test.ts` |
| #11 | T8 | Fixture ClickHouse + integration test cho list / totals / keys / values ở 4 tầng | `event-analytics-fixtures.ts` | `event-analytics-integration.test.ts` |
| #15, #16 | T9 | Soát thị giác so với design: cuộn cột metric trên màn hẹp, chevron trước checkbox, padding 14 + depth×22 | `event-tree-table.tsx`, `tree-nodes.tsx`, `tree-utils.ts` | `tree-utils.test.ts` |

### 2.3 Advanced filters Phase 1

| PR | Task | Nội dung | File chính | Bằng chứng |
|---|---|---|---|---|
| #3 | T7 spec | Spec AND/OR group 2 cấp, `hasProperty` / `missingProperty`, cơ chế từ chối client cũ | `docs/superpowers/specs/…-advanced-filters-design.md` | (spec) |
| #13 | T7 backend | Schema group 2 cấp bằng **hình dạng** (sub-group chỉ nhận condition). Tách `compileEventFilter` / `compileTableFilter`. Walker `compileFilterGroup`. Presence `map['key'] != ''`, không `mapContains`. Từ chối report `schemaVersion: 2` | `filter-group.ts`, `filter-group.service.ts`, `chart.service.ts`, `filter-where.service.ts`, `reports.service.ts`, `packages/constants/index.ts` | `filter-group.test.ts`, `presence-operators.test.ts`, `filter-group-sql.test.ts`, `presence-filter-sql.test.ts`, `profile-property-presence.test.ts`, `event-analytics-group-sql.test.ts`, `advanced-filter-refusal.test.ts` |
| #14 | T7 UI | Panel Advanced filters theo artboard 1c, param URL `fg`, staged apply | `advanced-filters-panel.tsx`, `advanced-filters-state.ts`, `use-event-query-filters.ts` | `advanced-filters-state.test.ts` |

### 2.4 Phase 2 — metrics, profile filter, persistence

| PR | Task | Nội dung | File chính | Bằng chứng |
|---|---|---|---|---|
| #17 | spec | Spec Phase 2 R1–R5, Appendix A nguyên văn định nghĩa AppMetrica | `docs/superpowers/specs/…-phase2-design.md` | (spec) |
| #18 | P0 | Metric catalogue 11 metric, `metricKey`, `superRefine` (param bắt buộc/cấm, trùng key, `events` bắt buộc, tối đa 10), `sort` mở thành string có kiểm, preferences schema | `packages/validation/src/event-analytics.ts` | `event-analytics-metrics.test.ts` |
| #22 | P2 | Lọc theo `profile.*` bằng subselect `profiles FINAL`, không qua CTE join | `getEventAnalyticsWhereClause` | `event-analytics-filters.test.ts`, `event-analytics-group-sql.test.ts` |
| #21 | P1 | SQL cho metric: `coalesce(toFloat64OrNull(...), 0)`, `quantileExact`, alias `metric_<i>`, sort động | `eventAnalyticsMetricSelects`, `eventAnalyticsSortColumn` | `event-analytics-metrics-sql.test.ts`, `event-analytics-sort-mapping.test.ts` |
| #19 | P4 | Lưu view vào localStorage theo project, có version, sai schema thì vứt cả entry, ghi debounce 300 ms | `use-event-analytics-prefs.ts` | `event-analytics-prefs.test.ts` |
| #20 | P3 | Chart khởi động nguội (chọn `min(5, n)` event, một lần mỗi mount), nút thu gọn + pill `Show chart` | `chart-cold-start.ts`, `chart.tsx` | `chart-cold-start.test.ts` |
| #24 | P5 | Metrics dialog: chip kéo thả, `Events` khoá, catalogue tìm kiếm được, dropdown parameter, `x of 10` | `metrics-dialog.tsx`, `metrics-state.ts` | `metrics-state.test.ts` |
| #26 | P6 | Cột bảng theo metric đã chọn, header wrap, 132px khi quá 4 cột, totals theo metric | `event-tree-table.tsx`, `tree-nodes.tsx`, `tree-utils.ts` | `tree-utils.test.ts` |
| #25 | P7 | Select metric của chart đi theo bộ metric đã chọn | `chart-input.ts`, `chart.tsx` | `chart.test.ts` |
| #27 | P8 | Integration test cả 11 metric trên ClickHouse theo ngữ nghĩa missing = 0 | `event-analytics-fixtures.ts` | `event-analytics-integration.test.ts` |
| #29 | P9 | Khớp type scale và nút accent của design Phase 2 | `advanced-filters-panel.tsx`, `chart.tsx`, `metrics-dialog.tsx` | (thị giác, không có test) |

### 2.5 Hạ tầng build

| PR | Task | Nội dung |
|---|---|---|
| #12 | T11 | Khai `@types/node` trong 3 app để `pnpm typecheck` toàn repo chạy được |
| #23 | T12 | Typecheck bằng TypeScript 7 native, chuyển `baseUrl` |
| #28 | T13 | Hook pre-push chỉ chạy typecheck |
| #31 | B2 | Đăng ký kiểu router đã await, typecheck `apps/start` bằng TypeScript 7 |
| #32 | B4 | Chuyển 7 package cuối sang TypeScript 7 |

Các PR hạ tầng không có test riêng; bằng chứng là `pnpm typecheck` toàn repo EXIT=0 ở mục 3.

### 2.6 Đợt sửa lỗi B

| PR | Task | Nội dung | File chính | Bằng chứng |
|---|---|---|---|---|
| #30 | B1 | Mở lại category `profile` trong panel + toolbar. Chặn wildcard profile key không hợp lệ | `advanced-filters-panel.tsx`, `overview-filters.tsx`, `overview.service.ts` | `event-analytics-filters.test.ts` |
| #33 | B5 | Wildcard khớp **mọi** segment, kể cả map profile: `transformPropertyKey` xử lý giữa / cuối / `[*]` / nhiều / kề nhau | `chart.service.ts` → `transformPropertyKey` | `wildcard-property-key.test.ts`, `property-key-escaping.test.ts`, `event-analytics-filters.test.ts` |
| #34 | B3 | 6 segment chart `*_missing_zero` tính giống hệt bảng. Chart vẽ được 9/11 metric | `chart.service.ts`, `chart-input.ts` → `chartSegmentFor`, `packages/constants/index.ts` | `event-analytics-chart-segments.test.ts`, `chart-segment-sql.test.ts` (+ snapshot ghim SQL mọi segment cũ), `chart.test.ts` |
| #35 | B8 | Ghim bất biến: `getAggregateChartSql` trả **một bucket** cho mỗi serie, nên tổng của metric không cộng dồn không bị cộng từ các bucket | `chart.service.ts` | `event-analytics-aggregate-bucket.test.ts` |
| #36 | B7 | Chart tuân theo filter group, cho ra cùng tập event với bảng. Dùng chung `compileEventAnalyticsFilter`, và engine chuyển được `filterGroup` tới SQL | `chart.service.ts`, `engine/fetch.ts`, `engine/index.ts`, `chart-input.ts` | `chart-filter-group-parity.test.ts` (ClickHouse thật), `chart-filter-group-sql.test.ts`, `chart-query-event.test.ts`, `report-filter-group.test.ts`, `chart.test.ts` |


### 2.7 Phase 3 — comparison mode

| PR | Task | Nội dung | File chính | Bằng chứng |
|---|---|---|---|---|
| #40 | P0 (R1+R2) | Chip filter tách xuống hàng riêng; cold start **áp lại** khi apply filter — xoá lựa chọn cũ và chọn top 5 của danh sách đã lọc, kể cả lựa chọn người dùng tự tick | `filter-row.ts`, `chart-cold-start.ts`, `advanced-filters-panel.tsx`, route | `filter-row.test.ts`, `chart-cold-start.test.ts` |
| #41 | P1 (T3, T3.1, T4) | Contract `periods` 1–4 (cùng độ dài, không chồng nhau); helper ngày thuần; SQL nhiều period bằng `countIf` / `uniqExactIf` / `sumIf` / `quantileExactIf` trên **một** lần quét khoảng hợp nhất | `event-analytics.ts`, `periods.ts`, `overview.service.ts` | `event-analytics-periods.test.ts`, `periods.test.ts`, `event-analytics-periods-sql.test.ts` |
| #42 | T5 | Trạng thái comparison + toolbar: nút, menu 3a, dãy chip period, add/remove/swap, Cancel; param URL `cmp`/`cmpn`/`cmpv`/`cmpf` | `comparison-state.ts`, `comparison-toolbar.tsx`, `use-event-query-filters.ts`, route | `comparison-state.test.ts` |
| #43 | T7 | Chart overlay: n query dịch ngày ghép theo chỉ số bucket, nét theo bậc tuổi, hàng PERIODS + isolate, tooltip so sánh | `comparison-chart.ts`, `chart.tsx`, `chart-input.ts` | `comparison-chart.test.ts`, `chart.test.ts` |
| #44 | T6 | Bảng comparison: cột × period, sub-header `SEGMENT A…D`, delta vs A, cột tên ghim 300px + cột số 118px + cuộn ngang | `comparison-columns.ts`, `event-tree-table.tsx`, `tree-nodes.tsx` | `comparison-columns.test.ts` |
| #45 | T8 | Split view: một panel mỗi period, chung thang y, footer có tổng và Δ vs A, click panel quay về overlay | `comparison-chart.ts`, `chart.tsx` | `comparison-chart.test.ts` |
| #46 | T4-fix | Hai bug SQL comparison: dòng không theo period A, và hai hệ thời gian trong một query | `overview.service.ts` | `event-analytics-periods-sql.test.ts` + bộ T9 |
| #47 | T9 | Integration test nhiều period trên ClickHouse, số tính tay, user trùng giữa các period | `event-analytics-fixtures.ts` | `event-analytics-periods.test.ts` |
| #48 | T10 | Soát thị giác 3a–3f + 4 sửa: giữ focus period, nhãn trục, tooltip trong khung | `chart.tsx`, `comparison-chart.ts`, `comparison-state.ts`, `periods.ts` | `comparison-chart.test.ts`, `comparison-state.test.ts`, `periods.test.ts` |
| #49 | T4-fix-2 | Property keys/values **chạy được** trong comparison: mang `created_at` qua cả ba CTE, `ORDER BY` theo `events_p0` | `overview.service.ts` | `event-analytics-property-periods.test.ts` |

### 2.8 Bài học: hai chuỗi bắt bug, và vì sao chúng bắt được

Phase 3 có hai lần một defect lọt qua nhiều lớp test rồi bị bắt bởi **thứ khác hẳn**. Cả hai đều đáng ghi, vì cùng chỉ ra một điều: test khẳng định *chuỗi SQL* không thay được test *chạy SQL*.

**Chuỗi 1 — T9 → T4-fix (#47 → #46).** Integration test với số tính tay bắt hai bug trong SQL comparison mà toàn bộ test SQL-shape trước đó cho qua:

- **Dòng lạc period.** `GROUP BY` chạy trên khoảng hợp nhất mà không giới hạn theo A, nên một event chỉ period B thấy vẫn thành dòng, cột baseline rỗng — và tệ hơn, nó **chiếm một chỗ trong trang**: sort tăng dần `limit 2` trả `['tutorial_step', 'booster_use']` trong khi request một period trả `['booster_use', 'ads_inter_shown']`. Sửa bằng `HAVING events_p0 > 0`, chạy trước `ORDER BY` / `LIMIT` / `OFFSET`.
- **Event nhảy period.** Khoảng bao đi qua `clix.datetime` (đổi sang UTC) còn điều kiện period viết `toDateTime` thô theo giờ local: hai hệ thời gian trong **một** query. Ở UTC+7 một event lúc 20:00 nằm trong range nhưng ngoài period A. Acceptance chính là test của T9, và nó chỉ đỏ trên máy UTC+7 — trên CI chạy UTC nó xanh vô hại.

Vì thế khi sửa còn thêm một test **SQL-shape** khẳng định period bound dùng đúng dạng đã chuyển đổi như range bound. Trong lúc viết nó phát hiện **hai assertion cũ của chính tác giả đang che bug**: chúng ghim chuỗi datetime hardcode, chỉ đúng trên máy UTC. Loại test "xanh trên CI, đỏ trên máy dev" còn tệ hơn không có test.

**Chuỗi 2 — phát hiện khi viết tài liệu, đã sửa #49.** Trong lúc viết mục §3 của `ARCHITECTURE.md`, quy trình "trích SQL bằng cách **chạy** builder rồi chạy luôn SQL đó trên ClickHouse" làm lộ một bug chặn người dùng: mở một property node khi comparison đang bật thì query vỡ với `Code: 47 Unknown expression or function identifier 'created_at'`.

- Nguyên nhân: các aggregate theo period đọc `created_at` ở SELECT ngoài cùng, cách bảng events vài tầng CTE, mà **CTE chỉ lộ ra cột nó select**. Query keys nối ba CTE (`base_events` → `matched_keys` → `segments`) nên cả ba đều phải mang; query values nối một CTE và cùng bệnh.
- Bug thứ hai nấp sau bug thứ nhất: `ORDER BY events` trong query keys, trong khi comparison đổi tên cột thành `events_p0` — chỉ lộ ra sau khi sửa cái đầu.
- Đường đi thật: `tree-nodes.tsx` spread `ctx.input` vào `eventPropertyKeys`, và `ctx.input` mang `periods` khi comparison bật. Tức lỗi chạm người dùng, không chỉ qua API.
- Hai lỗ hổng ghép lại: test SQL-shape chỉ assert chuỗi (chuỗi **đúng**, server mới là bên từ chối), và integration T9 chỉ gọi `list` + `totals` với `periods`, không bao giờ gọi `eventPropertyKeys` / `eventPropertyValues`. 7 test chạy thật trong `event-analytics-property-periods.test.ts` bịt cả hai.

Rút ra, viết thành quy tắc cho người sau:

1. **Mỗi endpoint nhận `periods` phải có ít nhất một test chạy thật trên ClickHouse.** Test chuỗi không thấy `Unknown identifier`.
2. **Test ghim thời gian không được hardcode datetime literal** — so với chính phép chuyển mà builder dùng (`clix.datetime`), nếu không nó chỉ đúng ở một múi giờ.
3. **Khi viết tài liệu, chạy SQL trích được**, đừng chỉ đọc. Hai lần trong dự án này việc đó bắt được bug mà không lớp test nào bắt.

## 3. Trạng thái nghiệm thu

Chạy thật ngày 2026-09-17 trên `69dc1f4d`, sau `pnpm install` và `pnpm codegen`. Output bên dưới là trích nguyên văn các dòng tổng kết.

### 3.1 Typecheck toàn repo

```
$ pnpm typecheck        # pnpm -r --no-bail typecheck
Scope: 34 of 35 workspace projects
...
apps/api typecheck: Done
apps/start typecheck: Done
EXIT=0
```

31 dòng `typecheck: Done`, 0 dòng `error TS`. (Đo lại 2026-09-18 trên bản Phase 3; số giống lần đo Phase 2.)

### 3.2 Test backend

```
$ pnpm vitest run packages/db packages/validation packages/trpc
 Test Files  1 failed | 55 passed (56)
      Tests  818 passed | 8 skipped (826)
```

**0 test fail.** File duy nhất bị đánh dấu failed là `retention.service.test.ts` với `Hook timed out in 10000ms` dưới tải song song, kéo theo 8 test skip — xem §3.4. Chạy riêng file đó thì 11/11 xanh. Các test gated ClickHouse (integration, parity, aggregate bucket, retention) đều **chạy thật** trên container local.

### 3.3 Test UI Event Analytics

```
$ pnpm exec vitest run --config apps/start/src/components/event-analytics/vitest.config.ts
 Test Files  11 passed (11)
      Tests  229 passed (229)
EXIT=0
```

Phase 3 thêm 5 file test thuần: `comparison-state`, `comparison-columns`, `comparison-chart`, `periods`, `filter-row`.

`apps/start` không nằm trong vitest workspace gốc và không có setup React testing. Vì thế logic được tách vào helper thuần (`tree-utils.ts`, `chart-input.ts`, `metrics-state.ts`, `advanced-filters-state.ts`, `chart-cold-start.ts`) và test ở đó. Phần render được soát bằng mắt ở T9.

### 3.4 Flaky đã biết

`packages/db/src/services/retention.service.test.ts` đôi khi đỏ với `Hook timed out in 10000ms` khi cả bộ chạy song song, kéo theo 8 test skip. Chạy riêng file đó thì 11/11 xanh, và lỗi tái hiện y hệt trên base khi không có thay đổi nào. Trong lần đo mục 3.2 nó **không** tái hiện. Đây là test gated ClickHouse phản ứng với tải, không liên quan Event Analytics.

## 4. Giới hạn đã biết và backlog mở

### 4.1 Giới hạn có chủ đích

| # | Giới hạn | Vì sao chấp nhận | Đường nâng cấp |
|---|---|---|---|
| L1 | `epau` và `pctu` không vẽ được trên chart. Select hiển thị `· not in chart: needs all users per interval` | Mẫu số là toàn bộ user **trong từng bucket**. Không segment nào tính được, vì `totals.users` chỉ có ở cấp query | Thêm totals theo từng bucket vào chart query |
| L2 | Có hai metric "events per user": `epu` chia cho user **có event** (hành vi Phase 1), `epau` chia cho **toàn bộ** user (định nghĩa AppMetrica) | Đổi mẫu số của một cột người dùng đã đọc là thay đổi hiển thị gây mất tin cậy. Giữ cả hai, help text nói rõ mẫu số | — (quyết định sản phẩm, spec Phase 2 Appendix A.1) |
| L3 | PA1 suy luận kiểu khi đọc: một key là `num` khi **mọi** giá trị không rỗng parse được số | Không cần đổi ingest hay migration | Ceiling: `"5"` và `5` không phân biệt được; key trộn chuỗi và số có thể đổi kiểu theo khoảng thời gian. Nâng cấp PA2: cột `property_types` lúc ingest |
| L4 | Key mà mọi giá trị đều rỗng được xếp `num` | Có chủ đích: `countIf(v != '' AND toFloat64OrNull(v) IS NULL)` bằng 0 khi không có giá trị nào, và kiểu `num` chỉ ảnh hưởng thứ tự sort, không làm sai số | — |
| L5 | ~~Wildcard profile key bị **drop** ở Event Analytics (B1)~~ **Không còn (#33)** | B5 sửa gốc `transformPropertyKey` và gỡ guard B1: wildcard profile key giờ đi qua subselect profile và khớp đúng | — |
| L6 | Hook `.husky/gitnexus-pre-commit` / `gitnexus-analyze` báo "No such file or directory" khi commit | Đây là cấu hình GitNexus **cục bộ trên máy user**, không nằm trong repo. Commit vẫn thành công | Không thuộc phạm vi repo |
| L7 | Profile key vừa là điều kiện trong group vừa là breakdown/metric: `rewriteProfilePropertyRefs` viết đè bên trong subselect | Chart Event Analytics không bao giờ breakdown hay đo theo profile property. Lỗi **ồn ào** (ClickHouse code 48), không ra số sai | Bảo vệ clause group khỏi rewrite (comment `ponytail:` trong `chart.service.ts`) |
| L9 | Comparison chỉ bật được với range có số ngày cố định (`today`, `yesterday`, `7d`, `30d`, hoặc khoảng tuỳ chọn) | Tháng không phải số ngày hằng, nên bước lùi period sẽ phá bất biến I10 | Nút Comparison **ẩn** ở những range khác (`baselinePeriod` trả `null`), thay vì hiện rồi so hai khoảng khác độ dài |
| L10 | Date picker của từng chip period chỉ đổi **vị trí**, không đổi độ dài | I10: mọi period phải cùng số ngày | Cho đổi độ dài thì phải chuẩn hoá số liệu theo ngày, và khi đó nhãn cột không còn đúng nghĩa |
| L8 | `globalFilters` bị `filterGroup` ghi đè | Chart Event Analytics không gửi global filter. Khi root là OR thì không gộp được mà vẫn giữ tối đa 2 cấp | Quyết định lúc chuyển report editor sang group |

### 4.2 Backlog mở

| # | Mục | Chi tiết |
|---|---|---|
| K1 | **B6 — các surface advanced filters còn lại** | Mới có Event Analytics (bảng + chart) dùng group. Danh sách call site cần chuyển nằm ở spec advanced filters §10 Phase 2: chart editor, funnel, conversion, sankey, retention, overview widgets, sessions, profiles, cohorts. **Cohort phải làm cuối**, vì `cohort.validation.ts` giữ bản sao riêng của `zChartEventFilter` để tránh vòng import. Mỗi surface cần sửa đủ 3 tầng như B7: schema API, chỗ engine dựng lại event, SQL builder |
| K2 | ~~Wildcard ở đầu key làm crash query~~ **Đã xử lý (#38)** | `transformPropertyKey` coi `*` đứng đầu key là segment: `*.sku -> %.sku`, `* -> %` (khớp mọi key); có test ma trận + EXPLAIN + ClickHouse thật |
| K3 | ~~Procedure cũ `overview.eventAnalytics` còn trong router~~ **Đã xử lý (#38)** | Đã xoá procedure, `buildEventAnalyticsQuery`, `zGetEventAnalyticsInput` và mock Wave 0; grep toàn repo không còn caller |
| K5 | ~~Property keys/values vỡ trong comparison~~ **Đã xử lý (#49)** | `Code: 47 Unknown expression … created_at`: aggregate theo period đọc `created_at` cách bảng events vài tầng CTE. Cả ba CTE của query keys và một CTE của query values nay mang cột đó, chỉ khi có comparison; `ORDER BY` đổi sang `events_p0`. Phát hiện khi viết tài liệu này — xem §2.8 |
| K4 | Chart query profile qua CTE join cho mọi surface **ngoài** Event Analytics | Event có `profile_id` mà không có dòng trong `profiles` sẽ thoả `missingProperty` / `isNot` khi đi qua `LEFT ANY JOIN`. Event Analytics đã tránh được (luôn gửi group). Các surface khác vẫn mang hành vi này — cần quyết định khi làm K1 |
