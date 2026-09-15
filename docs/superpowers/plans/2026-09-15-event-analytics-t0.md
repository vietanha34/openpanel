# Event Analytics T0 — Contract + Router Stubs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the shared zod/TS contract for the Event Analytics tree and four tRPC procedures that return deterministic mock data, so Wave 1 frontend and backend tasks can start in parallel.

**Architecture:** `packages/validation/src/event-analytics.ts` holds the zod input schemas and inferred types from spec §4, re-exported from the validation barrel like its sibling modules. `packages/trpc/src/routers/overview.ts` gains four `overviewProcedure` queries that delegate to pure functions in a colocated module holding the design file's `tree` sample. The pure functions do the paging/sorting/filtering so they can be unit tested without a tRPC context or a ClickHouse connection.

**Tech Stack:** zod, tRPC v11, vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md` (sections 3 and 4 are binding)

## Global Constraints

- The contract in spec §4 is binding character for character: procedure names `eventAnalyticsList`, `eventAnalyticsTotals`, `eventPropertyKeys`, `eventPropertyValues`; input field names; output shapes. If it does not work, stop and report — do not change it.
- Keep the existing `overview.eventAnalytics` procedure untouched.
- Defaults: list `limit` 10, property keys `limit` 20, property values `limit` 5.
- Depth limit: 4 levels below the event (`parentPath` length).
- NEVER run `pnpm format` or any formatter (project rule in `.claude/CLAUDE.md`).
- Verify with `pnpm vitest run <path>` and `pnpm typecheck`.

## File Structure

- Create `packages/validation/src/event-analytics.ts` — zod inputs + inferred types for the four endpoints.
- Modify `packages/validation/src/index.ts` — add `export * from './event-analytics';` next to its siblings.
- Create `packages/validation/src/event-analytics.test.ts` — schema defaults/validation tests.
- Create `packages/trpc/src/routers/overview.event-analytics-mock.ts` — the design's `tree` sample plus pure resolver functions.
- Create `packages/trpc/src/routers/overview.event-analytics-mock.test.ts` — paging/sort/search/parentPath tests.
- Modify `packages/trpc/src/routers/overview.ts` — four `overviewProcedure` queries delegating to the mock module.

---

### Task 1: Validation contract

**Files:**
- Create: `packages/validation/src/event-analytics.ts`
- Modify: `packages/validation/src/index.ts`
- Test: `packages/validation/src/event-analytics.test.ts`

**Interfaces:**
- Consumes: `zChartEventFilter`, `zRange` from `./index`.
- Produces: `zEventAnalyticsRange`, `zEventAnalyticsListInput`, `zEventAnalyticsTotalsInput`, `zEventPropertyKeysInput`, `zEventPropertyValuesInput`, `zEventAnalyticsSortKey`, `zEventAnalyticsSortDir`, `zEventAnalyticsPropertyType`, and types `IEventAnalyticsRange`, `IEventAnalyticsListInput`, `IEventAnalyticsTotalsInput`, `IEventPropertyKeysInput`, `IEventPropertyValuesInput`, `IEventAnalyticsMetricRow`, `IEventAnalyticsListRow`, `IEventAnalyticsListOutput`, `IEventPropertyKeyRow`, `IEventPropertyKeysOutput`, `IEventPropertyValueRow`, `IEventPropertyValuesOutput`, `IEventAnalyticsParentPathItem`.

- [ ] **Step 1: Write the failing test** covering: list input applies `limit` default 10; keys input default 20; values input default 5; `parentPath` longer than 4 entries is rejected; `sort`/`dir` enums reject junk; `startDate`/`endDate` accept `null`.
- [ ] **Step 2: Run** `pnpm vitest run packages/validation/src/event-analytics.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** the schemas exactly as spec §4 and add the barrel export.
- [ ] **Step 4: Run** the same command → PASS, then `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(validation): add event analytics tree contract`.

### Task 2: Mock tree resolvers

**Files:**
- Create: `packages/trpc/src/routers/overview.event-analytics-mock.ts`
- Test: `packages/trpc/src/routers/overview.event-analytics-mock.test.ts`

**Interfaces:**
- Consumes: the types from Task 1.
- Produces: `mockEventAnalyticsList(input)`, `mockEventAnalyticsTotals()`, `mockEventPropertyKeys(input)`, `mockEventPropertyValues(input)` returning the spec §4 output shapes.

- [ ] **Step 1: Write the failing test**: default limit pages the 8 sample events into 8 rows with `nextCursor: null`; `limit: 3` yields `nextCursor: 3` and cursor 6 yields `nextCursor: null`; `sort: 'users', dir: 'asc'` orders ascending; `search: 'ads'` matches only the two ad events; totals are `{ events: 2492498, users: 25072 }` (sum of sample event rows, unique users from the design, not a branch sum); `eventPropertyKeys` with `prefix: ''` on `level_start` returns `level_id`/`level_mode`/`payload` with `payload` as `kind: 'obj'`, `type: 'unknown'`; `prefix: 'payload.'` returns the two nested keys; `eventPropertyValues` on `level_id` returns 5 rows by default with `remaining: 1249` and a `nextCursor`; `parentPath: [{ key: 'level_mode', value: 'hard' }]` narrows to that branch's leaves.
- [ ] **Step 2: Run** `pnpm vitest run packages/trpc/src/routers/overview.event-analytics-mock.test.ts` → FAIL.
- [ ] **Step 3: Implement** the `tree` sample transcribed from `EventAnalyticsScreen.dc.html` plus the four pure functions (sort → search → slice `cursor..cursor+limit`, `nextCursor` when more remain).
- [ ] **Step 4: Run** the test → PASS.
- [ ] **Step 5: Commit** `feat(trpc): add event analytics mock tree resolvers`.

### Task 3: Router procedures

**Files:**
- Modify: `packages/trpc/src/routers/overview.ts`

**Interfaces:**
- Consumes: Task 1 schemas, Task 2 resolvers.
- Produces: `overview.eventAnalyticsList`, `overview.eventAnalyticsTotals`, `overview.eventPropertyKeys`, `overview.eventPropertyValues`.

- [ ] **Step 1:** Add the four `overviewProcedure` queries directly after the existing `eventAnalytics` procedure, each `.input(zX.extend({ shareId: z.string().optional() }))` and returning the matching mock resolver. Leave `eventAnalytics` untouched. Do not add `cacher` (mock data, and caching would hide Wave 1 swaps).
- [ ] **Step 2: Run** `pnpm typecheck` → PASS.
- [ ] **Step 3: Commit** `feat(trpc): add event analytics tree procedures returning mock data`.
