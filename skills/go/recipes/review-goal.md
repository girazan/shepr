# review-goal — the base gate rubric (every step round, always hashed)

Read-only: inspect via `git show <sha>:<path>` and `git diff <base>..<head> -- <paths>`; never edit, stash or check out. Run the tests on the worktree the script hands you. Inputs: the BRIEF, the step's `accept:`, the diff range, the handoff, the test output. The recipe page named beside this one in the manifest's `rubric:` line adds its legs after these.

## Legs — every leg, in order; a miss is a `fail` reason

1. **Real.** The diff is non-empty and every claimed artifact passes EXISTS → SUBSTANTIVE → WIRED; "ran, produced nothing" fails here.
2. **Green.** The full relevant suite ran on the worktree; the verdict line is the real runner's, quoted.
3. **Accepted.** Each clause of the step's `accept:` (for the last step, the BRIEF's `done:`) is met by something you can point at — a test name, a file:line, a number.
4. **Scoped.** No file outside `paths:`; no edit to the BRIEF or the plan section; nothing the step did not ask for.
5. **Honest tests.** No circular oracle; consequential claims asserted at value-or-behavioural strength; no test disabled or skipped by the change.
6. **Recipe adds.** The named recipe page's "Gate rubric adds", each as its own reason.

## Verdict — tri-state, one word

    verdict: pass | fail | inconclusive
    reasons: <one per line; each cites an `accept:` clause or `done:`; a fail needs at least one>
    notes:   <non-blocking; never lowers a pass>

`inconclusive` when a leg cannot be run (tests unavailable, range unreadable) — say which leg; never guess a pass. You fix nothing you find.
