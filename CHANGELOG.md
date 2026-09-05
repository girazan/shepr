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

### Changed
- Vocabulary: "milestone" is GitHub's Milestone; "goal" is one ongoing piece of work (`G<n>` orch:goal issue); the done-condition item marker is `gate: <LABEL>` (was `milestone:`). Lane id is `G<issue#>`.
- Goals sort Priority-first across milestones, then milestone, then issue; read goals carry `bucket` and `feature`. `/orch:go` picks the focus goal by that order (recency rule retired).
- `init` no longer seeds Pipeline from contract domains (absent → `general`).

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
