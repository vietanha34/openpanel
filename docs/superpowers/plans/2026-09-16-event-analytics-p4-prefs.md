# Event Analytics P4 — Persisted Preferences Implementation Plan

> Executed inline in one AO worker session (no sub-agents). Steps use checkbox syntax.

**Goal:** Persist the Event Analytics view preferences per project in localStorage (spec §6, R5).

**Architecture:** Pure `readEventAnalyticsPrefs` / `writeEventAnalyticsPrefs` take a `Storage`-like object so they run under vitest without a DOM. `useEventAnalyticsPrefs(projectId)` loads after mount (the route is SSR-rendered, so `localStorage` is unavailable on the first render), exposes a `status` of `loading | absent | stored`, and writes debounced. The route wires only `selected` now; sort / pct / chart / metrics are wired by P5–P7, which own those components.

**Tech Stack:** React 19, zod (`zEventAnalyticsPreferences`, `eventAnalyticsPrefsKey` from `@openpanel/validation`), vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-event-analytics-phase2-design.md` §6, §7, §8 P4.

## Global Constraints

- Key: `op:event-analytics:v1:<projectId>` (use `eventAnalyticsPrefsKey`).
- Invalid entry (bad JSON, unknown version, unknown metric, schema failure) is discarded wholesale; no partial recovery.
- Not persisted: filters, filter group, date range, search, expanded nodes (A13).
- "No entry" (`absent`) must be distinguishable from "entry with `selected: []`" (`stored`).
- Never run `pnpm format`; never commit `packages/geo/src/datacenter-asns.ts` or `.claude-flow/*`.

---

### Task 1: Pure read/write/validate

**Files:**
- Create: `apps/start/src/hooks/use-event-analytics-prefs.ts` (pure helpers + hook; no `@/` imports so vitest can load it without aliases)
- Test: `apps/start/src/components/event-analytics/event-analytics-prefs.test.ts` — placed here because the only vitest config covering `apps/start` is `apps/start/src/components/event-analytics/vitest.config.ts` with `include: ['*.test.ts']` rooted at that folder; `apps/start` is excluded from the root workspace.

**Produces:**
- `readEventAnalyticsPrefs(storage: Pick<Storage, 'getItem'>, projectId: string): IEventAnalyticsPreferences | null` — `null` = nothing usable stored.
- `writeEventAnalyticsPrefs(storage: Pick<Storage, 'setItem'>, projectId: string, prefs: IEventAnalyticsPreferences): void` — swallows quota / private-mode errors.
- `DEFAULT_EVENT_ANALYTICS_PREFS: IEventAnalyticsPreferences`.

- [ ] Write failing tests: absent key → null; valid round-trip; empty `selected` round-trips as `[]`; corrupt JSON, wrong version, unknown metric id, missing field, sort key not among stored metrics → null; per-project isolation; throwing storage → null / no throw.
- [ ] Run `pnpm exec vitest run --config apps/start/src/components/event-analytics/vitest.config.ts` → FAIL.
- [ ] Implement helpers → PASS. Commit.

### Task 2: Hook + route wiring

**Files:**
- Modify: `apps/start/src/hooks/use-event-analytics-prefs.ts`
- Modify: `apps/start/src/routes/_app.$organizationId.$projectId.events._tabs.analytics.tsx`

**Produces:** `useEventAnalyticsPrefs(projectId) => { status: 'loading' | 'absent' | 'stored'; prefs: IEventAnalyticsPreferences; update(patch: Partial<Omit<IEventAnalyticsPreferences, 'version'>>): void }`. `update` is a no-op while `loading` (so an early write cannot clobber the stored entry); pending writes flush on project switch / unmount.

- [ ] Implement hook; route restores `selected` once when `status === 'stored'` and calls `update({ selected })` on change after load.
- [ ] `pnpm -F start typecheck` (after `pnpm install && pnpm codegen`); rerun tests. Commit.
