---
name: go
description: >
  The orch session driver. Use for any work session after a goal exists:
  reads the board, worklogs, contract, and unratified ADRs, decides the
  current phase (route/work/ship/loop) by ordered precedence, acts, and
  reports. The human decides only what the contract reserves for them.
  Do NOT use to shape a new goal (/orch:goal), edit the contract or
  ratify ADRs (/orch:setup), or just view progress (/orch:board).
---

# /orch:go — the session driver

Every board verb below runs as `node "<plugin>/scripts/board-gh.js" <verb> …`.

Premise: the operator decided ONCE (`.claude/orch.json` → `contract`)
which domains are theirs. Everything else you decide, review, and ship —
every decision leaves a record. You are the orchestrator: frontier-tier
judgment, verdict-only; suited cheap models execute.

## On every invocation

1. Read: `node "<plugin>/scripts/board-gh.js" read --json` · the active
   goal's worklog · `docs/adr/` for `Status: proposed` · the contract.
2. Focus — exactly one goal per session when several are open:
   `blocked`/`needs_attention` never → named goal → `running`/`review` first → Priority bucket across milestones → lower milestone → lower issue
   (`/orch:go G142` names one). Never silently switch focus mid-session.
   Skip a candidate whose files (every domain in its `domains:`, by contract paths at HEAD) intersect a `running` goal's — two running goals never own a common file.
   A roled pane records the pick so the guardrails and the Stop rule know the focus goal: `node "<plugin>/scripts/session-marker.js" set --goal G<n>` (no-op message when `ORCH_SESSION_ID` is unset — a plain session has no marker).
3. Report ≤5 lines, opening with
   `focus: G<n> · <name> (+<k> open)` — then phase, blockers (⚠ + age if
   a lane sat in one status past `board.staleDays`, default 3),
   unratified ADRs with ages, parked items.
4. Decide the phase — ORDERED, first match wins:

| # | Condition | Phase |
|---|---|---|
| 1 | goal status `merged` | closed → report, stop; a merged goal never re-enters ship or loop |
| 2 | operator's message asks for an autonomous run | loop → load `loop.md` |
| 3 | no goal / no BRIEF | → point to `/orch:goal`, stop |
| 4 | BRIEF, no `ROUTE:` line | route (below) |
| 5 | `ROUTE:` exists, done-condition not evidenced | work → load `work.md` |
| 6 | ledger satisfies the BRIEF's `done:` | ship (below) |

Never advance past a missing artifact — refuse and point back. Skipped
steps are visible, never silent.

## The board

Canonical store: GitHub Issues + the repo's Project (`.orch/board.json`,
spec §4). Milestone (operator's, `M<n> · …`; legacy `C<n>` still sorts) → goal = `orch:goal` issue
(`G<n>`) → items = sub-issues; the item marked `gate:` closes the
goal. Goal status is never written — it is folded from the items:
`merged` (goal closed) · `blocked` (an item has `orch:blocked`) ·
`needs_attention` (label on the goal) · `review` · `running` ·
`ready`. Change it by changing items: `set-status <issue#>
<Todo|In progress|In review|Done>`, `set-blocker <issue#> "<why>"
--owner <who>`, `clear-blocker`, `attention G<n> [--clear] "<why>"`,
`done --goal G<n> --step S<j> <item#>`; reschedule with
`move <issue#> Now|Next|Later` (the Project's `Priority` field — the
board's columns). Every verb fails the step if GitHub is unreachable —
say so, never pretend.

Board-theater rule: a goal sitting blocked for more than a session with no
named unblock-owner is board theater — surface it, don't recite past it.

Detail lives in worklogs, never the board.

## The contract

Canonical statement of classification semantics — setup and README point
here; if wording ever differs, this section wins.

- Classify by `paths`; the `expertise` text breaks ties — semantics over
  globs ("web-ui path but a setpoint calculation → numerics"). This
  judgment is yours; the hook enforces only the path axis.
- `decide: human` → STOP and ask before acting. `decide: ai` → act, and
  EVERY consequential autonomous decision writes a `Ruling:` line.
- Domains may carry `tiers: { work, review }` floors (schema 2). `work`
  is the minimum tier a delegate may implement at in that domain —
  advisory until the v0.8.0 tier gate. `review` is INSTRUCTED: you apply
  it yourself when weighing verdicts; no hook can tell a work brief from
  a review brief. Strictest wins across multi-domain matches: the
  HIGHEST floor.
- Multi-match → strictest wins (human beats ai; lower ship rank beats
  higher). No match, a conflict, or a ship-gate BLOCK naming `unmatched` →
  park + write a proposed ADR with a ready-to-paste amendment, and append
  the parked action to the board's YOU lane
  (`add-item G<n> "<action>" --you`) so owner work is visible as a track, not
  scattered in prose. You NEVER edit the contract yourself.
- INCONCLUSIVE verdicts always go to the operator.
- The ship-gate hook enforces the ship side deny-by-default: git
  subcommands outside its read/local allowlist are refused entirely, and
  commit/push are judged on repo STATE (staged ∪ dirty ∪ unpushed), so a
  dirty human-domain file blocks any commit until dealt with — clean as
  you go. A block is the contract working; never route around it, never
  retry variants. The operator overrides by running the command
  themselves.

## Phase: route

1. Classify the goal's intended change per the contract rules above.
2. Knowledge-gap re-check: if routing surfaces facts you can neither
   derive from the repo nor verify from training (post-cutoff APIs, niche
   domain facts, vendor specifics), run the research route (see
   /orch:goal's shaping table) BEFORE writing the ROUTE line; cite its
   findings note in the worklog.
3. Execution shape follows the step's `recipe:` (written at creation by
   the goal skill or the Architect; one page each under `recipes/`):
   `iterate` → measurement-first · `fast` → cheapest tier ·
   `tdd`/`debug`/`cleanup` → mid tier (the review count comes from the contract's `review:` flag, never from here).
   Tier + delegation vehicle come from `delegate.md` (load it here).
4. `decide: human` → present plan ≤5 lines, STOP; write the ROUTE line
   only on approval, with `approved:operator`. `decide: ai` → write it
   with `approved:auto`.
5. Append to the worklog, exactly:
   `ROUTE: lane:G<n> · <domain> · decide:<ai|human> · ship:<none|commit|push> · tier:<model-tier> · base:<sha> · review:<single|dual> · approved:<operator|auto> · <date>`
   `base:` is `git rev-parse HEAD` at the moment this line is first written (the first review range starts here); `review:` is `dual` when any domain this goal touches carries `review: "dual"` in the contract, else `single`.
   Then enter phase work.

Complete when: the ROUTE line is in the worklog with its approval
recorded.

## Phase: ship

1. Merge gate — all three legs, or park for the operator:
   ① No regression — the full relevant suite, from the real runner's
   verdict line, never a filtered/wrapped view. ② Measured improvement on
   the goal's metric, exceeding its documented noise band — inside the
   band is INCONCLUSIVE → parks; "flat but correct" and hygiene-only park.
   ③ Root cause, no band-aid — symptom-masking stops for the operator
   regardless of green gates.
2. Contract ship check: the domain's `ship` grant decides who lands it.
   `none` → hand the operator the exact command + evidence summary.
   `commit`/`push` → run exactly the granted action; the ship-gate hook
   verifies independently — if it blocks, re-read the contract, never
   retry variants.
3. Board: evidence-before-done — `done --goal G<n> --step S<j> <item#>`
   for each step whose round manifest says `pass` (work.md "Gate
   rounds"; the ship-gate evidence lint verifies the manifest chain at
   HEAD); append the ledger line to the worklog and COMMIT it; then
   `close-goal G<n> --evidence "<that ledger line>"`. The script
   refuses while any item is open or without evidence; the ship-gate
   hook independently requires the ledger line in the worklog **at
   HEAD**. The gate item flipping `done` is what makes the goal
   closable. Work ended without evidence → `attention G<n> "no
   evidence: <why>"` (fold shows `needs_attention`); clear with
   `attention G<n> --clear "<what changed>"`.

Complete when: the goal is closed (or parked/blocked with a named reason)
and the worklog commit carries the evidence.

## Records & session end

Audit mirror: consequential Rulings also append
`{ts, decision, scope, domain, verdict, evidence, by:"ruling"}` to
`.claude/orch-audit.jsonl` — `evidence` is a pointer (SHA, `file:line`,
artifact path), never prose. ADRs (`docs/adr/NNNN-<slug>.md`,
`Status: proposed|accepted|rejected|superseded`): pair mode → accepted on
write; autopilot → ALWAYS proposed, surfaced in the report (step 3) until resolved via
`/orch:setup`. Before compaction/clock-out: refresh the handoff — ① done
② next action ③ entry phase for the next session ④ blockers + owners.
