# Changelog

## 0.12.2 — 2026-09-09

### Changed
- **The autopilot gate no longer hardcodes a Codex leg.** `/shepr:auto` step 3 said "three legs + Codex on numerics" unconditionally, so a project with no `models.review-alt` was told to spawn a reviewer its contract never names. The second-family review is now conditional on `review-alt` being configured, and the squash-title suffix names whichever reviewer actually ran.

## 0.12.1 — 2026-09-09

**Breaking: one name per level.** The vocabulary had four collisions — `C1` and `M49` were the same milestone under two prefixes; an identifier's number sometimes meant a GitHub id and sometimes a position, unmarked; "goal" and "objective" are English synonyms one level apart; and `skills/milestone` used "objective" for two different things in one file.

### Changed
- **`M<n>` is the milestone's PROGRAM ORDINAL, read from its title (`M1 · 053 NHT operable`).** The GitHub milestone number appears in no identifier a human types, and is no longer a second route to a milestone: `--milestone M49` does not resolve the milestone numbered 49. `milestoneOrdinal()` is the one reader; `shepr review` fails closed with a retitle instruction when a title carries no `M<n> ·` prefix, rather than falling back to the number.
- **The `C<n>` prefix is retired.** `pick`, `tickScope`, `session-marker --ids`, `ORCH_IDS` and `milestoneRank` accept `M<n>` only. A scope of `C1` is refused, not silently accepted.
- **`add-milestone` titles with the next ordinal**, one past the highest `M<n> ·` on the board, and takes a `<statement>` rather than an `<objective>` — the milestone's own one-line statement is not the outcome layer.
- **objective → outcome.** Label `orch:objective` → `orch:outcome`; verb `add-objective` → `add-outcome`; flag `--objective` → `--outcome`. `O<n>` keys are unchanged. Progress stays outcomes closed over outcomes total.

### Added
- **`board-gh retitle-milestone <milestone#|title> --title "M<n> · <statement>"`** — the migration surface the rename needs. Director-only, journaled, idempotent, and it refuses a title without the ordinal or an ordinal another milestone already carries.

### Migration (a board created before 0.12)
1. Retitle each milestone to `M<ordinal> · <statement>` (`board-gh retitle-milestone`), ordinals starting at 1 in program order.
2. Rename the label: `gh label edit orch:objective --name orch:outcome`.
3. Rename existing review manifests `M<github#>.G…` → `M<ordinal>.G…` and update the references in their worklogs; the evidence chain reads the filename.

## 0.11.4 — 2026-09-09

### Fixed
- **The ruling digest reached the phone with no way to answer.** `owner-queue digest | telegram digest` sent plain text whose "reply R<n> <letter>" instruction the poller did not understand, and no card with buttons was posted. Now the last digest message carries one button row per OPEN ruling (`R57 (a) (b) (c)`), each open ruling records that message id, and a press rebuilds the keyboard with the rows still open instead of wiping it. A typed `R57 a` (any case, `:` or space) decides exactly like a press, with the same receipt.

## 0.11.3 — 2026-09-09

Patch from the C2 coordinator, tested and adopted.

### Fixed
- **A lane that merged the default branch in was reviewed on everything it merged.** `shepr review` now starts the diff at `merge-base(default branch, head)` when that commit descends from the frozen `base:`; the brief says so on a `diff:` line. `range:` in the manifest and slot files stays `base..head`, so the evidence chain and the lint are unchanged. A lane cut from an autopilot base (merge-base not descending from `base:`) keeps the old behaviour.
- **`shepr review` died on a large diff** (`maxBuffer` exceeded). Git calls now allow 64 MB.

## 0.11.2 — 2026-09-09

### Changed
- **`/shepr:go` is a 1 KB router.** Its 11 KB body (board, contract, route, ship, records) moved to `go/native.md`, loaded only when the pane is not a Coordinator tick. A coordinator session now loads `SKILL.md` + `coordinator.md` (16 KB) instead of 26 KB; `coordinator.md` restates the ROUTE line verbatim (pinned by the grammar test) so it never needs `native.md`. Measured on a restarted coordinator pane: ~115 KB of context before the first board read, of which this was the only shepr-owned piece.

## 0.11.1 — 2026-09-09

The assistant pane retires. After 0.11.0 the ruling round-trip was already script-only (poller → owner queue → coordinator wake); what the pane still did — send the digest, relay four phone texts, restart the poller — is now the coordinator's `wait` and the poller itself. One fewer model in the loop, and the pane that spawned the duplicate poller is gone.

### Fixed
- **`coordinator wait` woke on itself.** It snapshotted `herdr agent list` unfiltered — every pane in every workspace, including the caller — so run in the background it fired the instant the coordinator's own turn ended (`coordinator working -> done`), and again for panes in other workspaces. It now watches only names in `.git/orch/fleet.json`; no roster means no lane wakes (rulings, manifests, the phone and the timeout still fire).
- **Two Telegram pollers fought** (`Conflict: terminated by other getUpdates`, 572 lines in one log) after a restart left the old one alive. `telegram.js poll` now takes `.orch/telegram-poll.pid` as a lock: a live pid there exits 75 without touching Telegram; a dead one is replaced.

### Added
- `wait` also wakes on a new line in `.orch/assistant-inbox.jsonl` (`wake: phone: <text>`), so `stop`, `status`, `focus G<n>` and `digest now` from Telegram reach the coordinator with no pane in between.
- `telegram digest` reads stdin when `--file` is absent: `owner-queue digest | telegram digest` is one command.

### Deprecated
- `/shepr:assistant`. Only the ≤25-line progress card with milestone bars has no replacement; keep the pane if you want that, drop it otherwise.

## 0.11.0 — 2026-09-09

Three ideas adopted from [kunchenguid/firstmate](https://github.com/kunchenguid/firstmate) (MIT), which solves the fleet-mechanics problem shepr deliberately does not. Not a fork: its work model is a markdown backlog with ship/scout tasks, which contradicts the milestone/objective/goal board. Comparison written up in the pertasim repo.

### Added
- **Event-driven wake.** `coordinator wait [--timeout S] [--poll S]` blocks INSIDE the script and returns the moment the fleet changes, printing one `wake: <reason>` line. It wakes on a lane reaching idle/done/blocked, a lane joining or leaving, a ruling decided, or a new review manifest; else on its timeout (`fleet.waitTimeoutSeconds`, default 1800). A tick on a timer pays tokens for every quiet interval; this pays none. `wakeReason`/`snapshot` are pure and tested; only the poll loop touches the world.
- **`owner-queue digest`.** The whole open queue as ONE message — id, goal, feature, age, deadline, question, options with the recommendation marked, evidence — instead of a notification per ruling. The operator reads once and answers in a batch.

### Changed
- **The Coordinator writes nothing but `tmp/` and `.orch/`** (firstmate's hard rule 1: the supervisor books the work, a Dev does it). `role-guardrails` already refused coordinator *reads* outside its lane but had no write row, so a coordinator pane could edit source; a test even asserted that hole. Still ADVISORY, like every ORCH_ROLE row.
- **`rulings.autoResolveHours: 0` (or `null`/`false`) now means never auto-resolve.** Previously any non-positive value silently fell back to 4 hours. A deadline is not a decision: a timer answering a physics call is the failure mode this switch removes.

### Fixed
- `coordinator wait` read its start time from one clock and its elapsed time from another, which made elapsed negative forever under an injected clock. One clock now.

## 0.10.2 — 2026-09-08

### Fixed
- The anchor test fails closed: a BRIEF with no `domains:` line is treated as anchored (research-first, ruling names the fix) instead of `n/a`. A guard that switches itself off on missing input is not a guard. Found by the pertasim Coordinator on G2100, whose BRIEF predates `domains:`.

## 0.10.1 — 2026-09-08

### Added
- Intake rule: `/shepr:goal` opens a goal on an existing issue only when it carries `ready-for-agent`; the five triage states are mattpocock/skills' (`needs-triage · needs-info · ready-for-agent · ready-for-human · wontfix`), and `workflow.tools.triage` may pin that skill. `coordinator sweep` reports how many open issues carry none of them — counted, never labelled by the script.

## 0.10.0 — 2026-09-08

### Added
- **Objectives.** A level between milestone and goal: `board-gh add-objective <milestone#> "<title>" --done "<observable>"` creates an `orch:objective` issue (Director-only, idempotent on milestone + title); `add-goal … --objective O<n>` makes the goal its sub-issue. Progress reported upward is objectives closed / total, never issue or goal counts — issue counts grow while work advances. `/shepr:milestone objectives` proposes them; nothing closes an objective but the Director demonstrating its `done:`.
- **Anchor test.** `coordinator anchor G<k>` reads the BRIEF: a goal in `workflow.anchorTest.domains` needs an `anchor:` line (PFD/OM value, conservation closure, textbook correlation) and a predicted `<before> → <after>` on `metric:`; otherwise exit 2 and the first step runs the `research` recipe. One `Ruling: anchor-test · …` line is appended to the worklog either way, once. Born from a numerics goal that ran 23 rounds, 6 reverts and 44 rulings without an anchor.
- **Pipeline from the domain.** `board.pipelineByDomain` (`{ "numerics": "Engine" }`) makes `add-goal` and `add-item` set the Project's Pipeline field from the goal's `feature:`; an explicit `--pipeline` still wins; no map → nothing set. Nobody fills Pipeline by hand any more.
- **Sweep.** `coordinator sweep [--apply] [--idle-days N]` plans (or applies) the weekly hygiene pass: PRs idle past `board.sweepIdleDays` (default 14) close as parked with a comment; lane/goal branches already merged into the default branch are deleted; unmerged lane branches are listed and left to the Director. One audit line per run.

### Changed
- Vehicle by work type: herdr panes for long code lanes and Director-led design; in-session `Agent` for review, research, bisect, board sync. No new lane while a ruling is older than 24 h.
- A goal makes exactly two worklog commits: `route:` at first pick and `docs(worklog): G<k> close` after the merge. Rounds append, never commit. Nothing writes `docs/BOARD*.md`.
- Steps and items stay sub-issues (the tick's state machine) but are documented as the agent's bookkeeping, never progress.

## 0.9.7 — 2026-09-08

### Fixed
- The assistant's progress card assumed ONE milestone: a hardcoded `C1 · …` headline, one `🎯 bars` line, and a daily comment on "the milestone issue". With two campaigns live it picked one for the headline and the other's lanes landed unlabelled in the shared sections. The card now carries one bar per open milestone, prefixes every goal line with its milestone, and comments on each open milestone's issue filtered to its own lines. The assistant stays unscoped on purpose — it is the one phone channel, not one per campaign.

## 0.9.6 — 2026-09-07

### Added
- A Coordinator's milestone scope accepts **`C<n>`** (the legacy title prefix) as well as `M<n>` (the GitHub milestone number), in `ORCH_IDS`, `--milestone` and `session-marker --ids`. On a board that predates `/shepr:milestone` the two disagree — "C1 SHU-HDS operable" is milestone #49, so `C1` and `M49` name the same milestone by two routes, and `C<n>` is the one a human actually says. `milestoneRank` already ranked `C<n>`; only the scope id did not resolve it. `C1` does not match `C10`.

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
