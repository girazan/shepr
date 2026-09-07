# Changelog

## 0.9.5 — 2026-09-07

### Added
- **One Coordinator per milestone.** A pane carrying `ORCH_IDS=M<n>` picks only from M<n>'s goals, so two Coordinators can drive two milestones in one repo; `coordinator tick` also takes `--milestone M<n>` as an override. An unscoped pane stays board-wide — today's single-Coordinator behaviour is unchanged, and a malformed scope throws instead of silently widening.
- The scope narrows the CANDIDATES only: rule 5's file-overlap check still computes its running set over **every** goal on the board, so an M53 lane blocks an overlapping M54 candidate. Without that, two Coordinators dispatch lanes that edit the same files. A named goal outside the scope is refused (`rule 6: outside M<n>`), never silently retargeted.
- Pulse lines carry `milestone`, and `pulseAge` filters on it — a live M54 no longer keeps a dead M53 Coordinator looking fresh. Fleet capacity stays the repo's one shared ceiling: scoped Coordinators race for the same slots and the loser reports `wait-capacity`.

## 0.9.4 — 2026-09-07

### Fixed
- laneRebase: a mid-conflict rebase has a detached HEAD, so `--continue`/`--abort`/`--skip` were refused (R13 on the first live rebase). The gate now reads the branch being rebased from git's own `rebase-merge/head-name` / `rebase-apply/head-name`; a rebase of the default branch stays refused.
- laneRebase: re-publishing the rebased branch needs `git push --force-with-lease` — allowed (exact flag, never bare `--force`/`-f`, no refspec, own branch only) from a granted lane worktree in both the ship-gate's push shape and the destructive-git guard. 12 new tests across the two suites.

## 0.9.3 — 2026-09-06

### Added
- **`workflow.laneRebase: true`** — a lane may `git rebase` (incl. `--continue`/`--abort`) its OWN branch from a worktree under `workflow.worktreeRoots`; refused from the main checkout, on the default branch, or with any `-C`/`cd` retarget. Owner-confirmed 2026-09-06 ("lane rebases + revert PRs"). Conflicts still stop the lane and go to the operator.
- **`rulings.onDecision`** — shell template run by `owner-queue decide` on every decision (`{id} {opt} {by} {item} {goal}`), e.g. `herdr agent prompt coordinator "RULING {id} DECIDED ({opt}) …"`: a decision nobody reads is a decision not made.
- Telegram: a visible receipt is replied under the card after a press (`✅ R12 → (b) recorded 15:09 UTC · coordinator woken`); the persistent poller survives network errors (logs `POLL-ERROR`, retries after 15 s). Assistant skill: run the poller as a persistent process, never `poll --once` beside it.
- Role rule written down: only the orchestrator/coordinator parks or decides rulings; lanes report `NEEDS RULING: …` and stop that item (delegate.md brief line, coordinator.md handling).

### Fixed
- **Contract was OFF inside every linked worktree.** `loadConfig` looked for `.claude/orch.json` only under the hook's cwd; a lane worktree has none (the file is rarely tracked), so the ship-gate and destructive-git guard saw "no contract" and exited 0 — `git merge`/`rebase`/anything passed in `.worktrees/*`. The loader now falls back to the main checkout (parent of the git common dir). Regression-tested with a real worktree in test-ship-gate.

## 0.9.2 — 2026-09-06

### Changed
- Telegram ruling cards: HTML parse mode, bold headline (`🧭 Ruling R<n> · #item · G<n> · feature`), one-paragraph question, options as a comparison list with 🅰️🅱️🅲 and ✅ on the recommendation, `📎 evidence`, `⏳ auto-resolves <time>` / `🛑 waits for you`; buttons carry the letter emoji. `send`/`digest` take `--html`. The assistant card follows the same shape (headline, one emoji per section, one line per item).
- `telegram.js` exits via `process.exitCode` (a libuv assertion fired on Windows when exiting with fetch handles still closing). README: seven commands.

## 0.9.1 — 2026-09-06

### Added
- `/shepr:assistant` — the owner-facing role (`ORCH_ROLE=assistant`, run as `/loop 2h /shepr:assistant`): one idempotent tick that runs `owner-queue tick`, drains Telegram button presses into the queue, posts new rulings with a/b/c inline buttons, relays the four allowlisted phone commands (`stop`, `status`, `focus G<n>`, `digest now`) to `tmp/handoffs/assistant-relay.md`, and sends a ≤25-line progress card (milestone bars + deltas, merges, open rulings, blocked lanes) to Telegram and, daily or on demand, the milestone issue. Never rules, edits, merges, or types into another pane.
- `scripts/telegram.js` — Bot API over `fetch`, no dependency: `send`, `ruling R<n>` / `rulings` (inline buttons), `poll [--once]` (callback → `owner-queue decide … --by telegram`; chat-id allowlist; relay allowlist; offset persisted), `digest --file`. Secrets live in `~/.claude/shepr-secrets.json` (`telegram.token`, `telegram.chatId`) — never in a repo; exit 78 with the BotFather hint when absent.

## 0.9.0 — 2026-09-06

Owner-confirmed design (grilled 2026-09-06): fewer operator clicks, main no less safe.

### Added
- Contract rank **`ship: merge`** (⊃ push). `gh pr merge <n>` onto the default branch is allowed when every PR file is in a `merge` domain (evidence paths excepted), the body carries `Suite:` / `Metric:` / `Baseline:` / `Closes #<item>`, and the review the board item's recipe demands exists at the PR head under `docs/reviews/`: `iterate`/`fast`/`cleanup`/`research` none · `tdd`/`debug` a passed plan manifest · `spec` or no recipe plan + step manifests. Pure decision in `hooks/lib/merge-check.js` (unit-tested matrix); `block-destructive-git` fetches base/files/body from GitHub, the item from the board, the manifests from git, and names the missing piece on refusal.
- **`models.review-fallback`**: when a locked reviewer fails to produce a verdict (quota, CLI error, no verdict line) `shepr review` re-runs that slot with the fallback model automatically and writes `fallback: slot-<k> <locked> → <fallback> (<reason>)` into the manifest; the evidence lint accepts exactly that substitution and nothing else.
- **`review.spawn` per model**: a string template for every model, or an object keyed by model name with `*` default — a second family (Codex: `codex exec --sandbox read-only -`) has its own CLI.
- **`scripts/owner-queue.js`** — the ruling queue (`park` / `decide` / `list` / `render` / `tick`): store `.orch/owner-queue.json`, view `tmp/OWNER-QUEUE.md`. Policy by the board item's Feature (`rulings.autoResolveHours`, default 4; `rulings.never` feature names; no Feature = never). `tick` warns at T-1h and auto-resolves to the parked recommendation, appending a `Ruling:` line to the goal's worklog and an audit entry.

## 0.8.2 — 2026-09-06

### Added
- `/shepr:auto [Xh|until-stop] [G<n>]` — unattended autopilot onto an integration branch `autopilot/<date>` that only autopilot merges into; main stays the operator's. Runs /shepr:go's loop phase, merges passing PRs server-side (`gh pr merge --squash`, full gate + Codex), measures after every merge, stops on deadline / LIVENESS / 3 flat rounds / decide:human / operator `stop`, and always leaves a handoff, `tmp/OWNER-QUEUE.md` and a draft review PR `autopilot/<date> → main`.
- block-destructive-git: `destructiveGit.mergeBases` (e.g. `["autopilot/*"]`) — `gh pr merge <n>` is allowed only when GitHub reports the PR's base matches a pattern AND is not the default branch; no number, gh error, or unknown base stays blocked. Absent = unchanged.
- `scripts/codex-watch.js` — CRLF-safe Codex verdict watcher: one line per file (`VERDICT: PASS|FAIL` / `QUOTA` / `ENDED`), exits when all reported or on `--timeout`. A `^VERDICT:.*$` multiline regex never matches Codex's `\r\n` output on Windows.

## 0.8.1 — 2026-09-06

### Added
- ship-gate: `workflow.worktreeRoots` (`.claude/orch.json`, repo-relative dirs, e.g. `[".worktrees"]`) grants lanes `git worktree add [-b <branch>|--detach] <path> [<ref>]` and `remove [--force] <path>` when `<path>` resolves under a listed root. Absent = unchanged (script worktrees under `<git-common-dir>/orch/wt/` only). Absolute or `..` roots are ignored; `prune`, `list`, `move`, extra flags stay denied. Motivation: an orchestrator cutting 3-5 lanes a day needed the operator to type every `worktree add`.

## 0.8.0 — 2026-09-06

### Renamed
- Plugin `orch` → **shepr** (the shepherd of the herd: herdr moves the agents, shepr decides and verifies). Commands are `/shepr:setup|milestone|goal|go|board`; `scripts/orch-review.js` → `scripts/shepr-review.js`. Data names are unchanged in this release: `.claude/orch.json`, `~/.claude/orch-lock.json`, `.orch/board.json`, `.claude/orch-audit.jsonl`, labels `orch:*`, `<git-common-dir>/orch/` — they migrate in a later major version.


### Added
- `scripts/board-gh.js` — GitHub Issues + Projects v2 are the board (spec §4 r8d). Milestone (`M<n> · <objective>`, `n` = GitHub number; legacy `C<n>` sorts) → goal = `orch:goal` issue `G<n>` → items = sub-issues; buckets = the Project's `Priority` options (`Now/Next/Later` after the operator renames them). Verbs: init [--project N] [--owner <login>] [--dry-run], milestones, add-milestone, close-milestone, sync-features, add-goal, add-item, move, set-status, set-blocker, clear-blocker, done, close-goal, read. Lock + fsynced journal; idempotent resume.
- `.orch/board.json` per repo; `board.github` lock key.
- ship-gate: `close-goal G<n>` requires a ledger line naming `G<n>` in `tmp/worklogs/G<n>-*.md` at HEAD.
- `board-html.js --json`.
- `/shepr:milestone` — Director-only fifth command: `define` · `split` · `prioritize` · `close`. board-gh verbs `add-milestone`, `close-milestone` (journaled, refused when `ORCH_ROLE` is set) and `move` on goals.
- Milestone grammar `M<n> · <objective>` with `n` = the GitHub milestone number (legacy `C<n>` still ranks); description `target: <date> · done: <observable>`; `close-milestone --summary` appends `closed: · summary:` and refuses when the read window cannot prove completeness.
- BRIEF `feature:` line, read by `add-goal`; items inherit the goal's Feature unless `--feature` is given.
- Item body lines `step:` (assigned, never renumbered), `accept:` and `recipe:` (execution recipes only: `tdd|iterate|debug|cleanup|fast`); `add-item --accept/--recipe`.
- ROUTE line fields `base:<sha>` and `review:<single|dual>`.
- `init` seeds Feature from contract domain names (non-adopt only); journaled `sync-features` keeps it mirrored; `/shepr:setup` runs it after a domain edit.
- Replay skips Director-only pending actions inside a roled pane.
- Bare value-taking options (`--brief`, `--bucket`, `--recipe`, …) are refused.
- Recipes: `skills/go/recipes/{spec,research,tdd,debug,iterate,cleanup,fast}.md` — one page each with stages and "Gate rubric adds" (spec §8); `review-goal.md` is the base gate rubric. These are the rubric files the review manifest hashes.
- Skill routing (spec §9, d.32): `workflow.tools` maps a stage key to one chosen skill `name@version` or `null`; `scripts/tools.js list|check|pin` resolves against `~/.claude/skills`, `~/.agents/skills` and installed plugins, reports `ok|missing|mismatch|native` with the invoke mode (`skill` vs `read` for `disable-model-invocation` skills), and refuses to pin `to-spec`/`to-tickets`/`wayfinder` unless `docs/agents/issue-tracker.md` is the local-markdown tracker. `/shepr:setup` fills and pins the map (`find-skills` offered when installed, native first); `/shepr:go` invokes the step's recipe and resolved skill and writes `skill: <stage>=<name>` to the ledger; `/shepr:board` lists stages whose pin no longer matches.

- Role guardrails (spec §6, all ADVISORY, keyed on `ORCH_ROLE`): `hooks/role-guardrails.js` (PreToolUse Edit|Write|Read) — reviewer edits only `docs/reviews/`; only a reviewer writes there; coordinator reads only `tmp/handoffs/`, `docs/reviews/`, `.claude/orch.json`, the focus goal's worklog; architect writes no contract-domain path (`docs/adr/`, worklog allowed); dev never touches the worklog's BRIEF block. Every refusal audits `label: "ADVISORY"` and `contract: locked|unlocked`.
- Session marker `<git-common-dir>/orch/session-<sessionId>.json` `{role, milestone, goal, step, startedAt}`: `hooks/session-start.js` (from `ORCH_ROLE`/`ORCH_IDS`, exports `ORCH_SESSION_ID`), `hooks/lib/session.js`, `scripts/session-marker.js set|show`.
- `hooks/stop-handoff.js` (Stop): a roled pane with edits since `startedAt` and no newer handoff at `tmp/handoffs/M<n>.G<k>.S<j>-dev.md` / `M<n>.G<k>-architect.md` / `M<n>-coordinator.md` is refused once, file named. Size budgets (handoff ≤40 lines, plan section ≤300 lines / ≤7 steps) as one advisory line.
- ship-gate: `ORCH_ROLE=reviewer` → commit/push refused (ADVISORY, with or without a contract).
- `tmp/handoffs/` gitignored. `hooks/lib/transcript.js` (`countEdits`, shared with `session-hygiene`); `globToRe` moved to `hooks/lib/contract.js`.
- `scripts/shepr-review.js` — the gate: `shepr review G<k> --step S<j> | --plan`. Refuses a dirty tree under the goal's paths and dual review without `models.review-alt`; range from the frozen BRIEF (`base:`/`domains:` at the ROUTE commit) chained from the latest passing round; tests on a detached worktree under `<git-common-dir>/orch/wt/<id>/`; reviewer slot(s) spawned with `ORCH_ROLE=reviewer` in the child env; slot files, round manifest and content-addressed rubric copies (`docs/reviews/rubrics/<name>.<sha256>.md`) committed `-- docs/reviews` only; item set `In review`; roster entry while it runs.
- `hooks/lib/evidence-lint.js` — spec §5 lint (FROZEN / CHAIN / TARGET / legs a–f / CLOSE TAIL), git + lock only; runs in the ship gate at `board-gh done --goal --step` and `close-goal` — ENFORCED* with a lock entry, ADVISORY (audit line) without.
- ship-gate: built-in `commit` grant for `docs/reviews/**`, `tmp/worklogs/**`, `docs/adr/**` (a domain may lift it to `push`); `git worktree add --detach` / `remove` allowed under `<git-common-dir>/orch/wt/` only.
- `board-gh done --goal G<n> --step S<j> <item#>`; `add-goal` validates `domains:` against the contract; `read` marks merged goals `unverified` (+ `unverifiedReason`) when no passing round covers their final range; `/shepr:board` shows it.
- `scripts/coordinator.js` — the Coordinator tick as code: goal pick rules 0–5 (no two running goals own a common file — `git ls-files` ∩ every listed domain's paths), `kill:` check, fleet ceiling, pulse line `{by:"pulse"}`; five-line dispatch proposal (`confirm` via AskUserQuestion — Go / Edit brief / Skip / Stop — or `auto` to the audit log); pane launch (roster entry, and under `herdr` a pane split with `ORCH_ROLE`/`ORCH_IDS` env, `agent start --kind --pane`, `agent prompt`); fix rounds (resident on fails 1–2, fresh one tier up on 3, no-progress N=2 → stall); verdict → `done --goal --step` / hand-back / `attention`; PR text per goal; milestone summary; `fleet` data for the board.
- `skills/go/coordinator.md` — the tick, the vehicles `native | loop | herdr` (`/loop <interval> /shepr:go`), goal branch `goal/G<k>-<name>` at the ROUTE `base:` on first pick, one PR per goal (`G<k> · <name>`), `close-goal` after the Director merges, `tmp/handoffs/M<n>-coordinator.md` for `/shepr:milestone close`.
- `/shepr:board` FLEET footer: delegates with ghosts, pulse age/stale, out-of-scope commits (spec §5 residual).
- `workflow.coordinator`, `workflow.dispatch`, `fleet.capacity`, `fleet.staleMinutes`, `fleet.pulseStaleMinutes` asked by `/shepr:setup`.

### Changed
- `delegate.md`: a step brief's MUST DO opens with the recipe's stages; CONTEXT names only the goal's worklog and listed ADRs.
- Vocabulary: "milestone" is GitHub's Milestone; "goal" is one ongoing piece of work (`G<n>` orch:goal issue); the done-condition item marker is `gate: <LABEL>` (was `milestone:`). Lane id is `G<issue#>`.
- Goals sort Priority-first across milestones, then milestone, then issue; read goals carry `bucket` and `feature`. `/shepr:go` picks the focus goal by that order (recency rule retired).
- `init` no longer seeds Pipeline from contract domains (absent → `general`).
- The goal skill's shaping table and setup's `workflow.tools` defaults no longer name superpowers; shepr routes only through `workflow.tools` stages and its own native fallbacks.
- ship-gate: the push-base `ls-remote` fallback is gone — with no upstream and no local `origin/HEAD` the push is refused naming `git remote set-head origin -a` (a gate never talks to the remote).
- Bare `board-gh done <item#>` is refused (script and hook).

### Removed
- `docs/BOARD.md` as a board store. `/shepr:setup` deletes it; nothing is imported.

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
- `/shepr:board` — read-only route-map command (buckets × lanes, YOU track, gates, queue).
- `scripts/board-html.js` — self-contained HTML board export from ROUTE grammar.

## 0.5.0 — 2026-08-29
- Fleet context watchdog (`fleet-context` hook) + delegate kill/restart doctrine.

## 0.4.0 — 2026-08-28
- Vocabulary unification: goal, lane, worklog, contract (rename table in README).

## 0.3.x — 2026-08-28
- The decision contract: `.claude/orch.json` domains, deny-by-default `contract-ship-gate`,
  lock mirroring, `/shepr:setup`, `/shepr:goal`, `/shepr:go` driver, research route,
  dual-reviewer convergence, ledger lines, audit trail.

## 0.2.0 — 2026-08-28
- Five adoptions from pi-maestro-flow / pi-crew / pi-fabric survey.

## 0.1.0 — 2026-08-28
- Initial evidence-gated orchestration plugin.
