# spec — shaping recipe

Fits: fuzzy or big. The Architect's pass (or `/orch:goal` in a single session); never on a step.
Stages: brainstorm/grill → spec → `P.R1` → steps
Skills, one per stage: `grill` (`grill-with-docs`), `spec` (`to-spec`), `split` (`to-tickets`), `fog` (`wayfinder`), `domain-model` (`domain-modeling`). The tracker-publishing three write under `.scratch/<feature>/` (local-markdown tracker, gitignored); the Architect turns those files into `add-item` calls — the skill never writes the board.

## Stages

1. **brainstorm/grill.** Questions in rounds until the frontier is empty; ≤5 questions to the Director, after that decide and record each assumption as an ADR.
2. **spec.** The six-line BRIEF plus the plan section: steps, each with an `accept:` and an execution `recipe:`; fog = what is sharp enough to name, not yet ticketed.
3. **`P.R1`.** The plan review (plan 4's `orch review G<k> --plan`); until it ships, a checker reads the plan section against the rubric adds below.
4. **steps.** `add-item G<n> "<step>" --accept "<criterion>" --recipe <tdd|iterate|debug|cleanup|fast>` per step, in order. A ticket file is input, never the record.

Ledger: `skill: grill=<name>`, `skill: spec=<name>`, `skill: split=<name>`, `skill: fog=<name>` as used.

## Gate rubric adds

- plan covers `done:`; each `accept:` checkable — every clause of the BRIEF's `done:` is owned by a step, and every `accept:` names an observable a reviewer can run.
- ≤7 steps, plan section ≤300 lines, every step carries an execution recipe.
