# B1 — Offer profile filters in Event Analytics, guard wildcard profile keys

Completes R2. P2 (#22) made `getEventAnalyticsWhereClause` resolve
`profile.properties.*` through a subselect, but both filter pickers still hide
the `profile` category, so nobody can create one.

## Findings before editing

1. **The picker cannot produce a wildcard profile key.** Profile keys come from
   `getProfilePropertyKeysCached` verbatim (`chart.properties` router); only
   event keys are rewritten to `.*.` / `[*]`. The wildcard guard is still
   required: the tRPC input accepts any filter name.
2. **The profile category also offers six fixed columns** —
   `profile.id`, `first_name`, `last_name`, `email`, `created_at`,
   `last_seen_at`. Today `compileEventFilter` drops them in events scope
   (not in `EVENT_TOP_LEVEL_COLUMNS`), with no error. Opening the category
   without handling them re-creates the silent-drop defect P2 removed (and
   inside an OR group it widens). Probed with EXPLAIN on ClickHouse: compiled
   without the events column check, every operator family resolves inside the
   same `profiles AS profile` subselect.

## Changes

- `overview.service.ts`, `getEventAnalyticsWhereClause` only:
  - wildcard `profile.*` name → dropped on purpose (comment + TODO to the
    `compileEventFilter` wildcard bug);
  - `profile.properties.*` → unchanged subselect (P2 SQL byte-identical);
  - `profile.<column>` for the profiles table's columns → same subselect;
  - any other `profile.*` → dropped (unknown column would fail the query).
- `advanced-filters-panel.tsx`: `PANEL_CATEGORIES` gains `'profile'`.
- Analytics route: `categories` gains `'profile'`.
- Both comments updated to point at P2 / this plan.

## Tests (`event-analytics-filters.test.ts`, all five builders)

- Wildcard profile filter is dropped (pinned), EXPLAIN runs on ClickHouse.
- Profile column filters resolve through the subselect, EXPLAIN runs.
- Unknown profile column is dropped.
- Real data: `profile.email` inside an OR group narrows totals.
- UI category lists are constants inside `.tsx` files with `@/` imports, so
  they cannot run under the event-analytics vitest config; covered by
  typecheck only.
