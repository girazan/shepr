# debug — execution recipe

Fits: something is broken.
Stages: reproduce → hypothesis → bisect → fix → regression test
Skills: stage `debug` for reproduce…fix (chosen `diagnosing-bugs`); stage `debug-echo` after the fix (chosen `bug-echo`: siblings of the same pattern). Native for both: ladder step 1.

## Stages

1. **reproduce.** A tight pass/fail signal that goes red on this bug and nothing else — a failing test at the nearest seam, else a script. No signal → no next stage; say so in the handoff.
2. **hypothesis.** One sentence in the worklog BEFORE any change: what is wrong and why.
3. **bisect.** Narrow with the signal — `git bisect` when the bug has a first-bad commit, else halve the code path.
4. **fix.** Root cause, not symptom: one guard at the shared point, never one per caller.
5. **regression test.** The stage-1 signal becomes a committed test. Then stage `debug-echo`: find the same pattern elsewhere, list the hits in the handoff; fix them only where the step's `accept:` covers them.

Ledger: `skill: debug=<name>` and `skill: debug-echo=<name>`.

## Gate rubric adds

- a test that was red before the fix; root cause named — the reviewer reverts the fix and runs the regression test: it must fail.
- The handoff names the root cause in one sentence and lists sibling hits, or `none`.
