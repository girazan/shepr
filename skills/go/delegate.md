# Delegation — who runs the work, and where

Loaded from route (tier pick) and work (dispatch). Roles, never model
names — pin roles to your runtime's actual models once, in
`.claude/orch.json`:

```json
"models": { "frontier": "opus", "high": "opus", "mid": "sonnet", "low": "haiku" }
```

Absent config, use the runtime's tiers by capability. The orchestrator
(you) always runs frontier-tier judgment; delegating YOUR verdicts is
never allowed.

## Tier table (task shape → tier, cheapest that fits)

| Task shape | Tier |
|---|---|
| transcription from a complete spec/plan (the code is written down; the work is typing + testing) · single-file mechanical fix · scan/grep/read recon | low |
| implementation from prose requirements · multi-file coordination · test authoring · fix rounds 1–3 | mid |
| review of a risky/subtle diff · adversarial verification · second-opinion verdicts | high |
| design, routing, final verdicts, anything that changes the plan | frontier (you) |

Turn count beats token price: a cheap model that takes 3× the turns on
multi-step work costs more — mid is the floor for prose-brief
implementers and reviewers.

Contract floors override this table downward-never: a domain's
`tiers.work` is the minimum for implementation dispatches there,
`tiers.review` the minimum for review verdicts. "Cheapest that fits"
operates within the allowed band.

## Delegation surface (context lifetime → vehicle)

| Work shape | Vehicle |
|---|---|
| one-shot: read, scan, verify, single task with a clean brief | throwaway subagent — spawns, reports, exits; brief carries EVERYTHING it needs (it inherits nothing) |
| a goal taking brief after brief — context worth keeping alive between briefs | resident pane (herdr-style) if your runtime has one: a ROLE with a name and a lifetime tied to the goal (`impl-G<n>`, `codex-G<n>`). No resident runtime → fresh subagents with the WORKLOG as the persistent memory |
| verdicts, gates, plan changes | never delegated below high; the orchestrator interprets every verdict itself |

Subagents never spawn their own reviewers — review comes from the
orchestrator after the hand-back, or it double-pays every seat.

Trust matches tier: a low-tier delegate is a transcriber or a grep, not
a consultant — take its output as material, never as a verdict.

## The brief (every dispatch, eight sections)

    TASK:      <the one thing, concrete>
    ASK:       <the operator's words, verbatim — paraphrase inherits your misreadings>
    OUTCOME:   <what done looks like — artifact, diff shape, or number>
    TOOLS:     <what it may use; what it may NOT touch>
    MUST DO:   <the step's recipe stages first, in order (recipes/<recipe>.md), then the constraints that are non-negotiable>
    MUST NOT:  <the boundaries — protected dirs, contract reserves, scope>
    VETOES:    <every operator correction this session, quoted — context decays; vetoes must not>
    CONTEXT:   <worklog path + everything it needs; it inherits nothing>

An implementation brief thinner than ~15 lines is under-specified —
fill it out before dispatch; vague briefs buy fix rounds. Recon/scan
briefs may be shorter, but keep all eight headings.

On a step dispatch, MUST DO opens with the recipe's stages (copied from `skills/go/recipes/<recipe>.md`, in order) before any other constraint.
CONTEXT names only this goal's worklog and the ADRs the step lists — never another goal's handoff, never the full plan.

## Killing and restarting a delegate

1. **Bank before kill — hard rule.** An agent's context dies with it and
   is unrecoverable. Before ANY termination its state is in the worklog:
   what's done, what's next, what it learned that the diff doesn't show.
   No bank, no kill. If it is too far gone to write one, YOU write it from
   its last report.
2. **Restart triggers — exactly three.** Fuel: a fleet-context band
   crossing with work remaining. Stall: a previous-round finding survived
   (the review ladder's identity rule — it now also means "restart"). Role
   change: the brief's shape changed; a new job gets a new agent, not a
   re-brief of one shaped for the old job.
3. **Resume vs fresh — is its context an ASSET or a LIABILITY?** It wrote
   the code and knows its own choices → resume. It cannot see its own
   error, or the thread is long and full of dead ends → fresh, one tier up.
4. **Lifetime = the goal.** A resident worker exists for one goal
   (`G<n>`). Goal hits `merged` or killed → tear the worker down that same turn.
   An idle resident is cost without benefit; a stale one is worse — it
   answers from a world that moved.
5. **The replacement's brief** carries the brief, the worklog path, and
   WHY its predecessor ended. Never "continue what they were doing": that
   inherits the confusion without the context that explained it.

## Fix-loop escalation (matches the review ladder's cap 3)

Rounds 1–2: RESUME the same implementer — its context holds the task and
its own choices. Round 3 (last before the stall rule escalates): fresh
implementer one tier UP, handed the brief + the findings + "a prior
implementer attempted this; you own it now." A loop that survives two
resumes usually means the implementer cannot see its own problem — fresh
eyes and a capability bump in one move, before the operator has to hear
about it.

## Roled panes — env, marker, roster, handoff

Every pane the Coordinator starts carries two env vars, set by the
launcher (`herdr agent start <name> --env ORCH_ROLE=<role> --env
ORCH_IDS=<ids>`; a native background agent gets them in its spawn env).
`ORCH_ROLE` is a guardrail, not a credential (spec §6): the hooks keyed on
it are ADVISORY and see direct tool calls only.

    ORCH_ROLE=dev|architect|coordinator|reviewer
    ORCH_IDS=M<n>.G<k>.S<j>        dev · `M<n>.G<k>` architect · `M<n>` coordinator

The `session-start` hook turns them into the session marker
`<git-common-dir>/orch/session-<sessionId>.json` (`{role, milestone, goal, step, startedAt}`)
and exports `ORCH_SESSION_ID`. When focus moves, record it (the go skill
does this on every pick): `node "<plugin>/scripts/session-marker.js" set --goal G<k> [--step S<j>]`.

Pane names: `impl-G<k>-S<j>` (Dev, fresh per step), `arch-G<k>`
(Architect), `coord` (Coordinator). Roster entry in
`<git-common-dir>/orch/fleet.json` (v2 §3.1 shape plus the two role
fields), written by the launcher at start and removed at teardown —
INSTRUCTED until the v0.9 roster hooks ship; `orch review` writes and
removes its own reviewer entry:

    { "name": "impl-G142-S2", "lane": "G142", "role": "mid", "orchRole": "dev", "ids": "M53.G142.S2", "vehicle": "herdr", "status": "running", "ownerSessionId": "<id>", "agentId": "<pane id>", "brief": "tmp/worklogs/G142-HDS.md#brief-1", "createdAt": "<iso>", "lastSeen": "<iso>" }

Handoff — every role writes one at exit, ≤40 lines: what changed · what
is blocked · what was decided · the next role's first action. Under
`ship: none` a Dev handoff ends with the exact commit command for the
Director. Paths, by role:

    tmp/handoffs/M<n>.G<k>.S<j>-dev.md
    tmp/handoffs/M<n>.G<k>-architect.md
    tmp/handoffs/M<n>-coordinator.md

The `stop-handoff` hook refuses one Stop while a roled pane has edited
since `startedAt` and no handoff is newer (ADVISORY; a reviewer's output
is its slot file, it has no handoff). Handoffs are scratch —
`tmp/handoffs/` is gitignored; the worklog is the record. Size budgets,
also advisory at Stop: handoff ≤40 lines, plan section ≤300 lines and ≤7
steps.
