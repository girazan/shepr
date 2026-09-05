---
name: goal
description: >
  Create or edit a goal: shape the goal into a one-page BRIEF (goal,
  metric, done-condition, contract domains touched, kill criteria) using
  the routed shaping tool, and register the goal on the board.
  Do NOT use for running work on an existing goal (/orch:go), for
  contract or domain edits (/orch:setup), or for viewing progress
  (/orch:board).
---

# /orch:goal — define a goal

Every board verb below runs as `node "<plugin>/scripts/board-gh.js" <verb> …`.

The BRIEF is the interface: whatever tool shapes the idea, the output
lands in this exact format at the top of the goal's worklog
(`tmp/worklogs/G<n>-<name>.md` — see Register for the number):

    BRIEF
    goal:    <one sentence>
    metric:  <the number that moves + how it is measured>
    done:    <machine-checkable condition>
    domains: <contract domains this will touch>
    feature: <primary domain — the Project's Feature options are the contract domains; add-goal reads this line>
    kill:    <when to stop pouring effort in>

## Shaping route (operator's named tool always wins)

| Shape | Tool |
|---|---|
| fuzzy / new ground | superpowers:brainstorming if installed, else the 3 questions below |
| clear + big | superpowers:writing-plans if installed, else a plan section in the worklog |
| clear + small | no shaping — write the BRIEF directly |
| knowledge gap | `workflow.tools.research` if configured (deep-research tool); else native: web search → grade sources → findings note |

`workflow.tools` in `.claude/orch.json` overrides the defaults.

**Research route (optional):** before writing the BRIEF ask — does this
goal depend on facts the AI can neither derive from the repo nor verify
from training (post-cutoff APIs, niche domain facts, papers, vendor
specifics)? If yes, run the research pass first; its output lands as a
`research:` section in the worklog (sources cited, confidence graded) and
the BRIEF cites it. If no, skip — research is a route, never a mandatory
phase.

Native fallback — exactly three questions, one at a time:
1. What number (or observable) tells us this worked?
2. What must NOT change while we chase it?
3. When would you kill this goal rather than keep iterating?

## Register

1. Pick the milestone — exactly one question: run
   `node "<plugin>/scripts/board-gh.js" milestones` and offer the open
   ones (`M<n> …` first — legacy `C<n>` also sorts — then `backlog`). Milestones are the operator's;
   never create one. Write the BRIEF to `tmp/worklogs/_brief.md` first.
2. Register: `add-goal <milestone#|backlog|none> "<name>" --brief tmp/worklogs/_brief.md`
   prints the goal id `G<n>` (the goal issue's number — unique, never
   reused). The script reads `feature:` from the brief and sets the goal's Feature; a brief without it is refused when the Project has a Feature field.
   Rename the worklog to `tmp/worklogs/G<n>-<name>.md`; the
   goal is `G<n> · <name>` everywhere from here on. Prefer a short
   code-like name (2-6 chars). Create `tmp/worklogs/` and `docs/adr/`
   now if missing. No `.orch/board.json` → stop, point to `/orch:board init`.
3. Seed the route — one call per known BRIEF step:
   `add-item G<n> "<step>" [--bucket Now|Next|Later] [--pipeline <option>] [--feature <domain>] [--outcome "<next>"] [--gate "<LABEL>"] [--accept "<criterion>"] [--recipe <name>]`
   Always create at least one step — a small goal's single step is its `gate:` item, and its `--recipe` comes from the shaping table (`fast` for clear+small, `debug` for a bug).
   `--accept` is the step's acceptance criterion (the last step's is the BRIEF's `done:`); `--recipe` is one of `tdd | iterate | debug | cleanup | fast` (execution recipes only — `spec`/`research` belong to shaping, never to a step); `add-item` assigns `step: S<j>` itself.
   Items inherit the goal's Feature; pass `--feature <domain>` only when a step crosses into another domain.
   `--pipeline` = the Project's own options, omitted when unsure.
   — `--gate` on the done-condition item (its completion closes the
   goal); first steps `--bucket Now`, the rest `Next`. Owner actions (merge clicks, sign-offs):
   `add-item G<n> "<action>" --you`. Buckets are the Project's
   `Priority` options — never invent one.
4. Classify the `domains:` line against the contract now — if any part is
   `decide: human`, tell the operator where they will be needed. Then hand
   to `/orch:go` (phase: route).

Complete when: the BRIEF is the goal issue's body and sits at the top of
the worklog, and the goal's items are on the board.
