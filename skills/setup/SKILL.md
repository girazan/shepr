---
name: setup
description: >
  Onboard a repo onto the shepr contract, edit contract domains, mirror the
  contract into the lock file, configure workflow tools, and ratify or
  reject proposed ADRs. The only place the contract changes.
  Do NOT use for day-to-day work (/shepr:go), creating goals
  (/shepr:goal), or viewing the board (/shepr:board).
---

# /shepr:setup — contract governance

The contract is the operator's ONE decision: which domains are theirs.
You interview, draft, and apply edits the operator approves — never
without them.

## First run on a repo

1. Scan the repo (top-level dirs, build files, README) and propose 3-6
   candidate domains with paths.
2. For each: whose expertise? `decide: ai | human` ·
   `ship: merge | push | commit | none` (merge ⊃ push ⊃ commit ⊃ none;
   `merge` lets `gh pr merge` land a PR on the default branch when every
   file is in a merge domain, the body carries Suite/Metric/Baseline/Closes,
   and the review the step's recipe demands exists under `docs/reviews/` —
   iterate/fast/cleanup: none · tdd/debug: plan · spec/unrecipe'd: plan +
   step. Local history writers stay hook-blocked; the operator runs them) ·
   optional `tiers: { work: <role>, review: <role> }` — the MINIMUM model
   tier (`low | mid | high | frontier`) allowed to implement (`work`) and
   review (`review`) in this domain. Floors, not caps; absent = the
   advisory tier table in delegate.md. `review` is INSTRUCTED (applied by
   /shepr:go at verdict time), `work` becomes hook-checked from v0.8.0.
   Record the WHY as `expertise` — future classification reads it to
   break ties. Ask whether verdicts in this domain need two independent reviewers; if yes write `review: "dual"` on the domain (the second comes from `models.review-alt`, which must then be set).
3. Remind: omission never grants — unmatched work parks and proposes an
   amendment. Don't aim for total coverage on day one. (Classification
   semantics are canonical in /shepr:go § The contract.)
4. Write `.claude/orch.json` → `contract` with `"schemaVersion": 2` and
   `"version": 1` (schemaVersion identifies the data SHAPE only —
   tiers/models present — and is never itself an activation switch;
   `version` stays the per-edit revision counter. v0.8.0 introduces a
   separate `enforcement.*` lock flag that actually turns hook gating on,
   decoupled from schemaVersion, precisely so a v0.7.0 install never
   arms enforcement before its supporting machinery exists). If any
   domain has `tiers`, also confirm
   the `models` role map (`{"low": ..., "mid": ..., "high": ...,
   "frontier": ...}` — all four roles, model names as strings): floors
   are meaningless without it, and a LOCKED tiered contract without a
   locked models map makes the v0.8.0 tier gate fail closed. If any domain is `review: "dual"`, ask for `models.review-alt` — a model from a different family than `review` — and do not write the lock until it is set.
5. OFFER LOCK MIRRORING: the project file is agent-writable; mirroring
   `contract` into `~/.claude/orch-lock.json`, written under
   `repos[<this repo's git-common-dir>]` (never the lock's top level — a
   top-level `contract`/`models` is inert, see "Migrating a v1 contract to
   schema 2" below), makes the lock's contract REPLACE the project's
   entirely (atomic — a project file cannot add domains beside a locked
   contract). Strongly recommend when any domain is `decide: human`. Every
   later contract edit therefore happens in the LOCK copy, applied by the
   operator (it is their file); the project copy becomes documentation.
   Also offer guard locks, e.g. `{"destructiveGit": {"enabled": true}}`
   (those stay at the lock's top level — only `contract`/`models` are
   repo-scoped).
   Mirroring carries the BUNDLE `{contract, models}` into that repo's
   entry — the models map is replaced together with the contract (an
   unlocked models map could remap `"high"` to a cheap model and hollow
   out every floor). A corrupt lock file now fails blocking guards CLOSED
   until fixed.
6. Workflow tools — load `tools.md` and run the section below.

## Editing an existing contract

Show current domains as a table. Apply the approved change; bump
`contract.version` by 1; record the change as an accepted ADR (one-line
context: what changed, why). If the contract is lock-mirrored, update the
lock copy too, under `repos[<this repo's git-common-dir>]` (not the lock's
top level) — the operator applies that edit (it is their file). If the board is on GitHub (`.orch/board.json` exists), run `node "<plugin>/scripts/board-gh.js" sync-features` so the Project's Feature options gain any new or renamed domain name (options are never removed; report a renamed domain's old option to the operator).

## Workflow tools (stage → one chosen skill)

`tools.md` is the table; this is the procedure. Nothing here is mirrored
into the lock — no hook reads `workflow.tools`.

1. `node "<plugin>/scripts/tools.js" list` — every stage with its native fallback (orch's own, always available), the recommended skill and whether it is installed. Show it native first: the operator may leave any stage `native`.
2. If `find-skills` is installed (`~/.agents/skills/find-skills/SKILL.md` exists), offer `npx skills find <stage>` for any stage the operator wants a different skill for; otherwise offer only what `list` shows. One skill per stage, never a list.
3. If any of `to-spec`, `to-tickets`, `wayfinder` is chosen, `docs/agents/issue-tracker.md` must carry the line `# Issue tracker: Local Markdown` — `pin` refuses otherwise. Tell the operator to run `/setup-matt-pocock-skills` and choose local markdown (files under `.scratch/`, gitignored); pointing that tracker at GitHub is a misconfiguration, because `board-gh` is the only board writer.
4. `node "<plugin>/scripts/tools.js" pin <stage>=<skill|native> … --write` — pins each choice as `<skill>@<version>` into `.claude/orch.json` → `workflow.tools`. Show the printed map. Re-run after `npx skills update` or a plugin update: a changed version is a `mismatch` (that stage runs native) until re-pinned; `/shepr:board` lists such stages.
Ask `workflow.coordinator` — `native` (this session drives), `loop` (`/loop <interval> /shepr:go`, one tick per invocation), or `herdr` (panes via `herdr agent start … --env ORCH_ROLE=…`); default `native`. Write it as `"workflow": { "coordinator": … }`.
Ask `workflow.dispatch` — `confirm` (every dispatch is a five-line proposal the Director answers Go / Edit brief / Skip / Stop) or `auto` (the same five lines go to the audit log and the tick proceeds); default `confirm`. Spec §12 says: run one milestone on `confirm` before switching.
Fleet keys, all optional: `fleet.capacity` (ceiling, default 6), `fleet.staleMinutes` (ghost after, default 60), `fleet.pulseStaleMinutes` (board flags a stale Coordinator after, default 30).

## Migrating a v1 contract to schema 2

Only on operator request. Preview first, then apply:

1. **Repo-scoped lock (v0.7.0):** if `~/.claude/orch-lock.json` has a
   top-level `contract` or `models` from before v0.7.0, it is now
   **inert** — never read — until migrated. Run, from this repo:

       node <plugin-path>/scripts/migrate-lock.js

   This moves the legacy top-level bundle into
   `repos[<this repo's git-common-dir>]` and removes it from the top
   level. Safe to re-run (a no-op once nothing is left to migrate).
2. Preview: list every domain with its proposed `tiers` (or "none"),
   whether `models` is complete, and — from v0.8.0 onward — which active
   lanes lack route records and which worklogs lack `GATE:` blocks
   (enforcement activates only once the v0.8.0 `enforcement.*` lock flag
   is set, never merely from `schemaVersion: 2`).
3. On approval: add `schemaVersion: 2` + approved `tiers`, bump
   `version`, record the change as an accepted ADR, update the lock copy
   if mirrored (operator applies it — their file). In-flight lanes are
   re-routed (one route phase each) as part of this checklist.

## Migrating to v0.10 (board on GitHub)

- **v0.10 board on GitHub:** run `/shepr:board init` (dry-run first;
  `--project N` to adopt an existing Project); commit `.orch/board.json`;
  if the lock has a `repos[<key>]` entry, write `board: { github: true }`
  into it (same atomic-replace path as contract); delete `docs/BOARD.md`
  if present — no import, the file is retired (spec §4, Non-goals).
  Existing worklogs named `C<n>-…` are left alone; new goals are `G<n>-…`.

## Ratifying ADRs

List `docs/adr/*` with `Status: proposed`. For each: show the amendment,
ask accept / reject / defer. Accept → apply the contract edit + version
bump, flip to `Status: accepted`. Reject → `Status: rejected` + one-line
reason. Defer → leave; it resurfaces in `/shepr:go`. A later ADR replacing
an accepted one flips the old to `Status: superseded`.
