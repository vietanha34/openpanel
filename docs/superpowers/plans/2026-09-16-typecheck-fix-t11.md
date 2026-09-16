# Plan: make repo-wide `pnpm typecheck` exit 0 (T11)

## Problem

`pnpm typecheck` fails in `apps/api`, `apps/start`, `apps/worker` with 87 errors.
All 28 packages pass. The failing errors live in *package* sources
(`packages/common/server/encryption.ts`, `packages/email/src/unsubscribe.ts`,
`packages/auth/*`, `packages/db/src/exports/batch-creator.ts`,
`packages/importer/src/providers/*`) — the same files that typecheck clean
inside their own package.

## Root cause (measured, not assumed)

The three apps declare no `@types/node` devDependency. They are the only
workspace projects that don't. Every `packages/*` uses `"@types/node": "catalog:"`
(`^24.7.1`).

`tsc --listFilesOnly` from `apps/api` resolves Node typings from **outside the
repository**:

```
/Users/vietanha34/node_modules/@types/node/globals.d.ts   # version 17.0.8
```

TypeScript walks parent directories for `node_modules/@types`; with nothing in
the repo it lands in the developer's home directory. `@types/node@17` predates:

- `Buffer extends Uint8Array<ArrayBufferLike>` (added in @types/node 20+) → 63 errors
- `crypto.getRandomValues` → 6 errors
- `Readable.fromWeb` → 2 errors

So the failure is environment-dependent and would produce different results on
every machine and in CI. This is a dependency-declaration bug, not a code bug.

## Fix

Add `"@types/node": "catalog:"` to `devDependencies` of `apps/api`,
`apps/start`, `apps/worker`. No runtime dependency changes, no source changes.

## Verification

1. `pnpm install`
2. `pnpm typecheck` → exit 0, 31 passes, 0 fails
3. `pnpm test` → same pass count as base
4. `git push` without `--no-verify` (pre-push runs `pnpm typecheck`)

## Out of scope

`.husky/gitnexus-pre-commit` referenced by the pre-commit hook does not exist;
commits still need `--no-verify`. Separate breakage, not fixed here.
