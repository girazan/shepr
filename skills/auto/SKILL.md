---
name: auto
description: >
  Unattended autopilot over the board: `/shepr:auto [Xh|until-stop] [G<n>]`.
  Cuts an integration branch that ONLY autopilot merges into (never main),
  runs /shepr:go's loop phase against it, merges passing PRs server-side
  with the full gate, measures after every merge, and stops on a deadline
  or a stop condition with a handoff written. Use when the operator says
  "autopilot", "overnight", "/go autopilot Nh". Do NOT use for a single
  goal's supervised work (/shepr:go), shaping (/shepr:goal), or the
  contract (/shepr:setup).
---

# /shepr:auto — unattended run onto an integration branch

Premise: main is the operator's. Autopilot lands work on
`autopilot/<YYYY-MM-DD>` and nothing else; the operator reviews that branch
commit by commit (one squash per PR) and clicks it onto main, or reverts
one commit and clicks. Every guard that holds in a supervised session holds
here — this skill adds a base branch, not a permission.

## Arguments

`[Xh]` wall budget (e.g. `3h`); `until-stop` = no deadline; `G<n>` = focus
goal (else /shepr:go's focus rule picks). `status` prints the marker;
`stop` ends the run at the next safe point (after the current merge or
measurement, never mid-merge).

With `ship: merge` domains (v0.9.0) a PR whose files all sit in merge
domains may target main directly and land there under the merge-check;
the integration branch remains the path for everything else and for
`decide: human` files. Run `owner-queue.js tick` every round.

## Preconditions (refuse to launch until all hold)

1. `destructiveGit.mergeBases` lists the autopilot pattern (e.g.
   `["autopilot/*"]`) — otherwise `gh pr merge` is blocked and the run can
   only open PRs. Say so and stop; the operator sets it via /shepr:setup.
2. `workflow.worktreeRoots` lists the lane root (e.g. `[".worktrees"]`).
3. Loop preflight from `go/loop.md` passes for the focus goal: machine
   promise, boundaries, iteration + spend cap, independent reviewer,
   numeric checklist.
4. Main checkout clean under the goal's paths; no OWNER-only pane in the
   fleet is mid-item (read their DONE markers; never type into them).

## Launch

1. `git fetch origin main`; `git worktree add -b autopilot/<date> .worktrees/autopilot origin/main`; `git push -u origin autopilot/<date>`.
2. Write `.orch/autopilot.json`: `{ branch, startedAt, deadline|null, focus, stops: [] }`.
3. Worklog LAUNCH line (loop.md shape) plus `AUTOPILOT <date> · base autopilot/<date> · budget <Xh|none>`.
4. Push notification: "autopilot started, base <branch>, deadline <t>".

## The loop (one round)

1. Focus per /shepr:go; lanes branch FROM `origin/autopilot/<date>`, not main.
2. Lane → draft PR against **base `autopilot/<date>`** (`gh pr create --base`).
   A PR opened against main by mistake: `gh pr edit <n> --base autopilot/<date>`.
3. Gate: ship.md's three legs, plus a SECOND-FAMILY review on numerics **only when
   `models.review-alt` is configured** (a non-Claude reviewer, e.g. `codex`; launch,
   watch with `scripts/codex-watch.js` — CRLF-safe, one event per file — post
   verdict, ledger). No `review-alt` = that leg does not exist; run the three legs
   and say so, never spawn a reviewer the contract does not name.
   FAIL → fix round per the review ladder (cap 3) or park.
4. Merge: `gh pr merge <n> --squash --delete-branch` (allowed only because
   the base matches `mergeBases`; the project's merge-evidence gate still
   checks Suite/Metric/Baseline/Closes). Squash title = `#<n> <title>`, plus
   ` | <alt> r<k> PASS` when a second-family review ran.
5. Measure on the new tip: the goal's metric probe (settle ×2, certify ×2,
   RTF where the goal says). Record the number in the worklog. Boots go
   through the MAIN lock, serially — parallel boots starve each other.
6. Board: `set-status` items; parked owner decisions → `add-item --you`.
7. Lanes: cut/retire worktrees under the granted root; a lane whose context
   runs out is replaced by a fresh lane from its branch HEAD, same brief.
8. Findings in `decide: ai` domains become issues (type + subsystem labels);
   findings in `decide: human` domains go to `tmp/OWNER-QUEUE.md`.

## Stop conditions (first hit ends the run)

| Stop | Action |
|---|---|
| deadline reached | finish the in-flight merge/measurement, then stop |
| LIVENESS fail (non-determinism, frozen tags) | HALT — never revert; push notification |
| 3 rounds with no metric movement beyond the noise band | stop, name the wall |
| a `decide: human` answer is needed to continue AND no other goal is runnable | stop |
| quota window empty | PAUSE (not a flat round); resume when lanes resume |
| fleet ghost past `fleet.staleMinutes` | replace the lane once; twice → stop |
| operator `stop` | next safe point |

## Always before stopping

1. Handoff block (done · next action · entry phase · blockers + owners).
2. `tmp/OWNER-QUEUE.md`: every parked decision as a/b/c with the evidence pointer.
3. Open (draft) the review PR `autopilot/<date> → main` whose body lists every
   merged PR with its review verdict link (second-family, when one ran) and the
   tip measurement. The operator merges it (one click) or reverts one commit
   on the branch (`git revert <sha>` is theirs) and merges.
4. Push notification with the tip number and the queue length.
5. `.orch/autopilot.json` → `stoppedAt`, `reason`.

## Never

Main. `plant.yaml`, `acceptance/`, the contract, ADR ratification, the
OWNER-APPROVED marker, killing processes it did not start, guessing a
`decide: human` value to keep moving.
