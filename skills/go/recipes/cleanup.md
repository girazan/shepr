# cleanup — execution recipe

Fits: slop after a feature landed.
Stages: separate pass, separate agent
Skill: stage `cleanup` (chosen `safe-refactor`: verification brackets each edit; native: the de-sloppify prompt below).

## Stages

1. **separate pass.** Never inside the feature's step: cleanup is its own step with its own gate round, dispatched after the feature step passed.
2. **separate agent.** A fresh Dev pane that reads the feature step's diff, not its reasoning.
3. Full suite before the first edit and after every edit; the verdict line must not change.
4. Delete: dead branches, duplicated shapes, speculative parameters, comments that restate code. No behaviour change, no new dependency, no test edits.

Native de-sloppify prompt: "Read `git diff <base>..<head>`. Remove what a reviewer would delete — duplication, dead code, needless abstraction, noise comments. Behaviour identical; tests untouched; suite green after every edit."

Ledger: `skill: cleanup=<name>`.

## Gate rubric adds

- tests unchanged and green; the diff deletes — `git diff --stat` shows more deletions than insertions and no test file changed.
