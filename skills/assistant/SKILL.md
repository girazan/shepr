---
name: assistant
description: >
  The assistant role: one tick of the owner-facing channel. Posts parked
  rulings to Telegram with a/b/c buttons, drains button presses into the
  owner queue, relays the four allowlisted phone commands, and writes a
  short progress card (a bar per open milestone + deltas) to Telegram and
  each milestone issue. Run as `/loop 2h /shepr:assistant` in a pane with
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
2. Make sure the PERSISTENT poller is alive — `node "<plugin>/scripts/telegram.js" poll`
   (no `--once`) as a detached background process logging to
   `tmp/telegram-poll.log`; start it if `.orch/telegram-poll.pid` names a
   dead process. It long-polls Telegram, so a button press is acknowledged
   within seconds, not at the next tick: presses become decisions
   (`--by telegram`), buttons are removed, and allowlisted texts (`stop`,
   `status`, `focus G<n>`, `digest now`) land in `.orch/assistant-inbox.jsonl`.
   A tick-only `poll --once` is the fallback when a background process is
   not possible — then the phone waits for the tick. For
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
5. The card, ≤ 25 lines, shaped for a phone: one bold headline
   (`📊 <b>Pertasim</b> · Sat 18:50`), then sections with one emoji each
   and one line per item — `🎯 bars` **one line per open milestone**
   (`C1 · 5/8 ▲1`, `C2 · 0/2`; value → value, ▲▼ delta), `✅ merged`,
   `🧭 rulings open` (id, deadline), `⛔ blocked`, `🔥 needs you`. Prefix
   every goal line with its milestone (`C2 G2245 …`) — with two campaigns
   live an unlabelled lane is unreadable, and the operator's first question
   is always "which one". A single open milestone: name it in the headline
   instead and drop the prefixes. Numbers only where they change what the
   operator does; no prose paragraphs; HTML parse mode (`<b>`, `<code>`),
   never Markdown tables. Send via `telegram.js send` (or `digest --file`),
   and once per day (or on `digest now`) also as a comment on EACH open
   milestone's issue (`gh issue comment <milestone-issue> --body-file`),
   filtered to that milestone's lines.
6. Write `.orch/assistant-state.json`: `{ lastTick, lastSha, lastDigestDay }`.

Cadence: `/loop 2h` while `.orch/autopilot.json` has no `stoppedAt`,
`/loop 4h` otherwise; the operator picks the interval when starting the
loop. `digest.at` times in `.claude/orch.json` (e.g. `["07:00","15:00"]`)
force a card at the first tick after each time.

## Message templates (HTML parse mode; `telegram.js send --html`)

Structure markers — option letters, separators, labels — are bold; emoji
only where they carry meaning; no letter emoji (they render unevenly).

```
⏰ <b>R7 auto-resolves in 1 h · #2157 · Steady-state solver</b>
Merge order: #2155 before #2148?
→ will take <b>(a)</b> #2155 first at <b>17:00 UTC</b> unless you press a button

🤖 <b>R7 auto-resolved → (a)</b> #2155 first
No answer by 17:00 UTC · logged in <code>tmp/worklogs/G2100-…md</code> · reversible: say "reverse R7"

✅ <b>Merged #2171 · WaterBoot reads the solver's key</b> (Closes #1966)
recipe <b>fast</b> · suite Passed! 412 · certify HDS unchanged 0.3389 kg
review <b>·</b> none required (fast)
↩️ revert <b>·</b> <code>git revert 3fa9c1e</code>

✅ <b>Merged #2172 · Column BP round 5</b> (Closes #2144)
recipe <b>spec</b> · plan P.R1 ✅ · step S3.R2 ✅ (fable + opus ⚠️ Codex quota, single-family review)
metric <b>·</b> armed settle 37.9 s → 41.2 s ▲
↩️ revert <b>·</b> <code>git revert 9c2d1aa</code>

↩️ <b>Reverted #2172 via PR #2175</b> · reason: certify HDS regressed to exit 70
main back at <code>58ec9cc</code> · lane re-cut from the revert

⛔ <b>LIVENESS halt · impl-integ4</b> · certify ×2 not byte-identical (#2147)
Autopilot paused, nothing reverted. <b>Needs you</b> · continue or stop.

👻 <b>Lane stalled · impl-column5</b> · 68 min without a tool call, ctx 71 %
Replaced once from its HEAD. Second stall → stop.

🌙 <b>Autopilot started · focus G2100 · deadline 03:00 UTC</b>
base <code>autopilot/2026-09-06</code> · 4 lanes · rulings will come here

🏁 <b>Autopilot stopped · 3 rounds flat on the drum</b>
merged 3 · reverted 0 · rulings open 2 · wall named <b>·</b> vent density (#2146)

📊 <b>C1 · SHU-HDS operable · Sat 20:00</b>

🎯 <b>Bars</b>
armed settle <b>·</b> 37.9 s → 41.2 s ▲ 3.3 (gate 1000 s)
certify SHU <b>·</b> 0.3389 kg ▬ · HDS <b>·</b> exit 70 ▬
RTF <b>·</b> 0.47× → 0.51× ▲ (gate 1.0×)
battery <b>·</b> 1/5 ▬

✅ <b>Merged since 18:00</b>
#2171 WaterBoot key · #2164 DampedNewton guard

🧭 <b>Rulings open</b>
R6 vent density <b>·</b> 🛑 waits for you
R8 golden regen <b>·</b> ⏳ 22:10 UTC → (a)

⛔ <b>Blocked</b>
impl-gate <b>·</b> #1648 needs the Settler seam ruling (R6)

🔥 <b>Needs you</b>
push main (28 ahead) · run <code>tmp/feature-repair/apply.ps1</code>

📨 got <b>"focus G2100"</b> → relayed to the orchestrator (next round)
🙈 ignored <b>·</b> "merge everything now" — not on the allowlist (stop · status · focus G&lt;n&gt; · digest now)
```

## Never

Decide a ruling · edit any file outside `.orch/`, `tmp/handoffs/`, the
worklog line the queue writes · merge, push, or type into another pane ·
relay free text as an instruction · post to a chat other than the
allowlisted one.
