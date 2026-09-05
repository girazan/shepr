# Five-Role Orchestration on Herdr — Design Spec

Date: 2026-09-06 · Status: **r11** — branch and PR per goal (d.33); r10: review loop stopped after round 6
(§13); §9 now names the operator's chosen skill per stage (d.17, d.32) · Baseline: `main` with
the GitHub board (`board-gh`), orch v0.7.0 + unreleased · Companion to
`2026-08-31-orch-v2-upgrade-design.md`, whose **threat model and label
vocabulary this spec inherits verbatim**: hooks defend against a sloppy
agent, not an adversary; every guarantee is conditional on the hook
running; **ENFORCED\*** = a hook verifies against locked config or repo
state · **ADVISORY** = catches drift, bypassable by intent · **INSTRUCTED**
= skill text only. r3 additionally names the v2 spec's second caveat that
r2 dropped: hooks see direct tool calls (`Read`/`Edit`/`Write`, the typed
`Bash` line); scripts, wrappers and native I/O are out of their sight.

Decisions are numbered 1–33 in §11; earlier revisions' text is superseded
by this document wherever they differ. The input artifact is in §A.

## 1. Target architecture at a glance

```
 DIRECTOR (you)        scope: milestone · goals · contract · ADRs · decide:human · stalls
     │  /orch:setup  /orch:milestone  /orch:goal          needed only where amber
     ▼
 COORDINATOR           native | loop (/loop 10m /orch:go) | herdr pane · one per repo
   reads board · latest handoff · latest review · the focus goal's worklog (append GATE)
   never code, never a verdict · one action per tick · pulse line · proposes goals, never creates
     │ starts panes with ORCH_ROLE=…  (a guardrail, not a credential — §6)
     ├─► ARCHITECT   goal-sized, only if fuzzy/big · plan: steps + fog · recipe per step · ADRs · ≤5 Qs
     ├─► DEV         fresh pane per step · execution recipe → skills · checkers (a capability) · commits per contract
     └─► GATE        spawned by `orch review` · self-sufficient round manifest; the evidence lint recomputes its header from git alone (§5)

 UNITS   M53 milestone (GitHub Milestone #53)  ─ G3 goal (issue #3)  ─ S2 step (sub-issue, `step:` line)  ─ R1 round
 STATE   GitHub board · worklog · docs/adr · tmp/handoffs (scratch) · docs/reviews (evidence) · audit log
 GATES   contract ship rank ★ · destructive git ★ · review evidence lint (★ once plan 4 moves it into the hook; git-only, no network) · role guardrails (advisory)
```

**Stated risk (from the operator's Codex verdict):** over-orchestration —
too many formal roles can cost more coordination than the coding they
coordinate. Mitigations, all in this spec: the Architect is optional, the
`fast` recipe exists, the `loop` vehicle needs no Herdr, the checker is a
capability not a role, dispatch confirmation is a mode that turns off, and
§12's hand-run counts crossings before any hook is written.

## 2. Vocabulary (normative)

| term | means | on GitHub | in an id |
|---|---|---|---|
| **milestone** | long-horizon objective, the Director's; any number open at once | Milestone: title `M<n> · <objective>` where **`n` is the GitHub milestone number** · description `target: <YYYY-MM-DD> · done: <observable>` · due = target | `M<n>`; goals with no milestone use `M0` |
| **goal** | one finite deliverable; one BRIEF; one Dev at a time | issue labeled `orch:goal`; body = BRIEF; `G<n>` = issue number | `G<n>` |
| **step** | the unit Dev builds and the gate judges; **every goal has at least one** (a small goal has exactly one, its `gate:` item) | sub-issue of the goal; body `text · step: S<j> · outcome: · gate: · accept: · recipe:` (`recipe:` is an **execution** recipe only, §8; `add-item` refuses a shaping one) ; label `orch:item` | `S<j>` — stored in the body |
| **review round** | one gate verdict on a step (or the plan) | manifest `docs/reviews/M<n>.G<k>.S<j>.R<r>.md` (+ slot files `…R<r>-1.md`, `…R<r>-2.md` under dual review); plan review `M<n>.G<k>.P.R<r>.md`; the rubrics it used copied content-addressed to `docs/reviews/rubrics/<name>.<sha256>.md` (r6) | `R<r>` |
| **domain** | a territory of expertise in the contract (paths · expertise · decide · ship · tiers); **also the workstream** | Project **Feature** option, mirrored from the contract | never |
| **lane** | *retired as a word.* It survives as a data key and a grammar token (`ROUTE: lane:G<n>`; the `lane` key in `board-gh read` JSON) meaning "the goal" | — | — |
| **checker** | a capability of Dev or Architect: an in-session subagent asked for fast feedback; advisory | — | — |

Id rules (r4 — **one number per level**): `M<n>` and `G<n>` are GitHub
numbers, never reused; `add-milestone` creates the milestone and then
retitles it `M<number> · <objective>`, so the title ordinal *is* the GitHub
number (legacy `C<n>` titles keep their own ordinal for ranking; their id
is still `M<github number>`). `S<j>` is written into the step body as
`step: S<j>` by `add-item` (max over the goal's existing steps + 1) and
**never renumbered**: inserting a step before S2 creates S4; display order
comes from Priority + creation. `R<r>` increments on every gate run for
that step, including inconclusive ones (no filename collision); the
**fix-round cap counts `fail` verdicts only**. The plan review is
`P.R<r>` (r4: not `R0`, since an unshaped goal has no plan round and small
goals now have `S1`).

Examples: `M53.G142.S1.R2` (small goal = its one step, second round) ·
`M53.G142.S2.R1` (step 2, first round) · `M53.G142.P.R1` (plan review) ·
`M53.G142.S2.R1-2` (second slot of a dual round; the manifest is
`…S2.R1.md`).

## 3. Roles

| role | runs as | tier | owns | never (mechanism, label) |
|---|---|---|---|---|
| Director | you; attaches to a pane only when it blocks | — | milestones, goals, contract, ADR ratification, `decide: human` calls, stalls | route tasks, review code (INSTRUCTED) |
| Coordinator | one per repo; `native` (today's session) · `loop` (`/loop <interval> /orch:go`) · `herdr` pane | frontier first; `mid` once one milestone ran clean (d.1) | pick one goal per tick, dispatch, gate bookkeeping, board status, pulse | read code (ADVISORY: direct `Read` outside its allowlist refused; `Bash` reads are not seen); design, implement, produce a verdict (INSTRUCTED) |
| Architect | pane per goal, `ORCH_ROLE=architect`, only when the goal is fuzzy or big | frontier | research, plan section (steps + fog), `recipe:` per step, ADRs, ≤5 questions | write dev-domain paths (ADVISORY, direct `Edit`/`Write` only) |
| Dev | **fresh pane per step** (d.24), `ORCH_ROLE=dev`; resident across fix rounds 1–2 | `tiers.work` floor ∨ the route's tier, strictest wins | one step (or one small goal), its tests, its handoff, commits where `ship: commit` | change the BRIEF or the plan (INSTRUCTED; the BRIEF is an issue body only `board-gh` verbs mutate); write `docs/reviews/` (ADVISORY path rule + ENFORCED\* evidence lint, §5) |
| Gate reviewer | subagent spawned by `orch review` **with an explicit child env** `ORCH_ROLE=reviewer` (a spawner sets its child's env; inheritance is the default, not a constraint — and still forgeable, hence ADVISORY); no pane; roster entry while it runs | `tiers.review`, never below `high`; second slot from `models.review-alt` — **dual requested with no `review-alt` configured → the script refuses**, it never silently runs single | the slot file(s), the round manifest and the rubric copies (the script commits them pathspec-limited to `docs/reviews/` — an evidence-only commit; **today's ship gate has no evidence-path grant** — it would block that commit — so plan 4 adds a built-in `commit` grant for `docs/reviews/**`, `tmp/worklogs/**`, `docs/adr/**`, r6) | fix what it finds, ship code (ADVISORY path rules; the ship gate refuses commit/push for the role — also ADVISORY, since it keys on the role) |

Context budget: Coordinator reads the board (via `board-gh read`), the
latest handoff, the latest review, and the **focus goal's worklog** (r3:
required to write the GATE block — it was missing from r2's allowlist).
Architect reads its goal's BRIEF, the codebase via research, prior ADRs.
Dev reads its goal's worklog, named ADRs, the files it edits. The gate
reviewer reads the BRIEF, the diff range, the handoff, test output. Under
`ship: none` nothing reaches a commit by Dev's hand: the Dev handoff ends
with the exact `git add`/`git commit` for the Director, and `orch review`
**refuses while `git status --porcelain -- <goal paths>` is non-empty**
(the goal's paths come from the frozen BRIEF, §5 — computed before any
range, so an empty range cannot make the check vacuous; r8, Opus S2) — so
the gate always reviews committed code, whatever the grant.

## 4. State — one normative table

| what | where | written by | read by | notes |
|---|---|---|---|---|
| contract, models, `workflow.{coordinator,prefer,tools,dispatch}` | `.claude/orch.json`, mirrored to `~/.claude/orch-lock.json` | Director via `/orch:setup` | hooks, every skill | lock replaces `{contract, models}` wholesale (v2) |
| board | **GitHub only**: Milestone → goal issue → step sub-issues; Project fields Status · Priority · Feature · Pipeline | `board-gh` verbs only | `board-gh read` | `docs/BOARD.md` is gone (main CHANGELOG); r2 references to it are void |
| milestone | GitHub Milestone, three fields (§2) | `add-milestone` (Director-only): create, then retitle to `M<github number> · <objective>` — two journaled sub-effects, idempotent on the exact `M<n> · <objective>` title (legacy `C…` titles never match) | `milestones`, `/orch:goal` step 1 | **M/C compatibility:** `milestoneRank` accepts `^[MC](\d+)` for sorting only; ids always use the GitHub number; existing `C<n>` milestones are never renamed by orch |
| goal BRIEF | goal issue body: `goal · metric · done · domains · feature · kill` | `add-goal --brief` | everyone | `feature:` = primary domain; `add-goal` **parses it from the brief file** and sets the Project Feature from it; `domains:` names contract domains (plan 4: validated against the lock at `add-goal`, so it is never free text). **No `base:` here (r6):** the first review range starts at the ROUTE line's `base:` in the git-tracked worklog, written by the route phase = HEAD at first dispatch — not creation, so a same-domain goal merged between creation and dispatch never enters the range (Opus S3) |
| Feature options | Project field | `init` (non-adopt) seeds from domain names when absent; **adopt mode (`--project`) never creates a Feature field** — it prints a hint and records `feature: null`; `sync-features` (a journaled `board-gh` verb, run by `/orch:setup` after any domain edit and available from `/orch:board`) adds missing options, never deletes; a rename shows up as an added option and a domain-less old option, which `sync-features` lists for the operator | `add-goal`, `add-item` | **Pipeline policy (r3):** `init` no longer seeds Pipeline from domains — absent → created with `general` (main's adopt path keeps creating a missing Priority/Pipeline as today; only Feature is adopt-safe); present → read verbatim, pass-through |
| step | sub-issue body + fields | `add-item` by Architect (or the goal skill, which **always creates at least the `gate:` step** so a small goal has `S1`, and writes `--recipe` on it from the shaping table); never by Dev | Dev, gate | `add-item` assigns `step: S<j>` from **all** of the goal's sub-issues (REST, paged — not the 40-item read window); `recipe:` is fixed at creation (Architect at plan time, or the goal skill for a small goal) and covered by the plan review where one exists; Dev cannot alter it (§5) |
| item Status | Project single-select `Todo · In progress · In review · Done` | `board-gh` verbs only: Coordinator `set-status` at dispatch (`In progress`); `orch review` calls `board-gh set-status <item> "In review"` on launch; on the manifest verdict the Coordinator runs: pass → `done --goal G<n> --step S<j> <item>` · fail → `set-status <item> "In progress"` · inconclusive → `attention G<n> "inconclusive: <manifest>"` (item stays `In review`); when the Director clears attention the Coordinator **re-runs the gate as `R<r+1>`** (no Dev dispatch) — that is the exit from `In review` | `fold.js` | goal status is derived by `fold.js` from goal state, goal/item labels (incl. the `blocked:` comment lookup), and item Status; reviews never fold directly. **The goal skill always creates `S1`, so `running`/`review` are reachable** (INSTRUCTED: `add-goal` alone creates no step; a script-only goal folds `ready` and `close-goal` refuses it, r8). Fold precedence is `fold.js`'s: closed → blocked → needs_attention → review → running → ready, so an inconclusive on a goal with a blocked item shows `blocked` until unblocked |
| worklog | `tmp/worklogs/G<n>-<name>.md`: BRIEF copy · plan section (steps, fog) · ledger · ROUTE line (`base:<sha>`, `review:`) · GATE block | Architect (plan), Dev (ledger), Coordinator (ROUTE, GATE) | Dev, gate, Coordinator (focus goal only), evidence lint (`base:` at HEAD) | **git-tracked, as on main** (r5 — the ship gate reads the ledger, ROUTE and GATE block from HEAD; r4's "scratch" was wrong). The worklog is not scratch, so its `base:` is repo state the lint may read (r6) |
| handoff | `tmp/handoffs/M<n>.G<k>[.S<j>]-<role>.md` (`.S<j>` for Dev; none for the Architect) and `tmp/handoffs/M<n>-coordinator.md`, ≤40 lines | every role at exit | the next role, Coordinator | scratch: plan 3 adds `tmp/handoffs/` to `.gitignore` (main has no `tmp/` entry, r6); the only scratch files in the design |
| review | manifest `docs/reviews/M<n>.G<k>.S<j>.R<r>.md` (or `…P.R<r>.md`) + slot files + rubric copies `docs/reviews/rubrics/<name>.<sha256>.md` | slot files by the reviewer(s); the manifest and rubric copies by `orch review` after all slots finish, **then committed by the script** (`git commit -- docs/reviews`, pathspec-limited) | Dev (on fail), Coordinator, evidence lint | git-tracked evidence; grammar in §5. **Milestone summary** for close: `tmp/handoffs/M<n>-coordinator.md` |
| session marker | `<git-common-dir>/orch/session-<sessionId>.json` `{role, milestone, goal, step, startedAt}` | whoever starts the pane (Coordinator's launcher, or the go skill at session start) | Stop hook, role guardrails | gives Stop the ids and start time it needs to name the handoff file |
| audit | `.claude/orch-audit.jsonl` | hooks, skills, Coordinator (`by:"pulse"`) | `/orch:board` | stale flag = age of last pulse |
| fleet roster | `<git-common-dir>/orch/fleet.json` (v2 §3.1) | pane launchers; `orch review` adds/removes its reviewer entry itself (a subprocess with no lifecycle hook — ADVISORY) | `/orch:board` FLEET footer | |

**Goal pick, one rule everywhere (r3; supersedes §4/d.2/d.19/d.25 of r2
and the go skill's recency rule):**
0. `blocked` and `needs_attention` goals are never picked — they are the Director's (r4);
1. the goal the operator named (`/orch:go G8`);
2. else goals whose status is `running` or `review` (finish in-flight work);
3. else by Priority bucket across milestones (`Now` under M60 beats `Next` under M53);
4. within a bucket, lower milestone number, then lower issue number;
5. (r6) **no two `running` goals may own a common file.** For every
   running goal the Coordinator lists the files its `domains:` own at HEAD
   (`git ls-files` filtered by the contract paths of **every** domain in
   the line — not only `feature:`); a candidate whose file set intersects
   a running goal's is skipped this tick. Files are concrete, so domains
   with overlapping globs (which the ship gate allows) are handled without
   comparing globs (Opus S7). Review ranges are scoped to the goal's domain
   paths (§5); this rule is what keeps two goals' commits out of each
   other's diffs. Residual: two goals *creating* files under one shared
   glob — the lint still shows the reviewer both.
"Most recently touched worklog" is retired as a rule.

**Only `board-gh` closes goals (r4).** A goal issue closed through the
GitHub UI or `gh issue close` folds `merged` with no evidence check. That
is unverified drift, not a bypass the spec pretends to stop: `board-gh
read` marks every `merged` goal whose last step has no passing manifest
covering its final range as `unverified`, and `/orch:board` shows it.

## 5. Review protocol

Two kinds of review, distinguished by **what is verifiable**, not by who
launches them — r2's "launched by / briefed by" split does not survive the
env-inheritance finding (§13, Opus A1/A2, Codex 1).

| | Checker | Gate |
|---|---|---|
| what it is | a capability: Dev or Architect asks a subagent for fast feedback, any brief, any tier | the verdict that flips a step or goal |
| launched by | Dev / Architect, in-session, freely | Dev / Architect run `orch review G<k> --step S<j>` (or `--plan`) when they believe the unit is done; the Coordinator runs it to re-check after an inconclusive |
| brief | the caller's | assembled by the script: rubric file(s) + `git diff <base>..<sha> -- <paths>` + handoff + BRIEF. **This is a convention, not a guarantee** — the caller could run its own subagent. What makes the gate a gate is the next row. |
| output | advice in the caller's context; ledger line at most | slot file(s) + a **round manifest** with a verifiable header (below) |
| status | ADVISORY | verdict content ADVISORY (sloppy-agent model); **step** manifest header **ENFORCED\*** by the evidence lint at `done`/`close-goal`; a **plan** manifest (`P.R<r>`) is not in the chain and no verb transitions on it — its header is script-written, its use INSTRUCTED (r9, Codex C1: the Coordinator dispatches the first step only after a passing `P.R<r>`, nothing enforces that) |

**Round manifest** (`docs/reviews/M53.G142.S2.R1.md`, written by the script
after every slot has finished or failed to spawn, then committed):

```
review: M53.G142.S2.R1
goal: G142 · step: S2 · item: #151     # self-sufficient: the lint never asks GitHub (r6)
rubric: review-goal.md@<sha256> [+ tdd.md@<sha256>]   # sha256 of docs/reviews/rubrics/<name>.<sha256>.md, copied by the script
range: <base-sha>..<head-sha>          # the diff every slot was handed, restricted to paths:
paths: src/Hmi.Web/** src/Hmi.Core/**  # union of the locked contract paths of every domain the diff touches
slots: 1 | 2                            # 2 = dual, recomputed from the contract (below)
slot-1: R1-1.md · <model> · <tier> · pass|fail|inconclusive|missing
slot-2: R1-2.md · <model> · <tier> · pass|fail|inconclusive|missing   # dual only
verdict: pass | fail | inconclusive     # all pass → pass; any fail → fail; else inconclusive (missing counts as inconclusive)
```

Each slot file carries the same `review:`/`rubric:`/`range:`/`paths:`
lines plus its own `verdict:` line, `reasons:` (each citing `done:` or the
step's `accept:`) and `notes:`. The manifest's `verdict:` is derived from
the slot files' `verdict:` lines and the lint re-derives it (leg d).
Rubrics live in the plugin (`skills/go/recipes/`), not in the repo under
review, so the script copies each rubric it used to
`docs/reviews/rubrics/<name>.<sha256>.md` — content-addressed, so a later
rubric edit is a new file and old manifests keep resolving (Opus S1). A plan-round manifest (`…P.R<r>.md`) has `range: <base>..<base>`
where `base` is the ROUTE line's `base:` — the ROUTE line is written at
the goal's **first dispatch of any pane**, Architect included (§7 step
2), so a plan round always has one (r7, Codex M2) — and no `paths:`; it
reviews the plan section, not a diff.

**Range rule (r6, computable from git alone):**
- `<base-sha>` = the `head-sha` of the **latest passing step manifest of
  this goal** — "latest" by ancestry: the one whose `head-sha` is an
  ancestor of every other passing head of the goal is older; plan
  manifests are not in the chain — else the worklog ROUTE line's `base:`
  at HEAD (written at first dispatch).
- `<head-sha>` = HEAD when the script runs, **before** the evidence commit
  the script makes afterwards; the next range therefore starts at the
  previous head and simply contains that evidence commit, which touches
  only evidence paths and so never matches a domain.
- **Evidence paths** — `docs/reviews/**`, `tmp/worklogs/**`, `docs/adr/**`
  — are removed from every domain's paths before any matching in this
  section, whatever the contract says (a contract covering `docs/**` does
  not make a manifest a domain file; Opus S6).
- **Frozen BRIEF (r8, Opus S1/S3):** the goal's `domains:` and the ROUTE
  `base:` are read from the worklog **as of the commit that introduced its
  ROUTE line** — `git log --reverse --format=%H --name-only -S'ROUTE:
  lane:G<n> ' -- 'tmp/worklogs/'` gives the first such commit **and the
  path it touched**; the lint reads `git show <commit>:<that path>`, so a
  later rename or a second worklog changes nothing; zero or more than one
  path in that first commit → MISS "frozen BRIEF ambiguous" (r9, Codex
  M1) — never from HEAD. A later rewrite of either line changes nothing the lint
  reads, so the evidence-path commit grant cannot shrink a range.
- **Goal paths** = the union of the locked contract paths of the frozen
  `domains:`, minus the evidence paths. The reviewer is handed
  `git diff <base>..<head> -- <goal paths>`; `paths:` in the manifest is
  that union. Concurrent goals on one branch (d.25) therefore never enter
  each other's diffs, and rule 5 of §4 (no shared file) is what makes the
  scoping sound — this is the rationale r6 stated and did not deliver
  (Opus S1). A Dev commit outside the goal's domains is not reviewed
  under this goal: the ship gate allows it only where the contract grants
  `commit`, and `/orch:board` lists such commits (`git log base..HEAD --
  <other domains>` on a running goal) as `out-of-scope` for the Director —
  ADVISORY residual, stated.
- Inconclusive → next round `R<r+1>` on the same base (the latest
  *passing* manifest did not change). A dual round with a `missing` slot
  is inconclusive and exits the same way (attention → re-run).

**Evidence lint** — git and the lock file only, no network (the v2 hook
rule; Codex 1, Opus S2). Inputs: the verb line (`board-gh done --goal
G<n> --step S<j> <item#>` or `close-goal G<n>`), the manifests found by
`docs/reviews/*.G<n>.S<j>.R*.md` (`*.G<n>.S*.R*.md` for close), the
worklog at HEAD, the locked contract. The lint is one algorithm (r7 —
written out so a reviewer can run it by hand):

```
FROZEN(G): worklog at the commit that introduced the ROUTE line (§5 range
           rule): gives base: and domains:.  GOALPATHS := locked paths of
           those domains minus evidence paths.  No lock entry for the repo
           → the whole lint is ADVISORY (§6 last row).
CHAIN(G):  every docs/reviews/*.G<n>.S<digits>.R<digits>.md at HEAD
           (slot files `…-<k>.md` excluded by the pattern) whose verdict
           line is `pass` (plan manifests excluded), ordered by ancestry
           of head-sha: A before B iff A.head is a proper ancestor of
           B.head; the LAST is the one no other head descends from; two
           heads neither of which is an ancestor of the other → MISS
           "branched history".
           chain[0].base == ROUTE base:  and  chain[i].base == chain[i-1].head
           → else MISS "chain".   (the target manifest is a member of the
           chain like any other; nothing compares a manifest to itself)
TARGET:    done  → the manifest named by the verb's --goal/--step whose R is
           highest; its goal:/step:/item: lines must equal the verb's
           G<n>, S<j> and <item#> — all three (Codex C2); it must be the
           LAST element of CHAIN(G).
           close-goal → the last element of CHAIN(G); its head must equal
           the GATE block's subject:.
LEGS on TARGET (and, for close-goal, on every chain member):
 (a) each rubric: entry <name>@<h> → docs/reviews/rubrics/<name>.<h>.md
     exists at HEAD and sha256 == <h>
 (b) head is an ancestor of HEAD; base an ancestor of head
 (c) CHAIN holds (above)
 (d) paths: == sorted GOALPATHS;  slots: == 2 iff any frozen domain has
     review:"dual" in the locked contract else 1;  every non-missing slot
     file exists with the same range:/paths:;  verdict: == aggregate of
     the slot files' verdict: lines (missing/absent slot → inconclusive)
 (e) aggregate == pass
 (f) every slot line's <model> equals locked models.review (slot 1) or
     models.review-alt (slot 2) and its <tier> ranks ≥ locked tiers.review
     of every frozen domain, never below `high` (Codex C2: the header
     fields are verified, not decorative)
CLOSE TAIL (close-goal only, Codex C3): `git diff <last head>..HEAD
     --name-only`, evidence paths removed, must contain no file matching
     GOALPATHS (only evidence and other goals' domains may follow — the
     v2 two-commit protocol; holds on a shared HEAD)
```

Any miss blocks the transition and names the leg. `review: "dual"` is a
new optional domain field beside `tiers`.

**Where it runs and what that makes it (r6):** plan 4 puts these legs
into `hooks/contract-ship-gate.js` beside the existing `close-goal`
matcher (`:146`) and adds a `board-gh done --goal --step` matcher (a bare
`done <item#>` is refused once plan 4 ships: the hook cannot map an item
number to ids offline). From then on both transitions are **ENFORCED\***.
The lint adds no network call. Main's ship gate already has exactly one
(`git ls-remote --symref origin HEAD`, `hooks/contract-ship-gate.js:280`,
the push-base fallback when `origin/HEAD` was never set locally); the v2
rule is "a gate never fetches", and plan 4 tightens it to "never talks to
the remote": that fallback becomes a refusal naming `git remote set-head
origin -a` (Codex M3). Until plan 4 ships, today's hook checks
only the ledger line at HEAD, and no manifest exists — nothing in this
section is enforced yet, and no revision of this spec claims otherwise.
A forged manifest that satisfies all five legs is a *correct* manifest
of the right diff; the reviewer's judgment stays ADVISORY, as the v2
GATE block's legs are.

Rules, all INSTRUCTED unless noted:
- **Verdict is tri-state.** `inconclusive` goes to the Director via
  `attention` (§4), never auto-retried by Dev; after the Director clears
  attention the Coordinator re-runs the gate as the next round. The
  filename advances, the fix-round count does not.
- **Dual review** is a contract property, not a route choice (r5): a
  goal with any frozen domain marked `review: "dual"` in the locked
  contract gets two slots on every step round (r9: the goal's domains
  decide, not the diff — the same rule the lint's leg d applies). The script computes it the same way
  the lint does; the ROUTE line only records it. No `review-alt`
  configured → the script refuses before spawning anything.
- **Rubric selection is not caller text.** `recipe:` on a step is written
  at creation — by the Architect at plan time (reviewed under the plan
  round) or by the goal skill for a small goal's single step — and Dev
  never runs `add-item`. The rubric hashes in the manifest pin which
  rubrics were used.
- **Tests run on a detached worktree** created by the script under
  `<git-common-dir>/orch/wt/<review-id>/` and removed on exit. The script
  runs `git worktree add --detach` / `remove` itself (child_process — no
  hook sees it); the ship gate allowlist gains the same two commands
  **only for that path prefix** (plan 4) so a Dev typing the script's
  cleanup by hand is not refused; everything else about worktrees stays
  refused.
- **Evidence-only commits are a ship-gate grant, not an assumption.** Plan
  4 adds a built-in `commit` grant for the three evidence paths (above),
  matched before domains. It governs the commits the hook sees — the
  Coordinator's typed GATE/worklog commit, a Dev committing its worklog
  ledger. The script's own manifest commit is `child_process`, unseen by
  any hook (v2 caveat): its limit is **code** — the script commits with
  the pathspec `-- docs/reviews` and nothing else — so it is
  script-enforced, not ENFORCED\* (Codex M1). Until plan 4 ships the
  typed commits are done by the Director's hand (Opus S5). The grant lets
  any role commit the worklog — accepted, because the lint reads the
  frozen BRIEF (§5), not HEAD; a `ship: none` Dev thereby commits
  evidence, never code (Opus S3).
- **Fix rounds** (Coordinator counts **`fail` manifests** for the step,
  not `R` numbers): fails 1–2 resume the same Dev pane with the manifest
  **plus the failing test output and any conflict context** (Ralphinho:
  never a bare retry); fail 3 = fresh Dev one tier up; a finding that
  survives two fails, or the same error/empty diff twice (d.23) → stall
  → Director. Inconclusive rounds do not count.
- The reviewer's roster entry is written and removed by `orch review`
  itself (ADVISORY; a crashed script leaves a ghost the roster's stale
  rule prunes).

## 6. Guardrails — relabeled

`ORCH_ROLE` is process env: set by whoever launches a pane, inherited by
every subagent, settable by the pane itself. It is therefore **never a
credential**. Role guardrails catch a sloppy agent's drift; they do not
stop intent, and — the v2 caveat — the *hook* rows see only direct tool
calls. Every row below is **ADVISORY** except the last two.

| rule | mechanism | label |
|---|---|---|
| reviewer does not edit or ship | PreToolUse `Edit\|Write` refused outside `docs/reviews/` when `ORCH_ROLE=reviewer`; ship gate refuses commit/push when the role is `reviewer` | ADVISORY (both key on the role) |
| only a reviewer writes `docs/reviews/` | `Edit\|Write` under `docs/reviews/` refused unless `ORCH_ROLE=reviewer` (the script's own fs writes are unseen — the row catches a Dev editing a manifest by hand, nothing more) | ADVISORY — the evidence lint is what counts |
| coordinator reads no code | `Read` refused outside: `tmp/handoffs/`, `docs/reviews/`, `.claude/orch.json`, the focus goal's worklog (from the session marker) | ADVISORY (Bash reads unseen) |
| architect writes no production code | `Edit\|Write` refused on paths matching any contract domain's `paths` when `ORCH_ROLE=architect`; `docs/adr/`, worklog allowed | ADVISORY |
| dev changes no scope | `Edit\|Write` refused on the worklog's BRIEF block (first block) when `ORCH_ROLE=dev`; the issue-body BRIEF is protected by "only `board-gh` verbs mutate it" | ADVISORY + INSTRUCTED |
| no Stop without a handoff | Stop hook: session marker present with a role, ≥1 `Edit\|Write` in the transcript since `startedAt`, and no handoff newer than `startedAt` at the marker's path — `M<n>.G<k>.S<j>-dev.md`, `M<n>.G<k>-architect.md`, or `M<n>-coordinator.md` by role → refuse once, name the file | ADVISORY (fail-open on missing marker) |
| size budgets | Stop-time line counts: plan section ≤300 lines / ≤7 steps, handoff ≤40 | ADVISORY |
| verdict grammar, ≤5 questions, recipe stage order | skill text; grammar test pins the strings | INSTRUCTED |
| **review evidence** | the §5 legs in `contract-ship-gate.js` at `board-gh close-goal` and `board-gh done --goal --step` (plan 4); git + lock only | **ENFORCED\*** once plan 4 ships; until then only today's ledger check exists |
| evidence paths commit | built-in `commit` grant for `docs/reviews/**`, `tmp/worklogs/**`, `docs/adr/**` in the ship gate (plan 4) | **ENFORCED\*** for typed commits once plan 4 ships (today BLOCKED unless a domain grants them); the script's own manifest commit is unseen — pathspec-limited in code |
| ship rank, destructive git, protected dirs, read-before-write | unchanged from today | ENFORCED\* |
| **unlocked contract** | `hooks/lib/config.js:66-107` falls back to the agent-writable `.claude/orch.json` when the lock has no `repos[<key>]` entry; every leg above that reads contract data then verifies against a file the Dev can edit | every ENFORCED\* row keyed on the contract **degrades to ADVISORY** until `/orch:setup` mirrors the lock (r8, Opus S7) |

A pane launched without a role, or with a wrong one, gets today's
behavior plus at most a wrong advisory refusal; nothing security-relevant
depends on the role. The direct-tool caveat applies to the hook rows;
INSTRUCTED rows have no visibility at all, and the evidence lint reads
repo state, not tool calls (its own caveat is the v2 one: a `board-gh`
invocation the hook's matcher does not see — a wrapper script — bypasses
it, exactly as for the ship gate).

## 7. Flow — one goal

1. **Director**: `/orch:milestone define` once per objective; `/orch:goal`
   per goal (the Coordinator may propose one in a YOU item; only the
   Director creates it). The goal skill parses `feature:` from the BRIEF,
   registers the issue under a milestone, and **always creates at least
   one step** — for a small goal, the single `gate:` step `S1`.
2. **Coordinator** (per tick): read; pick the goal by §4's rule; kill
   check (`kill:` line); capacity check (fleet ceiling); pulse. **On the
   goal's first pick** — before any pane, Architect or Dev — the route
   phase writes the ROUTE line (`base:` = HEAD now, `review:` from the
   contract, tier/decide/ship from the contract), **creates the goal
   branch `goal/G<k>-<name>` at that `base:`** (d.33) and commits the
   worklog on it (evidence path). Every later manifest of the goal, plan
   rounds included, chains from this `base:` (r7); every pane of the goal
   works on this branch.
3. **Shape, only if fuzzy or big**: Architect pane. Research route if a
   knowledge gap; ≤5 questions (pane blocks; answers → accepted ADRs);
   plan section = `steps` (each `accept:` + an *execution* `recipe:`, §8)
   + `fog` (sharp-enough-to-name, not yet ticketed); `add-item` per step;
   checkers as it likes; `orch review G<k> --plan` → `P.R1` (range
   `base..base`, no diff); fail → revise and re-run as `P.R2`; pass →
   handoff, done. Clear or debugging goal → the goal skill already wrote
   `recipe:` on `S1`; skip this step. (The ROUTE line already exists from
   step 2; shaping only fills the plan section.)
4. **Dispatch** (d.29): if `workflow.dispatch: "confirm"` (default), the
   Coordinator asks the Director with a five-line proposal (goal/step ·
   role/tier/recipe · task line · touched domains and ship grant · caps)
   and options Go / Edit brief / Skip / Stop; `"auto"` writes the same
   five lines to the audit log and proceeds. Then: fresh pane
   `impl-G<k>-S<j>`, `ORCH_ROLE=dev`, session marker written, item Status
   → `In progress`, brief = the eight-section `delegate.md` brief whose
   MUST DO opens with the recipe's stages and whose CONTEXT names only
   this goal's worklog + listed ADRs.
5. **Dev**: works the step (checkers freely), commits where the contract
   grants `ship: commit` — under `ship: none` its handoff ends with the
   exact commit command for the Director, who commits before the gate
   runs (§3) — writes its handoff, runs `orch review …`. Dev
   may **propose** a fog graduation or a new step in its handoff; it
   never adds one (that is the Architect's, re-paned briefly by the
   Coordinator — d.9 amended).
6. **Gate**: the script refuses on a dirty tree under `paths:`, sets item
   Status `In review`, spawns the reviewer(s), writes the file(s), commits
   `docs/reviews/`. Coordinator reads the verdict: pass →
   `done --goal G<k> --step S<j> <item>` (evidence lint runs) → next step, or for the last step
   / a small goal → step 7; fail → hand-back per §5 rounds; inconclusive
   → `attention` → Director.
7. **Merge gate, once per goal**: ① full suite verdict line ② metric
   beats its noise band ③ root cause, no band-aid → GATE block in the
   worklog (`subject:<last passing manifest's head-sha> · regression ·
   metric · rootcause`), committed with the board/worklog as the evidence
   commit → push the goal branch per the contract's grant (`push`; a
   `commit`-only or `none` domain → hand the Director the push) → the
   Coordinator opens **one PR per goal** (title `G<k> · <name>`, body =
   BRIEF + links to every passing manifest; `gh pr create` is a typed
   command the ship gate sees) → **the Director merges** (owner-typed
   OWNER-APPROVED, as today; agents never merge) → `close-goal G<k>
   --evidence` after the merge (ledger check today; the §5 lint after
   plan 4; **refused when the goal has no step** — every goal has `S1`)
   → branch deleted, pane torn down, roster cleared. Steps are commits on
   the goal branch, never PRs of their own.
8. **Milestone**: when every goal under `M<n>` is merged the Coordinator
   writes a one-line summary against the milestone's `done:` into
   `tmp/handoffs/M<n>-coordinator.md`; `/orch:milestone close` shows it,
   asks for acknowledgement, and runs `close-milestone <n> --summary`,
   which appends `closed: <date> · summary: <line>` to the description and
   closes the Milestone. Refused when the milestone has zero goals, when
   any goal is not merged, or when the REST count of the milestone's
   `orch:goal` issues **differs** from what `read` returned (either
   direction — window too small, or a concurrent move).

Loop vehicle: `workflow.coordinator: "loop"` runs step 2 on every tick
via `/loop <interval> /orch:go`; a `confirm`-mode question blocks the
tick, which is the intended escalation. Herdr vehicle: same steps, with
`herdr agent start … --env ORCH_ROLE=… ` as the launcher and `wait
--until done|blocked`.

## 8. Recipes — two groups, chosen at route or plan time

A recipe is the named sequence of stages between the BRIEF and the gate.
It changes what the working role does and which rubric file the gate
hashes; it never changes hooks, the evidence lint, or the ship gate.

| group | recipe | fits | stages | gate rubric adds |
|---|---|---|---|---|
| **shaping** (Architect) | `spec` | fuzzy or big | brainstorm/grill → spec → `P.R1` → steps | plan covers `done:`; each `accept:` checkable |
| | `research` | knowledge gap | search → grade sources → findings note | sources cited and graded; no code |
| **execution** (Dev) | `tdd` | clear behaviour, testable seams | red at the seam → green → refactor | green-can-go-red |
| | `debug` | something is broken | reproduce → hypothesis → bisect → fix → regression test | a test that was red before the fix; root cause named |
| | `iterate` | a number to move, cause unknown | hypothesis first → change → measure → keep/revert | delta outside the noise band; `⚠complexity` weighed |
| | `cleanup` | slop after a feature landed | separate pass, separate agent | tests unchanged and green; the diff deletes |
| | `fast` | trivial, spec-complete | implement → test | mechanical step only |

Routing: shaping recipes belong to the Architect's pass (or the goal
skill's research route) and never to a step; every step carries an
execution recipe (`add-item --recipe` accepts only the execution group); a goal may use several across its life. One page per
recipe in `skills/go/recipes/<name>.md`; a recipe needing more than a page
is two recipes or a discipline that belongs downstream. Recipes are never
commands (d.20).

## 9. Skill routing — one chosen skill per stage

```json
"workflow": {
  "coordinator": "native | loop | herdr",
  "dispatch":    "confirm | auto",
  "tools":       { "<stage>": "<skill name>@<plugin version>" | null, … }
}
```

Resolution: `tools[stage]` if set and installed → orch's native fallback,
and the worklog ledger records which (`skill: <stage>=<name>`; the ROUTE
grammar is unchanged). A missing or version-mismatched skill falls back
and says so; `/orch:board` lists such stages. `/orch:setup` fills the map
(skill discovery via `/find-skills` when installed, native listed first)
and pins the installed plugin version. Orch ships **only the native
column**; every other cell is the operator's choice, recorded as data —
never a code import, never read by a hook.

**Decided 2026-09-05 (d.32), Pocock-first.** One rule shaped the picks:
`board-gh` is the only board writer, so every Pocock skill that publishes
to a tracker (`to-spec`, `to-tickets`, `wayfinder`) runs with
`/setup-matt-pocock-skills` set to the **local-markdown tracker** under
`.scratch/<feature>/` (gitignored; `docs/agents/issue-tracker.md`); the Architect turns those files into
`add-item` calls. Pointing that tracker at GitHub is a misconfiguration
`/orch:setup` checks for.

| stage | role | chosen skill | native fallback |
|---|---|---|---|
| define milestone | Director | `grilling` | three questions |
| grill / shape | Architect | `grill-with-docs` (ADRs + glossary → `docs/adr`) | three questions |
| spec | Architect | `to-spec` (local tracker) | plan section |
| split to steps | Architect | `to-tickets` (local tracker → `add-item` per ticket) | plan section |
| fog | Architect | `wayfinder` (local map) | fog list in the plan section |
| domain model | Architect | `domain-modeling` | ADR |
| tdd | Dev | `tdd` | ladder step 1 |
| debug | Dev | `diagnosing-bugs`; `bug-echo` after the fix (find siblings of the same pattern) | ladder step 1 |
| iterate | Dev | — | hypothesis → change → measure |
| cleanup | Dev | `safe-refactor` (verification brackets each edit) | de-sloppify prompt |
| fast | Dev | `implement` (from the step's ticket) | implement → test |
| research | Architect, Dev | `research` (findings file in the repo) | web search → grade sources |
| merge conflicts | Dev | — (`resolving-merge-conflicts` only when the owner says go) | stop, park for owner |
| gate rubric | Gate | `code-review` as the second axis (standards + spec on a fixed range) | `review-goal.md`, **always**, hashed |
| merge gate proof | Dev | `verify-and-stop` | full-suite verdict line |
| handoff | every role | `handoff` (brief adds the 40-line cap) | four-line handoff |

Providers shape craft, never safety: no hook reads this map; the gate
rubric is extended, never replaced; the Coordinator has no row. Superpowers
stays installed for the operator's own sessions; orch does not route to it.

## 10. Commands

Five, one per *who*, verbs for *what* (d.20). `orch review` is a script,
not a skill — so that its brief assembly is code, not prose.

| command | who | verbs / phases |
|---|---|---|
| `/orch:setup` | Director | contract (incl. the per-domain `review: "dual"` flag), models (incl. `review-alt`, asked whenever any domain is dual; the skill will not hand the operator a lock edit for a dual domain without `review-alt` — INSTRUCTED, the lock is the operator's file; r8, Opus S8), workflow, lock; runs `sync-features` after any domain change when `.orch/board.json` exists (Opus S10) |
| `/orch:milestone` | Director only — the skill refuses when `ORCH_ROLE` is set, and the verbs below refuse too (both ADVISORY; they exist so a roled pane cannot drift into scope; **replay of a pending Director-only action is likewise skipped and reported in a roled pane**) | `define` (three questions → `add-milestone`) · `split` (proposes goals from Feature options, creates nothing) · `prioritize` (`move G<n> <bucket>` on goals) · `close` (summary from `tmp/handoffs/M<n>-coordinator.md` shown, acknowledgement asked, `close-milestone --summary`) |
| `/orch:goal` | Director; Coordinator proposes | shape (§8 shaping recipes) → BRIEF → `add-goal` (parses `feature:`) → `add-item` per step (`--accept`, `--recipe`) |
| `/orch:go` | Coordinator (or today's single session) | route → work → ship; `loop`. The skill's old "judgment-heavy → dual review" route choice is deleted by plan 1 (dual is contract-only, d.3) |
| `/orch:board` | anyone | `init` (Project, labels, Feature seed) · `sync` (runs `sync-features`; the skill's read-only rule gains this second announced exception) · read · `html` |

`board-gh` verbs added by plan 1: `add-milestone`, `close-milestone`,
`sync-features`; `move` extended to goals (no separate `prioritize` verb).
All go through the write module: lock check, `withLock`, journal, and the
role refusal **before** `replay()` — and `replay()` itself skips (leaves
pending, reports) any Director-only action when the pane is roled.

## 11. Decisions (ledger; r3 wording is authoritative)

1. Coordinator frontier first; `mid` after one clean milestone.
2. One Coordinator per repo.
3. Second reviewer family via `models.review-alt`; dual is a locked contract flag per domain (`review: "dual"`), not a route choice *(r5)*; setup asks for `review-alt` and hands out no lock edit for a dual domain without it — INSTRUCTED *(r6, r8)*.
4. Reviews and worklogs git-tracked; handoffs scratch *(r5: worklog restored to git, as on main)*.
5. Ids `M.G.S.R` with slot files `R<r>-<slot>` and the plan round `P.R<r>` *(r4: every goal has ≥1 step; `M` and `G` are GitHub numbers)*.
6. Panes feed the v2 fleet roster.
7. Goal is the unit of work; milestone is the GitHub Milestone; Architect goal-sized and optional. *(r3: "lane" retired as a word; nothing renames on the lane side — main already ships `G<n>`.)*
8. Checker vs gate. *(r3: checker is a capability; the gate is defined by its verifiable header, not by who launches it.)*
9. Big goals get steps; gate per step; merge gate once per goal. *(r3: fresh Dev per step, see 24; fog graduation is the Architect's, Dev proposes.)*
10. Step level in ids, always present *(r4)*.
11. Milestone title `M<n> · <objective>` with `n` = the GitHub milestone number *(r4)*; `C<n>` ranks and is never renamed.
12. Plan review is `P.R<r>` *(r4; was `R0`)*.
13. `orch review` registers its reviewer in the roster (ADVISORY).
14. `S<j>` assigned at creation by `add-item`, stored as a `step:` body line, never renumbered *(r4)*.
15. Recipes are in (§8).
16. `/orch:milestone` with three-field milestones; `feature:` on the BRIEF; `accept:`/`recipe:` on steps.
17. Skill routing keyed by stage (§9); one chosen skill per stage in `workflow.tools`, native fallback shipped by orch, `prefer` dropped *(r10)*.
18. Domains are features: Feature options mirror contract domain names; `init` seeds, `setup` syncs; **Pipeline no longer seeded from domains** *(r3).*
19. Reprioritising: `move` for items and goals; Priority-first lane pick *(r3: one rule, §4).*
20. No sixth command; recipes are never commands.
21. Coordinator vehicles: `native | loop | herdr`.
22. Pulse line per tick; stale = pulse age.
23. No-progress detection, N = 2.
24. Fresh Dev per step by default; resident across rounds 1–2.
25. Milestones run concurrently; Coordinator singular; Priority wins across milestones; no two running goals own a common file — every domain in `domains:`, matched by files not globs *(r6)*.
26. *(r3)* "Lane" retired from the vocabulary; domain = workstream, metadata not identity.
27. *(r3)* Checker is a capability, not a role.
28. *(r3)* Recipes grouped as shaping vs execution.
29. *(r3)* Dispatch confirmation mode `workflow.dispatch: confirm|auto`, default `confirm`, five-line proposal via AskUserQuestion; `auto` logs the same lines.
30. *(r6)* The evidence lint is git-only: manifests are self-sufficient (`goal:`/`step:`/`item:` lines, content-addressed rubric copies under `docs/reviews/rubrics/`), `base:` lives in the worklog ROUTE line, written at the goal's first dispatch of any pane, and evidence paths carry a built-in ship-gate commit grant for typed commits. *(r7: the lint is the one algorithm in §5 — chain, target, legs, close tail.)*
31. *(r8)* The review range is goal-scoped: `domains:` and `base:` are read from the worklog as of the commit that introduced the ROUTE line; goal paths = their locked contract paths minus evidence paths; concurrent goals on one branch never enter each other's diffs.
32. *(r10)* Stage skills chosen Pocock-first (§9 table); tracker-publishing skills run on the local-markdown tracker so `board-gh` stays the only board writer; versions pinned by setup.
33. *(r11)* One branch and one PR per goal: branch `goal/G<k>-<name>` from the ROUTE `base:` at first pick; steps are commits on it; the Coordinator opens the PR after the merge gate; the Director merges; `close-goal` follows the merge. Rule 5 of §4 becomes a safety net for goals that still share a branch rather than the load-bearing isolation.

## 12. What would prove this is right

Before any hook is written: run one real milestone of two or three goals,
one of them big, on the `loop` vehicle with `dispatch: confirm`, panes
launched with `ORCH_ROLE` set and nothing enforcing it. Count: role
crossings of the "never" column; handoff line counts; whether the
Coordinator needed anything outside its allowlist; checker rounds per gate
round; recipes used and any step that wanted a missing one; how many
dispatch confirmations you actually changed. Those numbers order plan 3,
decide d.1 and d.29's defaults, and tell whether seven recipes is right.

## 13. Delivery and review provenance

Plans on `main`: (1) milestone + vocabulary (incl. `step:` ids, `base:` and
`review:` in ROUTE, `review-alt` in setup, journaled `sync-features`) · (2) recipes + skill routing
(the rubric files the lint hashes) · (3) role guardrails (ADVISORY) +
session marker + Stop rule · (4) `orch review` + manifests + evidence lint
+ the `unverified` flag on `read` + worktree allowlist + evidence-path
commit grant + `done --goal --step` · (5) coordinator vehicles (loop, then
herdr) + dispatch confirm.
1 first; 2 ∥ 3; **4 after 2 and 3**; 5 after 3 + 4.

r11 (no review round): d.33, branch and PR per goal (§7 steps 2 and 7).

r10 (no review round): the dual-review loop was stopped after round 6 —
from round 5 every finding was §5 lint precision; the residue (Codex r6
minors, Opus r6 unfinished) is an input to plan 4's own review. §9
rewritten per d.32.

r9 answers Codex round 6: C1 (plan-round header is script-written and
INSTRUCTED; only step manifests are ENFORCED\*), C2 (leg f verifies
model/tier against the lock), M1 (frozen lookup yields commit + path;
ambiguity is a miss), M2 (dual decided by frozen domains, prose = lint),
M3 (`skill:` is a ledger line, not a ROUTE field). Plan findings → plan
r7.

r8 answers Opus round 5: S1 (goal-scoped range from the frozen BRIEF;
rule 5's rationale now true), S2 (dirty check on goal paths before the
range), S3 (frozen `base:`/`domains:` at the ROUTE commit; grant stated),
S4 (`done --goal --step` in §4), S5 (`R<digits>.md` pattern), S6 (order
defined), S7 (unlocked-contract row), S8 (INSTRUCTED wording), S9 (goal
skill creates `S1`, INSTRUCTED), S10 (`sync-features` guard). Plan r5
PASSED Opus execution (nine green commits); Codex plan majors → plan r6.

r7 answers round 5 (Codex; Opus pending): C1 (the target is a chain
member, nothing compares a manifest to itself), C2 (`item:` bound to the
verb), C3 (close tail over the union of chain paths), M1 (script commit
is code-limited, not ENFORCED\*), M2 (ROUTE line at first dispatch of
any pane, so plan rounds have a base), M3 (main's `ls-remote` named;
plan 4 turns it into a refusal). Plan findings → plan r6.

r6 answers round 4: **Opus** S1 (rubric copies, content-addressed), S2
(git-only lint; `done --goal --step`; `goal:`/`step:`/`item:` in the
manifest), S3 (`base:` at first dispatch, worklog ROUTE), S4 (`ship:
none` → Director commits, gate refuses a dirty tree), S5 (built-in
evidence-path grant, plan 4; nothing claimed for today), S6 (evidence
paths excluded from domain matching), S7 (rule 5 by files, all domains),
S8 (`review-alt` in setup), minors 9–14 (§6 row wording; worktree
allowlist reason; `tmp/handoffs/` gitignore in plan 3; chain by ancestry;
missing-slot exit; go skill dual line deleted); **Codex** 1–3 (same),
majors (paths/slots/aggregate recomputed; pathspec-limited manifest
commit; range starts at previous head), minors (`R0` gone from §8;
execution-only step recipes). Plan findings → plan r5.

r5 answers round 3: **Opus** S1 (worklog in git), S2 (close leg = GATE
subject + empty domain diff), S3 (lint lives in the hook, plan 4; nothing
enforced before), S4 (`R0` gone), S5 (plan round range `base..base`), S6
(goal skill writes `recipe:` on `S1`), S7 (`paths:` + one running goal per
domain), S8 (hashes at `head-sha`), S9 (`orch review` calls the verb),
S10–S12; **Codex** 1–5 (same, plus `base:` in the goal issue and dual from
the locked contract), majors (manifests committed by the script, chain =
step manifests only; fail-count wording; close-milestone inequality),
minors. The v2 spec's §3 line "Pipeline seeded from domains, Feature
untouched" is superseded by §4 here; plan 1 edits that line.

r4 answered round 2: **Opus** S1–S3 (range rule, `step:` line, one
milestone number), S4–S8 (manifest slots, inconclusive exit, only-board-gh
closes + `unverified`, plan order, pick rule 0), S9–S12; **Codex** 1–3
(same three), 4 (`step:` stored), 5 (every goal ≥1 step), 6 (rounds
advance on inconclusive), 7 (manifest aggregate + `slots:` vs ROUTE), 8
(explicit child env, still ADVISORY), 9 (summary handoff), 10 (taxonomy
wording), 11–15 → plan r3, 16–19.

r3 answered round 1: **Opus** A1/A2 (§5–6 relabel, evidence lint), A3 (§4 fold),
A4 (§4 one rule), A5/A9 (§2, §4 M/C), A6 (§4 GitHub-only), A7 (§5 rubric
not caller text), A8 (§6 BRIEF row), A10 (§4 Pipeline), A11 (§5
worktree), A12–A18 (single grammars, counts, order); **Codex** 1–3 (as
above), 4 (Coordinator worklog), 5 (d.9/d.24), 6 (fog is Architect's), 7
(tri-state), 8 (dual slots + aggregation), 9–13 (state table, S ids), 14
(session marker), 15 (count); **operator's Codex verdict** (lane, checker,
recipe groups, over-orchestration risk). Reviewer findings on the plan are
answered in plan r2.

---

## A. Input — the artifact, verbatim

> # Agent orchestration architecture (Herdr)
>
> ## Summary
>
> A five-role hierarchy for delivering software milestones with AI agents. Herdr is the substrate: each role except the human runs as an interactive TUI in a Herdr pane, and the Coordinator drives the others through the Herdr CLI (start, prompt, wait, read). State lives in shared files, never in pane scrollback. Dev is the lowest Herdr-level session; anything below Dev is an in-session sub-agent.
>
> ## Roles
>
> | Role | Runtime | Effort | Owns | Does not |
> |---|---|---|---|---|
> | Director (human) | Attaches to panes | — | Direction, priorities, scope, irreversible decisions | Route tasks or review code |
> | Coordinator | Herdr pane, Fable 5.1 | medium | Dispatch, gating, milestone status | Design, implement, or re-review technically |
> | Architect | Herdr pane, Fable 5.1 | high | Research, decomposition, plan, ADRs | Write production code |
> | Dev | Herdr pane, goal-sized | as needed | Implementing one goal, tests, handoff note | Change scope or plan |
> | Reviewer | Ephemeral Herdr pane, Opus or Codex | high | Verdict on a plan or a goal | Fix what it finds |
>
> Dev may spawn in-session sub-agents for exploration or parallel edits. Sub-agents return short findings; they never receive the full plan or write handoffs.
>
> ## Communication
>
> **Herdr carries signals and prompts.**
> - Coordinator uses `herdr agent start` to open a role pane, sends the prompt, then `herdr agent wait --until done` (or `blocked`).
> - After a wait resolves, the Coordinator reads the role's handoff file, not the pane. Pane reads (`herdr pane read --lines N`) are for debugging only.
> - Any agent that needs the Director stops and asks a question. Herdr marks the pane `blocked`; the Director attaches, answers, detaches. There is no other escalation channel.
>
> **Files carry state.**
> ```
> .orchestration/
>   status.md        # milestone, current goal, blockers — under one screen
>   plan.md          # header (goals, order, status) + one section per goal
>   adr/NNN-*.md     # decisions, including Director answers to Architect questions
>   handoffs/
>     <role>-<goal>.md   # what changed, what is blocked, what was decided
>   reviews/
>     <goal>.md      # pass | fail, blocking reasons, non-blocking notes
> ```
>
> ## Flow
>
> 1. Director writes a milestone into `status.md` and prompts the Coordinator.
> 2. Coordinator starts the Architect pane with the milestone.
> 3. Architect researches, interviews the Director if needed (blocks; answers go into an ADR), writes `plan.md` decomposed into ordered goals with acceptance criteria, writes ADRs, then writes a handoff and finishes.
> 4. Coordinator starts a Reviewer pane for the plan. Fail → back to Architect with the review. Pass → continue.
> 5. For each goal in order:
>    1. Coordinator starts a Dev pane with the goal section only, plus relevant ADRs.
>    2. Dev implements, runs tests, writes a handoff, finishes.
>    3. Coordinator starts a Reviewer pane with the goal section, the diff, and the handoff. Reviewer runs tests and returns a verdict.
>    4. Fail → Dev pane with the review. Pass → Coordinator updates `status.md`, closes both panes.
> 6. When all goals pass, Coordinator writes the milestone summary and blocks for the Director.
>
> **Fast path.** For a small, well-understood goal the Coordinator may skip the Architect and go directly to Dev. The goal must still have written acceptance criteria and still goes through review.
>
> ## Contract
>
> - **Escalation.** Architect decides reversible technical questions alone and records them in an ADR. Scope, priority, cost, and irreversible choices go to the Director. Architect interviews are capped (e.g. five questions); after the cap it decides and records assumptions.
> - **Handoffs.** Every role ends by writing its handoff file. No role forwards another role's output into a prompt; the next role reads files on demand.
> - **Size budgets.** `status.md` under one screen. A goal section under ~300 lines. A handoff under ~40 lines. If a goal cannot fit, the Architect split it wrong.
> - **Review.** Verdict is `pass` or `fail`. Fail requires blocking reasons tied to acceptance criteria. Reviewer must run tests, not only read. Non-blocking notes are recorded but do not fail the goal.
> - **Coordinator statelessness.** The Coordinator reads `status.md`, takes one action, writes `status.md`, and waits. It may be restarted at any point without loss.
> - **Done.** A goal is done when its review passes. A milestone is done when all goals pass and the Director acknowledges.
>
> ## Context budget per role
>
> | Role | Reads | Never reads |
> |---|---|---|
> | Coordinator | `status.md`, latest handoff, latest review | Full plan, code, pane scrollback |
> | Architect | Milestone, codebase (via research), prior ADRs | Other goals' handoffs |
> | Dev | Its goal section, relevant ADRs, files it edits | Full plan, other goals |
> | Reviewer | Goal section, diff, handoff, tests output | Unrelated repo areas |
>
> ## Open points
>
> - Choice of Dev model per goal (fixed vs picked by Coordinator).
> - Whether the Reviewer for plans and for code should have different rubrics (recommended: yes, two prompt templates, one role).
> - Herdr-specific plumbing can be borrowed from the existing `herdr-orchestration` skill rather than rewritten.
