---
name: board
description: >
  Render the orch route board: a read-only, forward-looking map of every
  goal lane (buckets × tracks, the YOU owner lane, gates, today's
  queue). Use when the operator wants to see progress, the path to done,
  stale lanes, or pending ADRs — without starting any work. Do NOT use
  to start, route, or ship anything — /orch:go acts; this only looks.
---

# /orch:board — three commands act, this one looks

READ-ONLY. Never route, never delegate, never edit a file.

## Gather (all best-effort — render what exists, label what doesn't)

1. Board: `node "<plugin>/scripts/board-gh.js" read --json` — GitHub Issues
   + the repo's Project ARE the board (spec §4): `goals[]` (lane `G<n>`,
   `name`, `milestone`, folded `status`, `blocker`, `items[]` incl. YOU
   items flagged `you`, the gate item carrying `gate`). No
   `.orch/board.json` → say "board not initialised — run
   `/orch:board init`" and stop. GitHub unreachable → say so and stop;
   never render from memory.
2. Stale: an item's `updated` older than `board.staleDays`
   (`.claude/orch.json`, default 3) while its goal's status is unchanged
   → ⚠ with age.
3. Metric per lane: last ledger line of `tmp/worklogs/G<n>-*.md`
   (`before → after`) plus the BRIEF `metric:` target.
4. Gate digest per lane: `.claude/orch-audit.jsonl` entries whose files
   match the lane's contract domains, since the operator's last board
   commit — count ALLOWs, BLOCKs, Rulings.
5. Proposed ADRs in `docs/adr/` with ages.
6. Missing sources render as `—` with a one-word reason (`pre-install`,
   `no worklog`) — never fabricate, never omit the row.

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
     ADRs: <NNNN proposed Nd ⚠ …> | GATE DIGEST where lane-level
     TODAY'S QUEUE: <current session order, from NOW items + parks>

Done items keep their place with ✓ — the map read left-to-right IS the
history. Buckets are the Project's `Priority` options — never invent one.

## `/orch:board html`

Run `read --json > tmp/board.json`, compute stale + digest as above, then:

    node "<plugin>/scripts/board-html.js" --json tmp/board.json tmp/board.html \
      --worklogs tmp/worklogs --adr docs/adr \
      --stale "G142:5d" --digest "G142:4 ships · 1 block" \
      --queue "<queue>" --title "orch board · <repo>"

Report the output path; do not open it unasked.

## `/orch:board init` — the one write this command owns

Announce it, run `node "<plugin>/scripts/board-gh.js" init [--project N] --dry-run`,
show the DRY lines, and on the operator's go run it without `--dry-run`.
`--project N` adopts an existing Project (i-Start: `--project 1`,
Pertasim); otherwise a `<repo> · orch board` Project is created.
Idempotent; never creates milestones; never renames `Priority` options
— tell the operator to rename `P0/P1/P2 → Now/Next/Later` in the
Project settings first if they want those names. Commit
`.orch/board.json`. Option: `--owner <login>` (Project owner if not the
repo owner).
