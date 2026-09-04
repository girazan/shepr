// Stop hook — a heavy edit session may not end while every configured trail
// file is untouched today (the "leave a record" gate). Blocks ONCE
// (stop_hook_active guards the loop). Advisory-class blocking: fail-open on
// abnormal input. No-ops without config.
//
// .claude/orch.json:
//   { "sessionHygiene": {
//       "trailPaths": ["tmp/worklogs", "tmp/HANDOFF.md"],
//       "minEdits": 8
//   } }
// Relative trailPaths resolve against the hook payload cwd (project root).
'use strict';
const fs = require('fs');
const path = require('path');
const { readStdin, loadConfig } = require('./lib/config');

const { j } = readStdin();
if (!j) process.exit(0);
if (j.stop_hook_active) process.exit(0); // already blocked once — let it end

const cfg = loadConfig(j).sessionHygiene || {};
const trails = cfg.trailPaths || [];
if (!trails.length) process.exit(0);
const minEdits = cfg.minEdits || 8;

// Count real Edit/Write tool_use blocks by parsing the JSONL, not by
// regexing raw text — raw matching also counted rejected calls and broke
// on transcript-format drift. Unparseable lines are skipped (fail-open).
let edits = 0;
try {
  for (const line of fs.readFileSync(j.transcript_path, 'utf8').split('\n')) {
    if (!line.includes('tool_use')) continue;
    try {
      const content = (JSON.parse(line).message || {}).content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (c && c.type === 'tool_use' && /^(Edit|Write)$/.test(c.name)) edits++;
      }
    } catch { /* not JSON or unexpected shape — skip the line */ }
  }
} catch { process.exit(0); }
if (edits < minEdits) process.exit(0);

const today = new Date().toDateString();
const touchedToday = p => {
  try {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      return fs.readdirSync(p).some(n => {
        try { return fs.statSync(path.join(p, n)).mtime.toDateString() === today; }
        catch { return false; }
      });
    }
    return st.mtime.toDateString() === today;
  } catch { return false; }
};

const root = j.cwd || process.cwd();
if (trails.some(p => touchedToday(path.isAbsolute(p) ? p : path.join(root, p)))) process.exit(0);

console.error(
  `SESSION HYGIENE: ${edits} edits this session but none of the trail files ` +
  `(${trails.join(', ')}) were touched today. Capture the state (a ledger line, a ` +
  'status update, a handoff note) before finishing — the files are the record, ' +
  'the conversation is not. If this session genuinely produced nothing durable, ' +
  'say so and stop again.'
);
process.exit(2);
