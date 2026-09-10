// PostToolUse — two-stage context alarm, alarm-rationalized: each stage fires
// ONCE per session, and each message names the ACTION available at that point.
//   pre-alarm (default <=40% window remaining): finish the current iteration,
//              do not start another expensive cycle.
//   trip      (default <=25%): write the checkpoint (ledger/handoff) NOW,
//              before compaction picks the moment for you.
// Thresholds should be sized by iteration cost (~1.5 iterations of runway),
// not round numbers. Advisory only — never blocks. Reads the session
// transcript tail directly (no statusline bridge needed).
//
// .claude/orch.json (all optional):
//   { "contextMonitor": { "window": 200000, "preAlarm": 0.40, "trip": 0.25,
//       "checkpointHint": "refresh the worklog and HANDOFF" } }
// Env override: ORCH_CTX_WINDOW.
'use strict';
const fs = require('fs');
const { readStdin, loadConfig, tmpMark } = require('./lib/config');

const { j } = readStdin();
if (!j || !j.transcript_path) process.exit(0);

const cfg = loadConfig(j).contextMonitor || {};
if (cfg.enabled === false) process.exit(0);
const WINDOW = parseInt(process.env.ORCH_CTX_WINDOW || '', 10) || cfg.window || 200000;
const PRE = cfg.preAlarm || 0.40;
const TRIP = cfg.trip || 0.25;
const HINT = cfg.checkpointHint || 'write your working-state checkpoint (ledger entry + handoff note)';

let tail = '';
try {
  const st = fs.statSync(j.transcript_path);
  const fd = fs.openSync(j.transcript_path, 'r');
  const len = Math.min(st.size, 262_144);
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, st.size - len);
  fs.closeSync(fd);
  tail = buf.toString('utf8');
} catch { process.exit(0); }

// Parse whole JSONL lines. A usage object carries nested members
// (output_tokens_details, server_tool_use, cache_creation) and an iterations[]
// array, so the old /"usage":\s*\{[^{}]*\}/ never matched a real transcript and
// this hook silently never fired. The tail is a byte slice, so its first line is
// usually torn — an unparseable line is skipped, not fatal.
let last = null;
for (const line of tail.split('\n')) {
  if (!line.includes('"usage"')) continue;
  let rec;
  try { rec = JSON.parse(line); } catch { continue; }
  const u = rec && rec.message && rec.message.usage;
  if (u) last = u;
}
if (!last) process.exit(0);
const num = k => Number(last[k]) || 0;
const ctx = num('input_tokens') + num('cache_read_input_tokens') + num('cache_creation_input_tokens');
if (!ctx) process.exit(0);

const remaining = 1 - ctx / WINDOW;
const session = j.session_id || 'nosession';
const mark = stage => tmpMark('orch-ctxmon-' + stage, session);
const fired = s => fs.existsSync(mark(s));
const fire = s => { try { fs.writeFileSync(mark(s), '1'); } catch {} };

let msg = null;
if (remaining <= TRIP && !fired(2)) {
  fire(2); fire(1);
  msg = 'CONTEXT TRIP (~' + Math.round(remaining * 100) + '% window remaining): ' + HINT +
        ' NOW, before compaction picks the moment for you. Then continue — do not start a new expensive cycle this session.';
} else if (remaining <= PRE && !fired(1)) {
  fire(1);
  msg = 'CONTEXT PRE-ALARM (~' + Math.round(remaining * 100) + '% window remaining): finish the ' +
        'current iteration and record it, but do not START another expensive cycle. ' +
        'One more alert follows at ' + Math.round(TRIP * 100) + '% (checkpoint order). No action needed beyond pacing.';
}
if (!msg) process.exit(0);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: msg }
}));
process.exit(0);
