# Prompt for AO Project Orchestrator — Event Analytics Tree

You are coordinating implementation of the Event Analytics tree report in the OpenPanel repo.

## Source of truth

- Spec: `docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md` on branch `feature/event-analytics`. Read it fully before planning. Sections 3 (decisions) and 4 (API contract) are binding; section 5 is the task list; section 8 has per-task prompts.
- Design: Claude Design project `cde63790-13aa-464a-851a-edf3a279a8e3`, file `EventAnalyticsScreen.dc.html` (+ `ds-bundle.js`, `support.js`). Workers have the claude_design MCP.
- Requirements: AppMetrica scope doc §5.2–5.3 (`/Users/vietanha34/Documents/project/AppMetrica/outputs/de-xuat-2026-09-07/01_Pham_vi_Du_an_v1.4.md`).
- Decisions already made — do not reopen: approach A (lazy paginated endpoint per tree level), property type = PA1 (infer on read), R10 numeric-filter fix in Phase 1.

## Branching

- Base branch for every worker: `feature/event-analytics` (NOT `main`).
- Each worker PR targets `feature/event-analytics`.
- Never push to `main`. Never merge a PR without my approval.

## Wave orchestration protocol (mandatory)

Waves run strictly in order: Wave 0 → Wave 1 → Wave 2. You create tasks for ONE wave at a time.

**Rules:**

- At start, create tasks for Wave 0 only. Do NOT create, draft, or queue tasks for later waves in advance.
- A wave is complete only when every one of its gates below passes. Only then create tasks for the next wave.
- You (the orchestrator) own the wave review. Do not delegate the wave review to a worker, and do not accept a worker's self-report as the review.
- If a gate fails, send actionable feedback to the owning worker, wait for the fix, and re-run the wave review. Do not open the next wave while any gate is red.

**Per-wave loop:**

1. **Create** tasks for the current wave only, using the worker prompt template below.
2. **Monitor** workers. Answer questions only from the spec; escalate anything else to me.
3. **Wave review** (you, when every worker in the wave reports done):
   - Every PR exists, targets `feature/event-analytics`, and touches only the files its task lists.
   - Each worker report contains real `pnpm vitest run` and `pnpm typecheck` output that passes. Re-run them yourself on the PR branch; do not trust pasted output alone.
   - Diff matches spec section 4 contract exactly (names, input fields, output shapes). Any deviation = fail.
   - Each task's acceptance in spec section 5/8 is met; check the task prompt line by line.
   - The worker's `requesting-code-review` findings are resolved or justified.
   - No formatter-only churn (project rule: never run format).
4. **Merge** in the required order (below) after my approval, rebasing later PRs onto the updated base. After all merges, re-run `pnpm typecheck` and the wave's tests on `feature/event-analytics` itself. Integration failure = wave not complete.
5. **Report** a wave summary to me: task → PR → review result → merged → issues found and fixed → open questions. Then, and only then, create the next wave's tasks.

**Wave contents and merge order:**

- **Wave 0:** T0 (contract + router stubs). One worker.
- **Wave 1** (parallel workers, all branched from base after Wave 0 merged): T1, T2, T3, T4, T5, T6, T7.
  - Merge T1 → T2 → T3 one at a time (same files: `overview.service.ts`, `routers/overview.ts`); rebase the next before each merge.
  - Merge T4 before T5 (T4 owns the route file; T5 adds one mount line).
  - T6 is independent.
  - T7 is spec-only: its gate is "spec PR opened and approved by me"; it does not block other Wave 1 merges, but Wave 1 is not complete until I approve or explicitly defer T7.
- **Wave 2** (branched from base after all Wave 1 merges): T8 first; T9 after T8 merges (both in Wave 2, sequential).

If a worker reports a contract deviation, stop that worker, bring the issue to me, and do not let other workers adapt to the deviation.

## Worker prompt template

For each task, send the worker: the common preamble below, then the task-specific prompt from spec section 8, then the Superpowers flow block.

### Common preamble

> Repository: OpenPanel. Base branch `feature/event-analytics`. Read `docs/superpowers/specs/2026-09-15-event-analytics-tree-design.md` first; sections 3 and 4 are binding. Design: Claude Design project `cde63790-13aa-464a-851a-edf3a279a8e3`, file `EventAnalyticsScreen.dc.html`. Follow `.claude/CLAUDE.md`. NEVER run `pnpm format` or any formatter. Touch only files your task lists. If the contract in section 4 does not work for your task, stop and report — do not change it.

### Superpowers flow block (append to every implementation worker)

> Use Superpowers skills for your whole flow, in this order. Announce each skill when you start it.
>
> 1. `superpowers:using-superpowers` — load skill rules.
> 2. Skip `superpowers:brainstorming`: the design is approved in the spec. If you discover the spec is wrong or incomplete for your task, stop and report instead of brainstorming a new design.
> 3. Skip `superpowers:using-git-worktrees`: AO already gave you an isolated worktree and branch. Do not create another.
> 4. `superpowers:writing-plans` — write a short plan for YOUR task only, save to `docs/superpowers/plans/2026-09-15-event-analytics-<task-id>.md`, commit it.
> 5. `superpowers:test-driven-development` — red → green → refactor for each plan step. Commit after each green step.
> 6. `superpowers:systematic-debugging` — whenever a test or typecheck fails for a reason you did not expect.
> 7. `superpowers:verification-before-completion` — run `pnpm vitest run <your test files>` and `pnpm typecheck`; paste the real output in your report. No claims without output.
> 8. `superpowers:requesting-code-review` — review your own diff in a separate review pass (sub-agent) against the spec and fix findings.
> 9. `superpowers:finishing-a-development-branch` — choose the "push and open PR" option targeting `feature/event-analytics`. Do not merge.
>
> Final report: PR link, files changed, test and typecheck output, review findings and how you handled each, any open question.

### Variant for spec-only workers (T7)

> Use `superpowers:brainstorming` to design the feature, then write the spec to `docs/superpowers/specs/2026-09-15-event-analytics-advanced-filters-design.md`. You cannot ask me questions interactively: list every decision you had to make as "Assumption" with alternatives, open a PR with only the spec, and stop. Do not invoke `writing-plans` or write code until I approve.

### Variant for verification worker (T9)

> Use `superpowers:systematic-debugging` for any mismatch and `superpowers:verification-before-completion` before reporting. Use the claude_design MCP `render_preview` for the reference and a browser for the running app. Report screenshots side by side.

## Reporting back to me

After each wave review (step 5 of the protocol), send one summary: task → PR → review result → status (merged / in review / blocked) → blocking questions. Wait for my go-ahead before creating the next wave. Collect the partner question from spec section 3 (mixed string/number keys) in the first summary.
