# fast — execution recipe

Fits: trivial, spec-complete — the code is written down; the work is typing and testing.
Stages: implement → test
Skill: stage `fast` (chosen `implement`, from the step text and its `accept:`; native: implement → test).

## Stages

1. **implement.** Exactly what the step text and `accept:` say. A question means the step is not fast — stop, propose `tdd` in the handoff.
2. **test.** The scoped tests, then the full-suite verdict line into the ledger.

Ledger: `skill: fast=<name>`.

## Gate rubric adds

- mechanical step only — a diff that adds a decision (a new branch of behaviour, a new interface, a changed contract) fails as mis-recipe'd; the reviewer names the recipe it wanted.
