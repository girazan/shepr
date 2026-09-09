---
name: milestone
description: >
  Define, split, prioritize, or close a milestone — the long-horizon
  statement that outcomes and goals hang under. Director-only: refuses inside any
  pane that carries ORCH_ROLE. Do NOT use to shape a goal (/shepr:goal),
  drive work (/shepr:go), or edit the contract (/shepr:setup).
---

# /shepr:milestone — scope lives here

Every board verb below runs as `node "<plugin>/scripts/board-gh.js" <verb> …`.
If `ORCH_ROLE` is set in this session's environment, stop: milestones
are the Director's and this pane is a role. Say which role and exit.
(The verbs refuse too; both are guardrails, not credentials.)

A milestone is exactly three fields on the GitHub Milestone — no brief,
metric, kill line or review; those belong to goals:

    title:        M<n> · <statement>
    description:  target: <YYYY-MM-DD> · done: <observable>
    due date:     the same target

Any number of milestones may be open at once; each goal attaches to one.

Under a milestone sit **outcomes** (v0.10): boss-visible, demonstrable
outcomes, 5–8 per milestone, each an `orch:outcome` issue whose body is
`done: <observable>`. Goals are an outcome's sub-issues. Progress that
anyone reports upward is **outcomes closed / outcomes total** — never
issue counts, never goal counts. An outcome closes when its `done:` is
demonstrated, which the Director does by hand; no script closes one.

## define

Three questions, one at a time (stage `define-milestone`: `node "<plugin>/scripts/tools.js" check` names the skill — `grilling` when pinned — else ask plainly):

1. The milestone statement in one line — what is true when this is done?
2. The target date.
3. The observable that proves it — a number, a demo, a shift run alone.

Then `add-milestone "<statement>" --target <YYYY-MM-DD> --done "<observable>"`.
It prints `M<n>` — `n` is the milestone's PROGRAM ORDINAL (one past the highest `M<n> ·` on the board, never the GitHub milestone number) and the title becomes `M<n> · <statement>`; idempotent on the statement.

## outcomes

Read the milestone's `done:`. Propose 5–8 outcomes that, together,
demonstrate it — one line each, with the observable that closes it.
Create NOTHING until the Director accepts; then, per accepted line,
`add-outcome <milestone#> "<title>" --done "<observable>"` prints
`O<n>`. Idempotent on (milestone, title). Existing open issues that
already are outcomes in spirit are attached, not duplicated: label them
`orch:outcome` by hand and say so.

## split

Read one outcome (or the milestone when it has none yet) and the
Project's Feature options (they are the contract's domain names). Propose
ordered candidate goals — one line each, a rough size (small / big), the
Feature each belongs to, the outcome each serves. Create NOTHING. For
each goal the Director accepts, hand to `/shepr:goal` with `--outcome O<n>`.

## prioritize

Show the milestone's goals in board order (`read`; goals sort Priority
first across milestones). For each change: `move G<n> <Priority option>`.
The Coordinator's goal-pick rule reads that order.

## close

When every goal under the milestone is merged, read the Coordinator's
summary line from `tmp/handoffs/M<n>-coordinator.md`, show it against
`done:`, and ask for acknowledgement. Then
`close-milestone <number|title> --summary "<that line>"`. It refuses
while a goal is not merged, when the milestone has no goals, or when the
board read window cannot prove completeness. Nothing else is written.
