# P2 — Profile filters via subselect

Spec: `docs/superpowers/specs/2026-09-16-event-analytics-phase2-design.md` §3 D1, §8 P2.

## Approach

In `getEventAnalyticsWhereClause`, a `profile.properties.*` condition is no
longer dropped. It is compiled by `compileEventFilter` exactly as the chart
compiles it (`profile.properties['k'] …`) and wrapped in an uncorrelated
subselect whose FROM aliases the profiles table as `profile`:

```sql
profile_id IN (SELECT id FROM profiles AS profile FINAL
               WHERE project_id = <escaped> AND <clause>)
```

The alias lets the unchanged per-filter output resolve against `profiles`
without any string rewriting, and `getPropertyMapAccess` already refuses to
emit `mapContains` for `profile.`-qualified refs, so numeric comparisons stay
guard-free. No profile CTE, `chart.service.ts` untouched.

## Steps

1. Red: rewrite the drop-pinning test to expect the subselect for every
   builder; add OR-group narrowing test; add no-`mapContains` assertion over
   every operator; extend the EXPLAIN test with profile filters (flat + group).
2. Green: replace the drop branch; update the doc comment.
3. Verify: `pnpm vitest run` on the test file (CH reachable, no skips),
   `pnpm -F @openpanel/db typecheck`.
