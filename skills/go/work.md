# Phase: work (ROUTE: exists, done-condition not evidenced)

Delegate execution to the tier named in the ROUTE: line — surfaces,
tier table, and fix-loop escalation live in `delegate.md` (load it when
dispatching). Reviewers are verdict-only — a reviewer never implements
the fix it proposes. Never delegated: protected-directory edits, authored
values without a cited source, judgment the contract reserves for the
operator.

## Recipe and skill — before every dispatch of a step

1. The step's recipe: `read --json` → `items[].recipe` (a legacy item with none runs `fast`; say so in the brief). Load `recipes/<recipe>.md` from this skill's directory — the seven pages are the only recipes; a step never carries `spec` or `research`.
2. `node "<plugin>/scripts/tools.js" check` — one line per stage. `ok · invoke: skill` → the Dev calls that skill through the Skill tool at that stage; `ok · invoke: read` → the Dev reads the printed SKILL.md and follows it (its frontmatter forbids model invocation); `missing` or `mismatch` or `native` → the native fallback named on the line, and the brief says which. A stage the recipe does not use is ignored.
3. The brief (`delegate.md`): MUST DO opens with the recipe's stages in order, each stage naming the skill or the native fallback it resolved to; CONTEXT names the recipe page and this goal's worklog.
4. Ledger, one line per stage used, appended by the Dev when the stage starts:
   `skill: <stage>=<name>`
   (`<name>` = the skill name, or `native`). The ROUTE line is unchanged.
5. The recipe page's "Gate rubric adds" is the reviewer's rubric beside `recipes/review-goal.md` — the review ladder's step 2 reads both; plan 4's `shepr review` hashes both into the manifest.

## Review ladder (per hand-back — order is mandatory)

1. MECHANICAL first, cheap tier: empty-result check before anything — if
   the claimed diff is empty or a claimed artifact absent/zero-length,
   auto-FAIL; "ran, produced nothing" never costs a review round. Then
   `git diff --stat` + build + scoped tests. Fail → back to implementer.
   Test-touching hand-backs also get the test-quality audit: ①
   circular-oracle check (a test deriving expected values from the code
   under test proves nothing) ② assertion-strength ladder (existence →
   type → status → value → behavioral; consequential verdicts need
   value-or-behavioral) ③ disabled-test scan (skips found in review are
   findings) ④ green-can-go-red: revert the fix, the new test must FAIL —
   a test that stays green without the fix proves nothing.
2. JUDGMENT second: diff review, strongest model, verdict-only, READ-ONLY:
   the reviewer inspects via `git show <sha>:<path>` / `git diff <base>..<sha>`
   and never checks out, stashes, or edits — it shares the working tree.
   High-consequence hand-backs get a second reviewer from a DIFFERENT
   model family in a FRESH context, same rubric. Verdicts tri-state:
   PASS / FAIL / INCONCLUSIVE — INCONCLUSIVE holds for the operator, no
   auto-retry, no round consumed. Both must PASS; one FAIL fails; one
   INCONCLUSIVE holds. Artifact reality check: claimed additions pass
   EXISTS → SUBSTANTIVE → WIRED.
3. LOOP: on FAIL the implementer (never a reviewer) fixes ONLY flagged
   items; step 2 re-runs fresh. Initial review = round 1; cap 3. Stall
   (identity-based, never count-based): a previous-round finding survives,
   or a new equal-or-higher-severity finding appears → escalate. Never
   merge dirty.

## Record discipline

Every iteration entry starts:
`iter <n> · <short-sha> · <before> → <after> · keep|revert|flat|refuted · <what>`
then prose: hypothesis (written BEFORE the change), what changed, every
number, verdict. Consequential autonomous calls:
`Ruling: <decision> — <why> — <cost if wrong>` + audit mirror.
Simplicity criterion: improvement bought with disproportionate complexity
→ flag `⚠complexity`; a flat result that DELETED code is a win — keep it.

Complete when: the ledger satisfies the BRIEF's `done:` → return to the
driver, phase ship.

## Gate rounds (spec §5)

The gate is a script, never a hand-written manifest:
`node "<plugin>/scripts/shepr-review.js" G<k> --step S<j>` (or `--plan`) — it refuses a dirty tree under the goal's paths, assembles the brief (rubric + diff + handoff + BRIEF), runs the tests on a detached worktree, spawns the reviewer slot(s), and writes and commits `docs/reviews/`.
Read the manifest's `verdict:` line and do exactly one thing:
pass → `done --goal G<k> --step S<j> <item#>` · fail → hand back to the same Dev with the manifest plus the failing test output and any conflict context, never a bare retry · inconclusive → `attention G<k> "inconclusive: <manifest>"` and stop — when the Director clears it, re-run the gate as the next round with no Dev dispatch.
Fix rounds count `fail` manifests for the step, not `R` numbers: fails 1–2 resume the same Dev pane; fail 3 = fresh Dev one tier up; a finding that survives two fails, or the same error or an empty diff twice, is a stall → Director. Inconclusive rounds do not count.
The ship-gate evidence lint re-derives the manifest header from git at `done` and `close-goal`; a BLOCK there names the leg — read it, never re-run the gate to make it go away.
