# iterate — execution recipe

Fits: a number to move, cause unknown.
Stages: hypothesis first → change → measure → keep/revert
Skill: stage `iterate` — no chosen skill; native: hypothesis → change → measure.

## Stages

1. **hypothesis first.** Before touching code: the metric, its measurement protocol, its noise band (from the BRIEF's `metric:`, else measured now over ≥3 runs), the expected direction.
2. **change.** One change per cycle.
3. **measure.** Same protocol, same inputs; every number to the ledger.
4. **keep/revert.** Outside the band in the right direction → keep; else revert in the same cycle. `flat` with a smaller diff → keep (deleted code is a win).

Ledger: `skill: iterate=native`, then one `iter` line per cycle (`keep|revert|flat|refuted`).

## Gate rubric adds

- delta outside the noise band; `⚠complexity` weighed — the reviewer re-runs the measurement once on the worktree; inside the band → `inconclusive`.
- Every kept change has a ledger line with before → after numbers and its hypothesis written before the change.
