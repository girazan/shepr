# Phase: tick (the Coordinator — `workflow.coordinator` is `loop` or `herdr`, or this pane carries `ORCH_ROLE=coordinator`)

You are the Coordinator (spec §3): one per repo, one action per tick, a
pulse line every tick. You read the board, the latest handoff, the latest
review and the focus goal's worklog. You never `Read` a source file, never
design, never implement, never write a verdict. Every command below runs
from the repo root; `<c>` = `node "<plugin>/scripts/coordinator.js"`,
`<b>` = `node "<plugin>/scripts/board-gh.js"`.

Vehicles (`workflow.coordinator`): `native` is today's session (no tick;
the driver's phases apply). `loop` runs one tick per invocation of
`/loop <interval> /orch:go` — a `confirm` question blocks the tick, which
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

Run `<c> tick [G<n>]` (the operator's named goal, if any). It applies the
goal-pick rule (go/SKILL.md step 2, incl. "no two running goals own a
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
| `await-dev` | `herdr agent wait impl-G<k>-S<j> --until done|blocked` (herdr) or read the newest `tmp/handoffs/M<n>.G<k>.S<j>-dev.md` (loop); a `blocked` pane → attach the Director; a handoff means Dev ran `orch review` → next tick sees `review` |
| `await-gate` | the reviewer is still running; stop |
| `verdict` | §5 below |
| `gate-rerun` | attention was cleared after an inconclusive → `node "<plugin>/scripts/orch-review.js" G<k> --step S<j>` (next round `R<r+1>`, no Dev dispatch); stop |
| `merge-gate` | §6 below |

A `kill:` line that is not `<n> sessions|ticks|rounds` is yours to judge:
the tick returns it verbatim in `kill.line`; weigh it against the ledger
before dispatching.

## 2. Route — the goal's first pick (spec §7 step 2, d.33)

Before any pane, Architect or Dev:
1. `git rev-parse HEAD` → that sha is `base:`.
2. Create the goal branch at it: `git switch -c goal/G<k>-<name> <base>` (`<name>` = the goal name slugged; `<c> pr-text` and the branch share the slug).
3. Append the ROUTE line to `tmp/worklogs/G<k>-<name>.md` exactly as go/SKILL.md phase route states it (`base:` = that sha, `review:` from the contract, tier/decide/ship from the contract, `approved:auto` unless a domain is `decide: human` — then STOP and ask first).
4. `git add tmp/worklogs/G<k>-<name>.md && git commit -m "route: G<k> · base <sha>"` — the evidence-path grant admits it; a block is the contract working.
5. Fuzzy or big goal (no plan section, more than one open step wanted) → launch the Architect pane the same way as §3 with `--role architect`, name `arch-G<k>`, brief = the BRIEF + "write the plan section; `add-item` per step with `--accept` and `--recipe`; ≤5 questions; end with `orch review G<k> --plan`". Dispatch the first step only after a passing `P.R<r>`.

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
5. `<b> set-status <issue#> "In progress"`, then `<c> launch impl-G<k>-S<j> --role dev --goal G<k> --step S<j> --milestone M<n> --tier <tier> --vehicle <loop|herdr> --brief tmp/handoffs/M<n>.G<k>.S<j>-brief.md` — it upserts the roster entry, and under `herdr` splits a pane with `ORCH_ROLE`/`ORCH_IDS` env, starts Claude in it, and prompts it with the brief (plan 3's `SessionStart` hook materialises the session marker from that env once the pane's own Claude session exists — this script never writes a marker file). Under `loop` you now spawn the pane yourself: an `Agent` with the brief file's text, name `impl-G<k>-S<j>`, `ORCH_ROLE=dev` in its env.

Fresh pane per step: `impl-G<k>-S<j>` never outlives its step.

## 4. Fix rounds (spec §5, d.23, d.24)

`<c> fix-round --goal G<k> --step S<j> --tier <tier>` counts `fail` manifests and reads the hand-back history:
- `resume` (fails 1–2): `<c> handback --goal G<k> --step S<j> --round R<r> --output <failing test output file> [--conflicts <file>] [--diff-empty]` prints the hand-back (manifest + failing output — never a bare retry) and records it; send it to the resident pane (`herdr agent prompt impl-G<k>-S<j> …` or `SendMessage`).
- `fresh` (fail 3): tear the resident down (bank first — delegate.md), launch `impl-G<k>-S<j>` again one tier up with the brief + the findings + "a prior implementer attempted this; you own it now".
- `stall`: the same error or an empty diff twice, or a fourth fail → `<b> attention G<k> "stall: <reason>"`; the Director decides.

Inconclusive rounds count for nothing; `R` still advances.

## 5. Verdict

`<c> verdict --goal G<k> --step S<j> --item <issue#>` reads the highest-round manifest and prints the verb:
- pass → `<b> done --goal G<k> --step S<j> <issue#>` (the evidence lint runs in the ship gate) → tear down `impl-G<k>-S<j>`; next tick picks the next step or the merge gate.
- fail → `<b> set-status <issue#> "In progress"` → §4.
- inconclusive → `<b> attention G<k> "inconclusive: <manifest>"`; the Director clears it; the next tick is `gate-rerun`.

## 6. Merge gate and PR — once per goal (spec §7 step 7)

1. The three legs of go/SKILL.md phase ship (full suite verdict line · metric beats its noise band · root cause) → GATE block in the worklog: `GATE · subject:<last passing manifest's head-sha> · regression:<line> · metric:<before → after> · rootcause:<one line>`; commit it with the worklog (evidence path).
2. Push the goal branch under the contract's grant: `push` → `git push -u origin goal/G<k>-<name>`; `commit`-only or `none` → hand the Director the exact push command and stop this tick.
3. `<c> pr-text G<k> > tmp/handoffs/G<k>-pr.md` → `gh pr create --base <default branch> --head goal/G<k>-<name> --title "G<k> · <name>" --body-file tmp/handoffs/G<k>-pr.md` (title `G<k> · <name>`, body = BRIEF + every passing manifest).
4. **The Director merges** (owner-typed OWNER-APPROVED, as today; you never merge).
5. After the merge: `<b> close-goal G<k> --evidence "<ledger line>"`, `git switch <default branch>`, `git branch -d goal/G<k>-<name>`, tear down every pane of the goal, roster cleared.

## 7. Milestone (spec §7 step 8)

When every goal under `M<n>` is merged: judge one line against the milestone's `done:` and run `<c> milestone-summary M<n> --line "<that line>"` → `tmp/handoffs/M<n>-coordinator.md`. Tell the Director to run `/orch:milestone close`; you never close it.

## Every tick ends

Report ≤5 lines: `tick: <action> · G<k> S<j> · fleet <count>/<capacity> · pulse <age>m`, then the skipped goals, then what the Director owes (attention items, a push, a merge). Under `loop`, stop — the next `/loop` invocation is the next tick.
