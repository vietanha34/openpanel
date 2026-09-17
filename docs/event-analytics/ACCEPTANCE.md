# Event Analytics — Biên bản nghiệm thu

Nhánh: `feature/event-analytics` @ `69dc1f4d` (merge PR #36)
Ngày đo: 2026-09-17
Tài liệu kiến trúc đi kèm: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## 1. Tóm tắt

Tab **Events › Analytics** là báo cáo sự kiện kiểu AppMetrica: một **chart** và một **bảng dạng cây** cùng đọc một tập event đã lọc. Từ gốc event, người dùng mở dần xuống property key → value → nested key, tối đa 4 tầng. Mỗi tầng tải lười (chỉ query khi được mở) và có phân trang.

Tính năng đi từ spec tới ship qua **36 PR** merge vào `feature/event-analytics` trong 2026-09-15 → 2026-09-16, chia hai giai đoạn:

- **Phase 1** — cây sự kiện, chart, advanced filter AND/OR hai cấp.
- **Phase 2** — metric catalogue 11 cột (có metric theo parameter), lọc theo user property, lưu lựa chọn vào trình duyệt, chart khởi động nguội + thu gọn. Sau đó thêm một đợt sửa lỗi B1–B8.

Nguồn chân lý thiết kế:

| Tài liệu | Nội dung |
|---|---|
| `docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md` | Cây, contract §4, quyết định PA1 / R10 |
| `docs/superpowers/specs/2026-09-15-event-analytics-advanced-filters-design.md` | Advanced filter group, §5.4 quy tắc `map['key']` cho profile |
| `docs/superpowers/specs/2026-09-16-event-analytics-phase2-design.md` | Metrics, profile filter qua subselect, persistence, Appendix A định nghĩa AppMetrica |

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

31 dòng `typecheck: Done`, 0 dòng `error TS`.

### 3.2 Test backend

```
$ pnpm vitest run packages/db packages/validation packages/trpc
 Test Files  53 passed (53)
      Tests  794 passed (794)
EXIT=0
```

Không test nào bị skip. Các test gated ClickHouse (integration, parity, aggregate bucket, retention) đều **chạy thật** trên container local.

### 3.3 Test UI Event Analytics

```
$ pnpm exec vitest run --config apps/start/src/components/event-analytics/vitest.config.ts
 Test Files  6 passed (6)
      Tests  122 passed (122)
EXIT=0
```

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
| L5 | Wildcard profile key không hợp lệ bị **drop** ở Event Analytics (B1) thay vì báo lỗi | Tránh query crash từ một filter người dùng không sửa được | Báo lỗi tường minh ở UI |
| L6 | Hook `.husky/gitnexus-pre-commit` / `gitnexus-analyze` báo "No such file or directory" khi commit | Đây là cấu hình GitNexus **cục bộ trên máy user**, không nằm trong repo. Commit vẫn thành công | Không thuộc phạm vi repo |
| L7 | Profile key vừa là điều kiện trong group vừa là breakdown/metric: `rewriteProfilePropertyRefs` viết đè bên trong subselect | Chart Event Analytics không bao giờ breakdown hay đo theo profile property. Lỗi **ồn ào** (ClickHouse code 48), không ra số sai | Bảo vệ clause group khỏi rewrite (comment `ponytail:` trong `chart.service.ts`) |
| L8 | `globalFilters` bị `filterGroup` ghi đè | Chart Event Analytics không gửi global filter. Khi root là OR thì không gộp được mà vẫn giữ tối đa 2 cấp | Quyết định lúc chuyển report editor sang group |

### 4.2 Backlog mở

| # | Mục | Chi tiết |
|---|---|---|
| K1 | **B6 — các surface advanced filters còn lại** | Mới có Event Analytics (bảng + chart) dùng group. Danh sách call site cần chuyển nằm ở spec advanced filters §10 Phase 2: chart editor, funnel, conversion, sankey, retention, overview widgets, sessions, profiles, cohorts. **Cohort phải làm cuối**, vì `cohort.validation.ts` giữ bản sao riêng của `zChartEventFilter` để tránh vòng import. Mỗi surface cần sửa đủ 3 tầng như B7: schema API, chỗ engine dựng lại event, SQL builder |
| K2 | ~~Wildcard ở đầu key làm crash query~~ **Đã xử lý (#38)** | `transformPropertyKey` coi `*` đứng đầu key là segment: `*.sku -> %.sku`, `* -> %` (khớp mọi key); có test ma trận + EXPLAIN + ClickHouse thật |
| K3 | ~~Procedure cũ `overview.eventAnalytics` còn trong router~~ **Đã xử lý (#38)** | Đã xoá procedure, `buildEventAnalyticsQuery`, `zGetEventAnalyticsInput` và mock Wave 0; grep toàn repo không còn caller |
| K4 | Chart query profile qua CTE join cho mọi surface **ngoài** Event Analytics | Event có `profile_id` mà không có dòng trong `profiles` sẽ thoả `missingProperty` / `isNot` khi đi qua `LEFT ANY JOIN`. Event Analytics đã tránh được (luôn gửi group). Các surface khác vẫn mang hành vi này — cần quyết định khi làm K1 |
