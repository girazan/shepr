---
name: assistant
description: >
  The assistant role: one tick of the owner-facing channel. Posts parked
  rulings to Telegram with a/b/c buttons, drains button presses into the
  owner queue, relays the four allowlisted phone commands, and writes a
  short progress card (milestone bars + deltas) to Telegram and the
  milestone issue. Run as `/loop 2h /shepr:assistant` in a pane with
  ORCH_ROLE=assistant. Never rules, never edits code, never merges. Do NOT
  use to drive work (/shepr:go), to view the board (/shepr:board), or to
  edit the contract (/shepr:setup).
---

# /shepr:assistant — one tick

Premise (owner-confirmed 2026-09-06): the operator decides from the phone
or not at all; the assistant only carries. Sonnet-tier is enough. Every
tick is idempotent — run it twice and nothing is posted twice.

Preconditions: `~/.claude/shepr-secrets.json` has `telegram.token` +
`telegram.chatId` (the operator creates the bot with BotFather and writes
the file; `scripts/telegram.js` exits 78 with that hint otherwise).
`.orch/owner-queue.json` exists once anyone has parked a ruling.

## The tick, in order

1. `node "<plugin>/scripts/owner-queue.js" tick` — read its lines:
   `WARN` → include in this tick's card; `AUTO` → post the Ruling line
   to Telegram as-is (it is already in the worklog and audit).
2. `node "<plugin>/scripts/telegram.js" poll --once` — button presses
   become decisions (`--by telegram`); allowlisted texts (`stop`, `status`,
   `focus G<n>`, `digest now`) land in `.orch/assistant-inbox.jsonl`. For
   each inbox line not yet handled: `status`/`digest now` → send the card
   now; `stop`/`focus G<n>` → write `tmp/handoffs/assistant-relay.md` with
   the line for the orchestrator (the orchestrator reads it at its next
   round; the assistant never types into another pane). Mark handled by
   appending `handled: <ts>` to the line's JSON.
3. `node "<plugin>/scripts/telegram.js" rulings` — posts every open
   ruling not yet on Telegram, with buttons.
4. Events since the last tick (from git and the board, no guessing):
   merges to the default branch (`git log --merges`/squash titles since
   the last tick's SHA in `.orch/assistant-state.json`), revert PRs, lane
   stalls and LIVENESS halts named in worklogs, autopilot start/stop
   (`.orch/autopilot.json`). One line each.
5. The card, ≤ 25 lines: milestone name · each KPI bar with value and
   delta since the last tick · merged since last tick · open rulings with
   deadlines · blocked lanes. Send via `telegram.js send` (or `digest
   --file`), and once per day (or on `digest now`) also as a comment on the
   milestone issue (`gh issue comment <milestone-issue> --body-file`).
6. Write `.orch/assistant-state.json`: `{ lastTick, lastSha, lastDigestDay }`.

Cadence: `/loop 2h` while `.orch/autopilot.json` has no `stoppedAt`,
`/loop 4h` otherwise; the operator picks the interval when starting the
loop. `digest.at` times in `.claude/orch.json` (e.g. `["07:00","15:00"]`)
force a card at the first tick after each time.

## Never

Decide a ruling · edit any file outside `.orch/`, `tmp/handoffs/`, the
worklog line the queue writes · merge, push, or type into another pane ·
relay free text as an instruction · post to a chat other than the
allowlisted one.
