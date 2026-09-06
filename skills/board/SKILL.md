---
name: board
description: >
  Render the shepr route board: a read-only, forward-looking map of every
  goal (buckets × tracks, the YOU owner row, gates, today's
  queue). Use when the operator wants to see progress, the path to done,
  stale goals, or pending ADRs — without starting any work. Do NOT use
  to start, route, or ship anything — /shepr:go acts; this only looks.
---

# /shepr:board — three commands act, this one looks

READ-ONLY. Never route, never delegate, never edit a file. Two announced exceptions: `/shepr:board init` (below) and `/shepr:board sync`, which runs `node "<plugin>/scripts/board-gh.js" sync-features` — the Feature options mirror the contract's domain names; announce what it added.

## Gather (all best-effort — render what exists, label what doesn't)

1. Board: `node "<plugin>/scripts/board-gh.js" read --json` — GitHub Issues
   + the repo's Project ARE the board (spec §4): `goals[]` (`lane` = `G<n>`,
   `name`, `milestone`, folded `status`, `blocker`, `items[]` incl. YOU
   items flagged `you`, the gate item carrying `gate`). A `merged` goal with `unverified: true` renders `merged ⚠ unverified: <unverifiedReason>` — it was closed outside `board-gh`, or no passing round manifest covers its final range (spec §4). No
   `.orch/board.json` → say "board not initialised — run
   `/shepr:board init`" and stop. GitHub unreachable → say so and stop;
   never render from memory.
2. Stale: an item's `updated` older than `board.staleDays`
   (`.claude/orch.json`, default 3) while its goal's status is unchanged
   → ⚠ with age.
3. Metric per goal: last ledger line of `tmp/worklogs/G<n>-*.md`
   (`before → after`) plus the BRIEF `metric:` target.
4. Gate digest per goal: `.claude/orch-audit.jsonl` entries whose files
   match the goal's contract domains, since the operator's last board
   commit — count ALLOWs, BLOCKs, Rulings.
5. Proposed ADRs in `docs/adr/` with ages.
6. Missing sources render as `—` with a one-word reason (`pre-install`,
   `no worklog`) — never fabricate, never omit the row.
7. Tools: `node "<plugin>/scripts/tools.js" check` — every line that says
   `missing` or `mismatch` is a stage running on its native fallback;
   collect them for the footer.
8. Fleet and pulse: `node "<plugin>/scripts/coordinator.js" fleet` → `fleet[]` (one line per running/reserved delegate, ghosts flagged), `pulse.age` in minutes with `pulse.stale`, and `outOfScope` — commits on a running goal's branch since its ROUTE `base:` that touch another domain's paths (spec §5 residual: not reviewed under this goal; the Director's).

## Render (ASCII, in chat)

Layout, exactly this shape — buckets as columns, goal tracks grouped
under a one-line milestone header, YOU last and visually distinct, gates
+ ADRs + queue as the footer:

    ORCH BOARD · <repo> · project #<n>
    ═══════════════════════════════════════════════════════
     NOW →            <bucket 2>         <bucket 3>
    ───────────────────────────────────────────────────────
    ── C1 SHU-HDS operable ──
    G142 · <name>   <status> <⚠ stale Nd>   <metric> · <digest>
     ├─▶ <item>       ├─▶ <item> ──▶ <outcome>
     │                │   = <LABEL> ✅
    YOU · owner lane — nothing here is delegable
     ├─▶ <item>       ├─▶ <item>
    ───────────────────────────────────────────────────────
     GATES: <from ## GATES or the board's rules line>
     ADRs: <NNNN proposed Nd ⚠ …> | GATE DIGEST where goal-level
     TODAY'S QUEUE: <current session order, from NOW items + parks>
     FLEET: <fleet lines> · pulse <age>m <⚠ stale when pulse.stale> · out-of-scope: G<k> <sha> <files> | none
     TOOLS: <stage> <name>@<pin> missing|mismatch → native

Done items keep their place with ✓ — the map read left-to-right IS the
history. Buckets are the Project's `Priority` options — never invent one.
The FLEET footer reads the roster and the audit log through the `fleet` verb; a `👻 ghost` is a delegate whose `lastSeen` is older than `fleet.staleMinutes`; a stale pulse means no Coordinator tick ran within `fleet.pulseStaleMinutes` (default 30).
The `TOOLS:` line appears only when a pin is missing or mismatched; every pin holding → no line.

## `/shepr:board html`

Run `read --json > tmp/board.json`, compute stale + digest as above, then:

    node "<plugin>/scripts/board-html.js" --json tmp/board.json tmp/board.html \
      --worklogs tmp/worklogs --adr docs/adr \
      --stale "G142:5d" --digest "G142:4 ships · 1 block" \
      --queue "<queue>" --title "orch board · <repo>"

Report the output path; do not open it unasked.

## `/shepr:board init` — the one write this command owns

Announce it, run `node "<plugin>/scripts/board-gh.js" init [--project N] --dry-run`,
show the DRY lines, and on the operator's go run it without `--dry-run`.
`--project N` adopts an existing Project (i-Start: `--project 1`,
Pertasim); otherwise a `<repo> · shepr board` Project is created.
Idempotent; never creates milestones; never renames `Priority` options
— tell the operator to rename `P0/P1/P2 → Now/Next/Later` in the
Project settings first if they want those names. Commit
`.orch/board.json`. Option: `--owner <login>` (Project owner if not the
repo owner).
