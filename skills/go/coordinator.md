# Phase: tick (the Coordinator — `workflow.coordinator` is `loop` or `herdr`, or this pane carries `ORCH_ROLE=coordinator`)

You are the Coordinator (spec §3): one per milestone, one action per tick,
a pulse line every tick. Unscoped — no `ORCH_IDS` — you are the repo's only
Coordinator and see the whole board; with `ORCH_IDS=M<n>` (the milestone's PROGRAM
ORDINAL from its title, never the GitHub milestone number) you pick only from
M<n>'s goals, and a second Coordinator may run M<k> beside you. Scope
narrows your CANDIDATES only: rule 5 still refuses a goal that shares a file
with any running lane, including the other milestone's. The fleet ceiling is
the repo's and is shared — losing the race is `wait-capacity`, not an error. You read the board, the latest handoff, the latest
review and the focus goal's worklog. You never `Read` a source file, never
design, never implement, never write a verdict. Every command below runs
from the repo root; `<c>` = `node "<plugin>/scripts/coordinator.js"`,
`<b>` = `node "<plugin>/scripts/board-gh.js"`.

Vehicle by work type (v0.10): a herdr pane for anything long-running that
the Director may want to watch or steer — a code lane (rounds, reviews,
rulings) and design work the Director leads. An in-session `Agent` for the
rest: review slots, research, bisect, board sync, retrospectives. No
concurrency cap beyond the fleet ceiling; the real limit is ruling
throughput — when `owner-queue.js tick` shows a ruling older than 24 h,
open no new lane until it drains.

Vehicles (`workflow.coordinator`): `native` is today's session (no tick;
the driver's phases apply). `loop` runs one tick per invocation of
`/loop <interval> /shepr:go` — a `confirm` question blocks the tick, which
is the intended escalation. `herdr` runs the same tick and launches panes
with `herdr pane split --cwd <repo> --env ORCH_ROLE=… --env ORCH_IDS=…`
then `herdr agent start <pane-name> --kind claude --pane <pane-id>` and
`herdr agent prompt <pane-name> <brief text>`, then waits with
`herdr agent wait <pane-name> --until done|blocked` (flags verified
against `herdr --help` / `herdr agent start --help` / `herdr agent wait
--help` when this plan was executed — the real CLI has no `--env` on
`agent start`; env is set at pane creation, and `wait` is a subcommand of
`agent`, not a top-level `herdr wait`).

## 1. Tick

Run `<c> tick [G<n>] [--milestone M<n>]` (the operator's named goal, if
any; the scope defaults to this pane's session marker, so pass `--milestone`
only to override it). A named goal outside the scope is refused, not
silently retargeted. It applies the
goal-pick rule (go/native.md step 2, incl. "no two running goals own a
common file"), the `kill:` check, the fleet ceiling, and appends the
pulse line `{by:"pulse"}` to `.claude/orch-audit.jsonl`. Its `action` is
this tick's one action; `skipped[]` names every goal passed over and why
— report those lines, never re-decide them.

| action | do |
|---|---|
| `idle` | report "nothing eligible" with `skipped[]`; stop |
| `kill` | the goal's `kill:` line tripped (`counted` dispatches) → `<b> attention G<k> "kill: <line>"`; stop |
| `route` | §2 below (first pick: branch + ROUTE line), then stop — the next tick dispatches |
| `dispatch` | §3 below |
| `wait-capacity` | report `fleet <count>/<capacity>`; stop |
| `await-dev` | `herdr agent wait impl-G<k>-S<j> --until done|blocked` (herdr) or read the newest `tmp/handoffs/M<n>.G<k>.S<j>-dev.md` (loop); a `blocked` pane → attach the Director; a handoff means Dev ran `shepr review` → next tick sees `review` |
| `await-gate` | the reviewer is still running; stop |
| `verdict` | §5 below |
| `gate-rerun` | attention was cleared after an inconclusive → `node "<plugin>/scripts/shepr-review.js" G<k> --step S<j>` (next round `R<r+1>`, no Dev dispatch); stop |
| `merge-gate` | §6 below |
| `sweep` | once per 7 days (`board.sweepIdleDays`, default 14, is the idle cut): `<c> sweep` prints the plan; `<c> sweep --apply` closes PRs idle past the cut as parked and deletes lane branches already merged; unmerged lane branches are only listed for the Director; open issues without a triage state are counted, never labelled. Report its one `sweep:` line |

A `kill:` line that is not `<n> sessions|ticks|rounds` is yours to judge:
the tick returns it verbatim in `kill.line`; weigh it against the ledger
before dispatching.

## 2. Route — the goal's first pick (spec §7 step 2, d.33)

Before any pane, Architect or Dev:
1. `git rev-parse HEAD` → that sha is `base:`.
2. Create the goal branch at it: `git switch -c goal/G<k>-<name> <base>` (`<name>` = the goal name slugged; `<c> pr-text` and the branch share the slug).
3. Append the ROUTE line to `tmp/worklogs/G<k>-<name>.md`, exactly
   `ROUTE: lane:G<n> · <domain> · decide:<ai|human> · ship:<none|commit|push> · tier:<model-tier> · base:<sha> · review:<single|dual> · approved:<operator|auto> · <date>`
   (`base:` = that sha, `review:` from the contract, tier/decide/ship from the contract, `approved:auto` unless a domain is `decide: human` — then STOP and ask first).
3b. Anchor test (v0.10, `workflow.anchorTest.domains`): `<c> anchor G<k>` reads the BRIEF and appends one `Ruling: anchor-test · …` line. Exit 0 → the steps keep their recipes. Exit 2 → the goal touches an anchored domain (numerics, physics) with no `anchor:` line or no predicted `<before> → <after>` on `metric:` — the first step runs the `research` recipe and must end by writing the `anchor:` line and the predicted delta into the BRIEF; only then does the coordinator dispatch the next step. An anchor is a PFD/operating-manual value, a conservation closure, or a textbook/vendor correlation — cited, never remembered.
4. `git add tmp/worklogs/G<k>-<name>.md && git commit -m "route: G<k> · base <sha>"` — the evidence-path grant admits it; a block is the contract working. This and the close commit in §6 are the only two worklog commits a goal makes; rounds append to the file, they never commit it.
5. Fuzzy or big goal (no plan section, more than one open step wanted) → launch the Architect pane the same way as §3 with `--role architect` and **no `--step`** (an Architect's name has none): the name is derived as `arch-G<k>`, and like §3 it is not an argument you pass. Brief = the BRIEF + "write the plan section; `add-item` per step with `--accept` and `--recipe`; ≤5 questions; end with `shepr review G<k> --plan`". Dispatch the first step only after a passing `P.R<r>`.

Every pane of this goal works on this branch; steps are commits on it, never PRs of their own.

## 3. Dispatch (d.29)

1. Compose the brief: the eight sections of `delegate.md`; MUST DO opens with the recipe's stages copied from `skills/go/recipes/<recipe>.md`; CONTEXT names only this goal's worklog and the ADRs the step lists. Write it to `tmp/handoffs/M<n>.G<k>.S<j>-brief.md`.
2. Tier = the strictest of the route's tier and every listed domain's `tiers.work`.
3. `<c> proposal --goal G<k> --step S<j> --item <issue#> --text "<step text>" --role dev --tier <tier> --recipe <recipe> --task "<TASK line>" --domains <a,b> --ship <grant> --review <single|dual> --fails <n> --kill "<kill line>" --mode <confirm|auto>` prints the five lines:

```
goal/step:        G<k> · S<j> · #<item> · <step text>
role/tier/recipe: dev · <tier> · <recipe>
task:             <TASK line>
domains/ship:     <domains> · ship:<grant> · review:<single|dual>
caps:             fails <n>/3 · no-progress 2 · fleet <count>/<capacity> · kill: <line>
```

4. `workflow.dispatch: "confirm"` (default): ask the Director with AskUserQuestion — the five lines as the question, options Go / Edit brief / Skip / Stop. Go → step 5. Edit brief → apply the Director's words to the brief file verbatim, re-run step 3. Skip → pulse `skipped by Director`, stop. Stop → stop the loop (`/loop` off), stop. `"auto"`: the proposal is already in the audit log; proceed.
5. `<b> set-status <issue#> "In progress"`, then `<c> launch --role dev --goal G<k> --step S<j> --milestone M<n> --tier <tier> --vehicle <loop|herdr> --brief tmp/handoffs/M<n>.G<k>.S<j>-brief.md` — **the pane name is not an argument**: it is derived as `impl-G<k>-S<j>` from `--goal`/`--step`, printed on the first line of the output, and a leftover name argument is refused. It upserts the roster entry (recording the pane's id, the one identity a rename cannot break), and under `herdr` splits a pane with `ORCH_ROLE`/`ORCH_IDS` env, starts Claude in it, and prompts it with the brief (plan 3's `SessionStart` hook materialises the session marker from that env once the pane's own Claude session exists — this script never writes a marker file). Under `loop` you now spawn the pane yourself: an `Agent` with the brief file's text, name `impl-G<k>-S<j>`, `ORCH_ROLE=dev` in its env.

Fresh pane per step: `impl-G<k>-S<j>` never outlives its step.

## 4. Fix rounds (spec §5, d.23, d.24)

`<c> fix-round --goal G<k> --step S<j> --tier <tier>` counts `fail` manifests and reads the hand-back history:
- `resume` (fails 1–2): `<c> handback --goal G<k> --step S<j> --round R<r> --output <failing test output file> [--conflicts <file>] [--diff-empty]` prints the hand-back (manifest + failing output — never a bare retry) and records it; send it to the resident pane (`herdr agent prompt impl-G<k>-S<j> …` or `SendMessage`).
- `fresh` (fail 3): tear the resident down (bank first — delegate.md), launch `impl-G<k>-S<j>` again one tier up with the brief + the findings + "a prior implementer attempted this; you own it now".
- `stall`: the same error or an empty diff twice, or a fourth fail → `<b> attention G<k> "stall: <reason>"`; the Director decides.

Inconclusive rounds count for nothing; `R` still advances.

A hand-back containing `NEEDS RULING:` is not a fail round: the
coordinator turns it into ONE queue entry — `node "<plugin>/scripts/owner-queue.js" park --item <issue#> --q "…" --opt a="…" --opt b="…" --rec <letter> --evidence <pointer>` — with its own recommendation, and moves to the next runnable step. The item's Feature decides whether the entry auto-resolves (`rulings.autoResolveHours`) or waits for the operator; send the digest (below) so the phone sees it. `attention` stays for halts (LIVENESS, kill, stall), never for questions with options. At the start of every tick run `owner-queue.js tick`; an `AUTO` line is a ruling to act on, a `WARN` line goes into the tick report.

## 5. Verdict

`<c> verdict --goal G<k> --step S<j> --item <issue#>` reads the highest-round manifest and prints the verb:
- pass → `<b> done --goal G<k> --step S<j> <issue#>` (the evidence lint runs in the ship gate) → tear down `impl-G<k>-S<j>`; next tick picks the next step or the merge gate.
- fail → `<b> set-status <issue#> "In progress"` → §4.
- inconclusive → `<b> attention G<k> "inconclusive: <manifest>"`; the Director clears it; the next tick is `gate-rerun`.

## 6. Merge gate and PR — once per goal (spec §7 step 7)

1. The three merge legs (go/native.md phase ship: full suite verdict line · metric beats its noise band · root cause) → GATE block in the worklog: `GATE · subject:<last passing manifest's head-sha> · regression:<line> · metric:<before → after> · rootcause:<one line>`; commit it with the worklog (evidence path).
2. Push the goal branch under the contract's grant: `push` → `git push -u origin goal/G<k>-<name>`; `commit`-only or `none` → hand the Director the exact push command and stop this tick.
3. `<c> pr-text G<k> > tmp/handoffs/G<k>-pr.md` → `gh pr create --base <default branch> --head goal/G<k>-<name> --title "G<k> · <name>" --body-file tmp/handoffs/G<k>-pr.md` (title `G<k> · <name>`, body = BRIEF + every passing manifest).
4. **The Director merges** (owner-typed OWNER-APPROVED, as today; you never merge).
5. After the merge: `<b> close-goal G<k> --evidence "<ledger line>"`, then the goal's one closing commit on the default branch — `git add tmp/worklogs/G<k>-<name>.md docs/reviews/M<n>.G<k>.* && git commit -m "docs(worklog): G<k> close"` — then `git switch <default branch>`, `git branch -d goal/G<k>-<name>`, tear down every pane of the goal, roster cleared. Board state lives on GitHub only; nothing under `docs/BOARD*.md` is written.

## 7. Objective and milestone (spec §7 step 8)

A goal that closes may complete its outcome (`O<n>`, the goal issue's parent). You never close an outcome: an outcome closes when its `done:` line is demonstrated, not when its goals are merged. When the last open goal under an outcome merges, put one line in the tick report: `outcome O<n> · every goal merged · done: <its done line> — Director to demonstrate and close`.

When every goal under `M<n>` is merged: judge one line against the milestone's `done:` and run `<c> milestone-summary M<n> --line "<that line>"` → `tmp/handoffs/M<n>-coordinator.md`. Tell the Director to run `/shepr:milestone close`; you never close it.

## Waiting between ticks (v0.11)

A tick on a timer pays tokens for every quiet interval. End each tick with
`<c> wait [--timeout <s>] [--poll <s>]`: it blocks inside the script — no
tokens, no turn — and returns the moment the fleet actually changes, printing
one `wake: <reason>` line. It wakes on a lane reaching `idle`/`done`/`blocked`,
a lane joining or leaving, a ruling being decided, a new review manifest, or a
phone command (`wake: phone: <text>`); otherwise on its timeout (default 1800 s,
`fleet.waitTimeoutSeconds`). Under `/loop` the interval becomes a fallback, not
the driver: the wake line is the first thing the next tick reports. "Lane" means
a name in `.git/orch/fleet.json` — `herdr agent list` shows every pane in every
workspace, including this one, so an unfiltered watcher run in the background
woke on its own turn ending. Run it in the background (`run_in_background`) so
the harness re-invokes the tick when it returns.

## The phone (v0.11.1 — no assistant pane)

`telegram.js poll` runs as one detached process per repo (`.orch/telegram-poll.pid`
is the lock; a second instance exits 75). It turns button presses into decisions
by itself and appends the four allowlisted texts to `.orch/assistant-inbox.jsonl`,
which `wait` reports as `wake: phone: <text>`. On that wake: `stop` → finish the
step in flight, open no lane, write the handoff; `focus G<n>` → that goal is
`named` for the next pick; `status` / `digest now` →
`node "<plugin>/scripts/owner-queue.js" digest | node "<plugin>/scripts/telegram.js" digest`.
Send that same digest whenever you park a ruling. If the poller is not running,
start it: `node "<plugin>/scripts/telegram.js" poll > tmp/telegram-poll.log` detached.

## Every tick ends

Report ≤5 lines: `tick: <action> · G<k> S<j> · fleet <count>/<capacity> · pulse <age>m`, then the skipped goals, then `corrected:` and `drift:` — one line per entry, or nothing when both are empty. The tick RECONCILES the roster against the live fleet before it reads capacity: a roster row whose pane is gone is dropped and a pane whose label left its row is renamed back, each with its own audit line. `corrected` is what it did; `drift` is what is LEFT — orphans, which are shepr-named panes with no roster row and may be the other Coordinator's, so they are reported and NEVER adopted, plus anything a rename failed on (`driftFailed`). Then what the Director owes (attention items, a push, a merge). Under `loop`, stop — the next `/loop` invocation is the next tick.
