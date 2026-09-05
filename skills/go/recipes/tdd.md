# tdd — execution recipe

Fits: clear behaviour, testable seams.
Stages: red at the seam → green → refactor
Skill: stage `tdd` — `tools.js check` names the chosen skill (`tdd`) or the native fallback (ladder step 1). The chosen skill asks for agreed seams: in a Dev pane the step's `accept:` line IS the agreement.

## Stages

1. **red at the seam.** The seam is the public boundary the `accept:` criterion is observed at; no test anywhere else. Write one failing test there, run it, paste the red line into the worklog.
2. **green.** The least code that turns it green. Run that test, then the scoped suite.
3. **refactor.** Only with the suite green before and after; a refactor that needs a new test is the next slice, not this one.

One slice per cycle, until every `accept:` clause has its test. Commit tests and code together where the contract grants `ship: commit`.

Ledger: `skill: tdd=<name>` once per dispatch, then one `iter` line per slice.

## Gate rubric adds

- green-can-go-red — revert the implementation, keep the tests: the new test must FAIL; a test that stays green proves nothing.
- Every `accept:` clause maps to a named test; the reviewer lists them.
- No test asserts through internals or a side channel (a tautological or implementation-coupled test is a finding).
