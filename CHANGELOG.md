# Changelog

## Unreleased

### Added
- `scripts/board-gh.js` — GitHub Issues + Projects v2 are the board (spec §4 r8d). Milestone (`M<n> · <objective>`, `n` = GitHub number; legacy `C<n>` sorts) → goal = `orch:goal` issue `G<n>` → items = sub-issues; buckets = the Project's `Priority` options (`Now/Next/Later` after the operator renames them). Verbs: init [--project N] [--owner <login>] [--dry-run], milestones, add-milestone, close-milestone, sync-features, add-goal, add-item, move, set-status, set-blocker, clear-blocker, done, close-goal, read. Lock + fsynced journal; idempotent resume.
- `.orch/board.json` per repo; `board.github` lock key.
- ship-gate: `close-goal G<n>` requires a ledger line naming `G<n>` in `tmp/worklogs/G<n>-*.md` at HEAD.
- `board-html.js --json`.
- `/orch:milestone` — Director-only fifth command: `define` · `split` · `prioritize` · `close`. board-gh verbs `add-milestone`, `close-milestone` (journaled, refused when `ORCH_ROLE` is set) and `move` on goals.
- Milestone grammar `M<n> · <objective>` with `n` = the GitHub milestone number (legacy `C<n>` still ranks); description `target: <date> · done: <observable>`; `close-milestone --summary` appends `closed: · summary:` and refuses when the read window cannot prove completeness.
- BRIEF `feature:` line, read by `add-goal`; items inherit the goal's Feature unless `--feature` is given.
- Item body lines `step:` (assigned, never renumbered), `accept:` and `recipe:` (execution recipes only: `tdd|iterate|debug|cleanup|fast`); `add-item --accept/--recipe`.
- ROUTE line fields `base:<sha>` and `review:<single|dual>`.
- `init` seeds Feature from contract domain names (non-adopt only); journaled `sync-features` keeps it mirrored; `/orch:setup` runs it after a domain edit.
- Replay skips Director-only pending actions inside a roled pane.
- Bare value-taking options (`--brief`, `--bucket`, `--recipe`, …) are refused.
- Recipes: `skills/go/recipes/{spec,research,tdd,debug,iterate,cleanup,fast}.md` — one page each with stages and "Gate rubric adds" (spec §8); `review-goal.md` is the base gate rubric. These are the rubric files the review manifest hashes.
- Skill routing (spec §9, d.32): `workflow.tools` maps a stage key to one chosen skill `name@version` or `null`; `scripts/tools.js list|check|pin` resolves against `~/.claude/skills`, `~/.agents/skills` and installed plugins, reports `ok|missing|mismatch|native` with the invoke mode (`skill` vs `read` for `disable-model-invocation` skills), and refuses to pin `to-spec`/`to-tickets`/`wayfinder` unless `docs/agents/issue-tracker.md` is the local-markdown tracker. `/orch:setup` fills and pins the map (`find-skills` offered when installed, native first); `/orch:go` invokes the step's recipe and resolved skill and writes `skill: <stage>=<name>` to the ledger; `/orch:board` lists stages whose pin no longer matches.

- Role guardrails (spec §6, all ADVISORY, keyed on `ORCH_ROLE`): `hooks/role-guardrails.js` (PreToolUse Edit|Write|Read) — reviewer edits only `docs/reviews/`; only a reviewer writes there; coordinator reads only `tmp/handoffs/`, `docs/reviews/`, `.claude/orch.json`, the focus goal's worklog; architect writes no contract-domain path (`docs/adr/`, worklog allowed); dev never touches the worklog's BRIEF block. Every refusal audits `label: "ADVISORY"` and `contract: locked|unlocked`.
- Session marker `<git-common-dir>/orch/session-<sessionId>.json` `{role, milestone, goal, step, startedAt}`: `hooks/session-start.js` (from `ORCH_ROLE`/`ORCH_IDS`, exports `ORCH_SESSION_ID`), `hooks/lib/session.js`, `scripts/session-marker.js set|show`.
- `hooks/stop-handoff.js` (Stop): a roled pane with edits since `startedAt` and no newer handoff at `tmp/handoffs/M<n>.G<k>.S<j>-dev.md` / `M<n>.G<k>-architect.md` / `M<n>-coordinator.md` is refused once, file named. Size budgets (handoff ≤40 lines, plan section ≤300 lines / ≤7 steps) as one advisory line.
- ship-gate: `ORCH_ROLE=reviewer` → commit/push refused (ADVISORY, with or without a contract).
- `tmp/handoffs/` gitignored. `hooks/lib/transcript.js` (`countEdits`, shared with `session-hygiene`); `globToRe` moved to `hooks/lib/contract.js`.

### Changed
- Vocabulary: "milestone" is GitHub's Milestone; "goal" is one ongoing piece of work (`G<n>` orch:goal issue); the done-condition item marker is `gate: <LABEL>` (was `milestone:`). Lane id is `G<issue#>`.
- Goals sort Priority-first across milestones, then milestone, then issue; read goals carry `bucket` and `feature`. `/orch:go` picks the focus goal by that order (recency rule retired).
- `init` no longer seeds Pipeline from contract domains (absent → `general`).
- The goal skill's shaping table and setup's `workflow.tools` defaults no longer name superpowers; orch routes only through `workflow.tools` stages and its own native fallbacks.

### Removed
- `docs/BOARD.md` as a board store. `/orch:setup` deletes it; nothing is imported.

## 0.7.0 — 2026-08-31

- Contract schema 2: optional per-domain `tiers: { work, review }` model-tier
  floors (roles `low|mid|high|frontier`); `schemaVersion` field separates
  schema from the per-edit `version` revision. Advisory in this release —
  gating hooks land in 0.8.0.
- Lock bundle: a locked `contract` now replaces `{contract, models}`
  wholesale — locking a tiered contract requires locking the models map.
- BREAKING: a present-but-corrupt `~/.claude/orch-lock.json` now fails
  blocking guards CLOSED (previously fell back to project config).
- New `hooks/lib/contract.js` schema helpers + `tests/test-contract.js`.
- Lock-mirrored contract/models are now scoped per repo
  (`repos[<git-common-dir>]`) instead of applying globally to every repo
  sharing the same lock file. Existing locks: run
  `node scripts/migrate-lock.js` once from each repo you'd previously
  mirrored a contract into.
- Spec: `docs/specs/2026-08-31-orch-v2-upgrade-design.md`.

## 0.6.0 — 2026-08-29
- Numbered lanes: goals get stable `G<n>` identity through goal/go/delegate.
- `/orch:board` — read-only route-map command (buckets × lanes, YOU track, gates, queue).
- `scripts/board-html.js` — self-contained HTML board export from ROUTE grammar.

## 0.5.0 — 2026-08-29
- Fleet context watchdog (`fleet-context` hook) + delegate kill/restart doctrine.

## 0.4.0 — 2026-08-28
- Vocabulary unification: goal, lane, worklog, contract (rename table in README).

## 0.3.x — 2026-08-28
- The decision contract: `.claude/orch.json` domains, deny-by-default `contract-ship-gate`,
  lock mirroring, `/orch:setup`, `/orch:goal`, `/orch:go` driver, research route,
  dual-reviewer convergence, ledger lines, audit trail.

## 0.2.0 — 2026-08-28
- Five adoptions from pi-maestro-flow / pi-crew / pi-fabric survey.

## 0.1.0 — 2026-08-28
- Initial evidence-gated orchestration plugin.
