# U9 acceptance review - 2026-08-30

## Resumed fix checkpoint — 2026-08-31

This section supersedes the earlier pending/blocked verdict and verification ledger below. The historical investigation is retained for context. All legitimate interrupted changes remain present; no commit, push, or U10 work was performed.

### Root causes and fixes

1. **Draft flow missing `$350` precedence:** the fixture has no keeper and no auction spending. Its Round 2 balance is `$350 + $150 = $500` (`season-store.ts`, round-opening budget calculation). Corrected the four exact labels to `$500`; no league rule or assertion was weakened. Once past this failure, the test revealed two reload steps that assumed an automatically loaded season, although the application explicitly requires season selection. Those steps now load the season; the completion check enters the app without an old stage deep link.
2. **Full lifecycle disabled fieldset:** `refreshShell` assigned the new hash before React committed the new bootstrap. The old shell listener interpreted Draft navigation against the old Draft Order legal stage, and the pending-order guard restored Draft Order. After hydration that stage was read-only, so the fieldset correctly stayed disabled. Removed the early hash write and completed the interrupted shell effect that navigates after hydration. Pending/recovery guards remain active.
3. **Season-switch flow disabled fieldset:** the same order-finalization race blocked this test before it could finish switching seasons. The same application fix resolves it; the actual season-switch assertions remain intact.

### Recovery uniqueness diagnosis and resolution

The first violated constraint was SQLite's inline `UNIQUE(conventionalDraftId, balance)` on `DraftOrderTieDecision` (backed by `sqlite_autoindex_DraftOrderTieDecision_2` in schema 9). It protects one witnessed precedence decision for each balance group. Once that collision is removed, retained entries collide with `UNIQUE(conventionalDraftId, orderPosition)` and `UNIQUE(conventionalDraftId, seasonTeamId)`; replacement picks likewise collide with whole-history uniqueness on overall pick/player.

Migration 4 introduced these unconditional constraints. Migration 5 added `supersededAt` to order entries/decisions without changing the constraints. CorrectionService correctly supersedes these rows and resets the existing ConventionalDraft, preserving IDs, snapshots, audit and correction history. Several current-state queries nevertheless included superseded rows; standalone and bootstrap tie summaries could disagree.

The intended semantics are explicit in the Phase 2 plan's entity table: **one active permanent order, unique position/team within the active order, and unique active overall pick/player** (`outputs/phase-2-implementation-plan.md`, lines 265–269). KTD13 requires canonical descendants to be superseded rather than erased. Phase 2.5 R3/R25 and the recovery journey preserve history. The existing `supersededAt`/`active` fields already distinguish history from current state. A new versioned-order model is therefore unnecessary, and the user's authorization to implement a minimal correction under existing requirements applies.

Implemented schema 10 as a forward migration through the existing copy/migrate/promote path. It copies every row/column in the three affected tables before replacing their old inline constraints with partial unique indexes: order entries/decisions use `supersededAt IS NULL`; picks use `active = 1`. Primary keys, foreign keys, original data, snapshots, audit and correction records remain preserved. No historical record is deleted as a business operation; table rebuilds are transactional structural migration. Current order reads, tie finalization and on-the-clock selection now exclude superseded rows. Prisma schema comments identify the SQL-managed partial constraints; the generated client was refreshed.

The new regression first failed on the stale superseded order. It now proves correction, fresh precedence, restart, replacement of pick one with the previously superseded player, unchanged retained historical rows, bootstrap/current-order consistency, rejection of duplicate active records, atomic rejected-decision audit behavior, and SQLite integrity/foreign-key checks. Existing released-schema-6 migration/restore tests also pass, including row fingerprints, IDs, columns, foreign keys and immutable snapshot hashes. This resolves the blocker using documented semantics, without a new persistence-model decision.

### Final verification

- Commissioner suite: **159/159 PASS**, including the unchanged catalog timing tests.
- Focused draft/persistence/corrections/recovery: **39/39 PASS**.
- Phase 1: **35/35 PASS**; `git diff dd4d636 -- src test` is empty.
- Typecheck, Prisma generation, production build and `git diff --check`: **PASS**.
- Final schema-10 browser verification outside the sandbox: **12/12 PASS** (40.7 seconds).
- Review: targeted manual review of the resumed fix scope, because the branch contains prior legitimate uncommitted work. No broad refactoring or new review pipeline was run. Verified partial-index predicates, copied columns/foreign keys, active-query coverage, navigation guard preservation, and unchanged business assertions.

### Final verdict

**U9 COMPLETE at the local, uncommitted checkpoint.** Both the three browser failures and the recovery uniqueness blocker are resolved. No new persistence-model decision is required: existing documented active-record semantics were restored. Stop here for user review; no commit, push, or U10.

### Current legitimate uncommitted scope

All changes are unstaged. HEAD remains `97d9100` on `feat/phase2.5-draft-night-usability`, one commit ahead of the local origin-tracking ref. No fetch, commit or push was performed.

```text
 M .gitignore
 M apps/commissioner/e2e/draft.e2e.mjs
 M apps/commissioner/e2e/operations.e2e.mjs
 M apps/commissioner/e2e/ui-lifecycle.e2e.mjs
 M apps/commissioner/prisma/schema.prisma
 M apps/commissioner/spec/draft/draft-panels.spec.tsx
 M apps/commissioner/spec/draft/draft.spec.ts
 M apps/commissioner/spec/persistence/persistence.spec.ts
 M apps/commissioner/spec/routes/error-envelope.spec.ts
 M apps/commissioner/spec/setup/api-client.spec.ts
 M apps/commissioner/src/infrastructure/sqlite/migrations.ts
 M apps/commissioner/src/infrastructure/sqlite/season-store.ts
 M apps/commissioner/src/routes/error-envelope.ts
 M apps/commissioner/src/ui/app/stage-shell.jsx
 M apps/commissioner/src/ui/setup/main.jsx
 M apps/commissioner/src/ui/setup/setup.css
 M apps/commissioner/src/ui/shared/api-client.js
 M apps/commissioner/src/ui/shared/player-finder.jsx
 M apps/commissioner/src/ui/stages/draft-order/draft-order-panel.jsx
 M apps/commissioner/src/ui/stages/draft/draft-panel.jsx
?? apps/commissioner/prisma/migrations/202608310001_u9_active_draft_history/migration.sql
?? apps/commissioner/src/ui/shared/stage-mutation-guard.jsx
?? docs/reviews/2026-08-30-u9-acceptance/report.md
```

Generated Playwright output, Prisma client, build output and review-cache artifacts remain ignored, not commit candidates. Migration validation used disposable databases and retained baseline fixtures; no live commissioner database was intentionally opened or migrated. Upgrading a real database is the material operational change and should use the application's existing safe migration path and verified backup discipline.

## Original review scope and boundary (historical)

- Branch: `feat/phase2.5-draft-night-usability`.
- Checkpoint: `97d9100` (U9); review comparison base: `dd4d636` (U8).
- Authority: [approved Phase 2.5 plan](../../plans/2026-08-18-2234-feat-draft-night-usability-plan.md), U9 only.
- Interrupted source/test changes were preserved. U10, schema redesign, commits and pushes are excluded from this run.
- The user's earlier 12/12 browser result proves the checkpoint, not these follow-up changes.

## Acceptance matrix

Current status after the resumed fixes: all U9 criteria pass. Evidence includes the final schema-10 browser run (12/12), Commissioner suite (159/159), and retained-history migration/recovery regressions. New Operations presentation remains U10 scope.

| Criterion / plan trace | Evidence | Status |
|---|---|---|
| Unique balances determine permanent descending order; two/multi-team external ties must have valid named precedence (R21, U9) | `spec/draft/draft.spec.ts` permanent-order cases; `draft-panels.spec.tsx` named precedence/method; browser order flow | PASS |
| Fixed A-B-C-A sequence, never snake (U9) | Service three-team sequence, full 14-round completion | PASS |
| Resume-aware legal stage, completed-stage inspection, named controls (R19-R21) | Stage model/API-client tests; lifecycle browser guards | PASS |
| Prominent clock, overall pick, round, fixed order, completion progress (R22) | Draft read-model/service and static panel tests | PASS |
| Persistent clock/action at 1366x768, independently scrolling panes, responsive context tabs (R22) | CSS control-room hierarchy; explicit browser bounding-box/overflow/1000px assertions | PASS |
| Shared normalized search/filter/status policy; paged labels without raw IDs (R9-R10, R23, AE6) | Existing `player-search.spec.ts`, shared finder, large-catalog lifecycle browser test | PASS |
| Current canonical roster grouped by position; all other-team rosters selectable (R24) | Service roster summaries; static grouped roster test; browser switching | PASS |
| Empty/partial/FLEX/nearly-complete legal needs equal Phase 1; open capacity accurate (R24) | Phase 1 oracle comparison after every player in a 14-player roster | PASS |
| Keeper, auction and draft acquisitions remain canonical (R24) | Acquisition-source service fixture; active assignment read models | PASS |
| Active reverse-chronological history (R25) | Service history assertions and pick-three correction case | PASS |
| Superseded history retained (R25, AE11) | Existing audited correction behavior; U9 active view excludes superseded records | Persistence PASS; new Operations presentation belongs to U10 |
| Successful pick updates clock, roster, history, availability and progress; clears only selection (R26, AE8) | Service summary and idempotency tests; browser post-pick filter/availability assertions | PASS |
| Wrong-team, owned/duplicate, stale version, unknown position and capacity failures do not mutate canonical state/audit (R27) | Service rejection snapshots and structured envelope tests | PASS |
| Inline rejection retains attempted selection and filters, including illegal K (R27, AE9) | Server K-capacity rejection proof; browser retained-context coverage | PASS |
| Idempotent retry commits only once (R26, R32) | Same key/payload retry service case | PASS |
| Acknowledged command followed by hydration failure remains acknowledged with explicit recovery (R31-R32) | Client fault-injection tests; draft/order recovery UI and browser cases | PASS |
| Stage navigation cannot discard an accepted pending pick/reload requirement (R31, R34) | Navigation recovery regression coverage | PASS |
| Correction of pick 3 of 5 resumes that clock, keeps only picks 1/2 active (R20, R25, R34, AE11) | Real CorrectionService preview/backup/confirm, reopen and BootstrapService assertions | PASS |
| Restart retains canonical draft/season state; exact 14 legal players completes and opens Results (R19, R34, AE10) | Close/reopen service comparison; exact completion service; Results browser reload | PASS |
| Existing transaction/version/audit/checkpoint and offline guarantees preserved (R32-R34) | Full Commissioner regression suite; frozen root tests; no provider integration changed | PASS |
| Draft-summary player lookup bounded by active roster/pick references | Query regression red before / green after | PASS |

## Original review and findings (historical)

Compound Engineering code review completed with all eight selected lenses: correctness, testing, maintainability, performance, API contract, reliability/recovery, frontend races, and adversarial. An independent validator evaluated the four merged candidates. Local adversarial review completed; an external cross-model peer could not run because sandbox networking is disabled.

- #1: accepted Draft Order commands lost acknowledgment when the subsequent bootstrap failed. FIXED: client retains accepted result; panel disables retries and offers explicit reload. Three client regressions failed before the fix and passed afterward.
- #3: navigating away during a pending pick or after acknowledgment/refresh failure lost component-local accepted state. FIXED: shared mutation guard keeps Draft/Order mounted across both link and hash/history navigation while pending/recovery-required; canonical completion navigation remains allowed. Guard unit tests pass; browser regressions await external execution.
- #4: each draft summary unnecessarily fetched the entire annual player catalog. Fixed with season-scoped unique active assignment/pick player IDs. Regression failed before the fix, then draft tests passed 11/11. This is not a measured latency-threshold failure.
- #2 (preexisting recovery blocker): after normal DRAFT_ORDER correction and restart/recalculation, standalone summary returns no unresolved ties while bootstrap returns the tie; both display superseded order entries. A fresh witnessed tie decision fails UNIQUE(conventionalDraftId, balance). Parent independently reproduced this with CorrectionService preview/confirm and a disposable database. The defect predates U9, but prevents closing U9's preserved correction/restart guarantee. No schema or correction semantics were changed.

### Recovery blocker reproduction

1. Calculate a tied order, record witnessed precedence, and finalize.
2. Preview and confirm a DRAFT_ORDER correction through CorrectionService, including required backup and version/hash checks.
3. Close/reopen the store and recalculate.
4. Compare standalone and bootstrap order summaries; they disagree on unresolved ties and retain the old order.
5. Record replacement precedence: Prisma fails on the unconditional (conventionalDraftId, balance) unique constraint.

Reproduction command (temporary test remains in ignored cache):

```powershell
& 'C:\Program Files\nodejs\node.exe' node_modules/vitest/vitest.mjs run --config node_modules/.cache/u9-review-20260830/repro.config.mjs --configLoader runner
```

Observed result: 1/1 FAILED, intentionally demonstrating a real product defect, not sandbox failure. This is separate from the normal regression suite and is not counted as passing acceptance. Resolution needs an explicit lineage/uniqueness design (and corresponding migration or versioned-order approach), active-record query consistency, and correction/restart regression tests. Deleting superseded history or bypassing constraints is not acceptable.

Earlier interrupted-review fixes retained: explicit witnessed tie precedence, fixed-order display, grouped rosters, finder refresh preserving filters, control-room layout/contrast, stable UNKNOWN_POSITION envelope, acknowledged-pick refresh recovery, additional canonical/restart/correction/error tests.

Simplify pass completed before review. One redundant API route ternary was simplified. Cross-layer constant extraction and duplicate bootstrap-read redesign were not applied: they would enlarge this U9 follow-up without demonstrated acceptance benefit.

## Original verification ledger (historical)

- Frozen Phase 1: `node --test` -> 35/35 PASS on this resumed run.
- `git diff dd4d636 -- src test` -> empty (frozen implementation/tests unchanged).
- Before final reviewer fixes: Commissioner suite -> 152/152 PASS.
- Earlier catalog performance runs had timing-sensitive failures (staging 7.94s and promotion 5.215s against existing 5s assertions); the subsequent full suite passed unchanged. No threshold or test was relaxed.
- Final typecheck: PASS. Final production build: PASS (38 Vite modules).
- Sandbox browser run: one API-only case passed; the 11 Chromium-dependent cases could not launch (`browserType.launch: spawn EPERM`). These are infrastructure blocks, not evidence of UI failure.
- No configured lint command exists; typecheck and diff checks are used, not represented as a lint run.
- Final default Commissioner suite: 157/158 PASS; 1 FAIL in unchanged catalog timing assertion (stageDurationMs 5482.0327 must be <5000). U9/service/client/guard tests all passed.
- Isolated catalog diagnostic with one worker: 8/8 PASS. This does not erase the failed default run.
- Focused UI/client suite: 15/15 PASS; focused draft suite: 11/11 PASS.
- Final E2E JavaScript syntax checks and git diff --check: PASS.
- Separate order-correction reproduction: 1/1 FAIL with Prisma uniqueness error, independently reproduced by parent. This is a known correctness blocker.
- Final code-review follow-up diff inspected for guard scope, canonical completion bypass, bounded query, stable error contract and retained test assertions. No rules, schema, correction machinery or Phase 1 source/tests changed.
- Browser launch was not repeatedly retried after confirmed spawn EPERM. Prior checkpoint screenshots cannot validate newly added recovery/layout assertions.

## Artifacts and commit scope

Legitimate follow-up work (all unstaged) is:
```text
.gitignore
apps/commissioner/e2e/draft.e2e.mjs
apps/commissioner/e2e/ui-lifecycle.e2e.mjs
apps/commissioner/spec/draft/draft-panels.spec.tsx
apps/commissioner/spec/draft/draft.spec.ts
apps/commissioner/spec/routes/error-envelope.spec.ts
apps/commissioner/spec/setup/api-client.spec.ts
apps/commissioner/src/infrastructure/sqlite/season-store.ts
apps/commissioner/src/routes/error-envelope.ts
apps/commissioner/src/ui/app/stage-shell.jsx
apps/commissioner/src/ui/setup/setup.css
apps/commissioner/src/ui/shared/api-client.js
apps/commissioner/src/ui/shared/player-finder.jsx
apps/commissioner/src/ui/shared/stage-mutation-guard.jsx (new source)
apps/commissioner/src/ui/stages/draft-order/draft-order-panel.jsx
apps/commissioner/src/ui/stages/draft/draft-panel.jsx
docs/reviews/2026-08-30-u9-acceptance/report.md (new durable report)
```

Git status: branch remains at 97d9100, ahead of its local origin-tracking ref by one commit; 15 tracked modified files and the two new files above, nothing staged. No fetch/push performed. Generated data was preserved and ignored, not deleted. Generated `apps/commissioner/test-results/`, `apps/commissioner/playwright-report/`, and `node_modules/.cache/u9-review-20260830/` are ignored and must not be staged. Review prompts, raw persona returns, mechanical synthesis, and reproduction scratch files are cache artifacts, not product code.

## Post-change operational validation

Owner: commissioner, before accepting the follow-up boundary. On a disposable local season, verify order ties, multi-round picks, refresh/restart, inline rejected pick, and correction/resume. Healthy signals: one canonical pick/audit mutation per acknowledgment, stable row version after reload, correct next team and active history, no provider request. Failure signals: stale clock after successful reload, duplicate records, lost recovery message, or failed canonical correction. Stop drafting and preserve the database/backup if these occur; do not reset data or bypass audited correction.

## External browser verification

Run in ordinary PowerShell outside the restricted sandbox, using this already-built tree:

```powershell
Set-Location 'C:\Users\luvme\Documents\Codex\2026-08-16\referenced-chatgpt-conversation-this-is-an'
if (Get-NetTCPConnection -LocalPort 4191 -State Listen -ErrorAction SilentlyContinue) {
  throw 'Port 4191 is occupied; stop the known test server or choose another unused port.'
}
$env:COMMISSIONER_E2E_PORT = '4191'
try {
  & 'C:\Program Files\nodejs\npm.cmd' run commissioner:e2e
  if ($LASTEXITCODE -ne 0) { throw 'Browser verification failed' }
} finally {
  Remove-Item Env:COMMISSIONER_E2E_PORT -ErrorAction SilentlyContinue
}
```

## Original verdict (superseded)

Review work completed; U9 acceptance is NOT COMPLETE and this is not a fully green shipping boundary. Confirmed introduced review findings #1/#3/#4 are fixed. Remaining gates:
1. Resolve the preexisting draft-order correction lineage/uniqueness contradiction with an explicitly approved persistence approach; do not erase retained history.
2. Execute the updated 12 browser tests outside the sandbox, including newly added layout/recovery/real-K rejection assertions.
3. Obtain a green default full-suite run on the reference environment or explicitly resolve its unchanged catalog timing instability.

Not ready to label the follow-up commit or branch as U9-complete/push-ready. All changes remain local and unstaged. No U10, commit, push, destructive cleanup, or implicit schema redesign.
