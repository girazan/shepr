---
name: go
description: >
  The shepr session driver. Use for any work session after a goal exists:
  reads the board, worklogs, contract, and unratified ADRs, decides the
  current phase (route/work/ship/loop) by ordered precedence, acts, and
  reports. The human decides only what the contract reserves for them.
  Do NOT use to shape a new goal (/shepr:goal), edit the contract or
  ratify ADRs (/shepr:setup), or just view progress (/shepr:board).
---

# /shepr:go — the session driver

A router. Read `.claude/orch.json` and this pane's env, then load exactly
ONE of the two bodies below — the other never enters context:

- `ORCH_ROLE=coordinator` in the env, or `workflow.coordinator` is `loop`
  or `herdr` (the vehicles are `native | loop | herdr`) → this invocation
  is one Coordinator tick: load `coordinator.md`, do its one action, stop.
- otherwise → the interactive session (route → work → ship, or an
  unattended loop): load `native.md`.

Premise either way: the operator decided ONCE (`.claude/orch.json` →
`contract`) which domains are theirs. Everything else you decide, review,
and ship — every decision leaves a record. You are the orchestrator:
frontier-tier judgment, verdict-only; suited cheap models execute.
