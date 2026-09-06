#!/usr/bin/env node
// codex-watch.js — poll Codex `exec` output files for a terminal line and
// print ONE event per file: `<file>: VERDICT: PASS|FAIL`, `<file>: QUOTA`
// (usage limit hit — no verdict), or `<file>: ENDED` (process finished,
// "tokens used" seen, no verdict line). CRLF-safe: Codex writes \r\n on
// Windows and a `^...$` multiline regex never matches there (cost an
// orchestrator 2.5 h on 2026-09-06). Exits when every file has reported,
// or after --timeout minutes (default 240). Use under Monitor / a
// background shell; stdout lines are the events.
//   node scripts/codex-watch.js tmp/review-2148-r3-codex.out tmp/review-2155-r1-codex.out [--interval 60] [--timeout 240]
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
let interval = 60, timeout = 240;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--interval') interval = Number(args[++i]) || interval;
  else if (args[i] === '--timeout') timeout = Number(args[++i]) || timeout;
  else files.push(args[i]);
}
if (!files.length) { console.error('usage: codex-watch.js <out-file>... [--interval s] [--timeout min]'); process.exit(64); }

function verdictOf(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const lines = text.split(/\r?\n/);
  // Last occurrence wins: the prompt echoed at the top may quote an earlier
  // round's "VERDICT: FAIL", and a quota death after it must not be read as
  // that stale verdict.
  let verdict = null, verdictAt = -1, quotaAt = -1, endedAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const m = /^VERDICT:\s*(PASS|FAIL)\b/.exec(l);
    if (m) { verdict = m[1]; verdictAt = i; }
    if (/usage limit/i.test(l)) quotaAt = i;
    if (/^tokens used$/.test(l)) endedAt = i;
  }
  if (quotaAt > verdictAt) return 'QUOTA';
  if (verdict) return `VERDICT: ${verdict}`;
  if (endedAt >= 0) return 'ENDED';
  return null;
}

const done = new Set();
const deadline = Date.now() + timeout * 60000;
function tick() {
  for (const f of files) {
    if (done.has(f)) continue;
    const v = verdictOf(f);
    if (v) { console.log(`${path.basename(f)}: ${v}`); done.add(f); }
  }
  if (done.size === files.length) process.exit(0);
  if (Date.now() > deadline) { console.log(`TIMEOUT: ${files.filter(f => !done.has(f)).map(f => path.basename(f)).join(', ')} still running`); process.exit(1); }
  setTimeout(tick, interval * 1000);
}
tick();
