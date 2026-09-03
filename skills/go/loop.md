# Phase: loop (operator asked for an autonomous run)

Always a PROPOSAL — present the plan, get explicit approval, then launch.
Preflight is unskippable.

Preflight 0 — shape check (advisory): loop-shaped = multiple uncertain
iterations against a metric. Single-pass or 2-3 known steps → say so, do
it directly.

Refuse to launch until all five hold (any ✗ → fix the prompt file first):
1. Machine-decidable completion promise — probe/test/exit-code decides,
   never the loop's prose.
2. Boundaries stated — what the loop must NOT touch (protected dirs,
   authored values, the gates, the contract).
3. Iteration cap AND spend budget — the loop dies on whichever trips
   first, not only when context runs low.
4. Independent reviewer — external check output, never self-grading.
5. Numeric ambiguity checklist (binary): inputs + units · oracle ·
   tolerance vs noise band · measurement protocol · abort conditions.

In-loop: structure/contract-shaped calls → proposed ADR; if the work
depends on the answer, park the goal and continue elsewhere. The
ship-gate caps what the loop lands regardless of what it believes.

Launch journal, in the worklog:
`LAUNCH <date> · <prompt file> · max-iter <n> · budget <tokens> · promise <string>`

Complete when: the completion promise passes, or the cap/budget trips —
either way the outcome line lands in the worklog before anything else.
