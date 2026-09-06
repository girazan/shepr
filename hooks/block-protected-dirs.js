// PreToolUse (Edit|Write) — refuses writes into protected directories
// (ground-truth data, acceptance targets, ruler directories — anything the
// agent reads but must never set). BLOCKING hook: fail-CLOSED on oversized
// payloads. No-ops without config.
//
// .claude/orch.json:
//   { "protectedDirs": ["acceptance", "ground-truth"] }
// Each entry matches as a path SEGMENT (start-or-separator delimited).
'use strict';
const { readStdin, loadConfig } = require('./lib/config');

const { j, oversized } = readStdin();
if (oversized) {
  console.error('BLOCKED (shepr): oversized hook payload — target path unverifiable, refusing.');
  process.exit(2);
}
if (!j) process.exit(0);
const f = (j.tool_input && (j.tool_input.file_path || j.tool_input.filePath)) || '';
if (!f) process.exit(0);

const dirs = loadConfig(j).protectedDirs || [];
for (const d of dirs) {
  const esc = String(d).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp('(^|[\\\\/])' + esc + '[\\\\/]', 'i').test(f)) {
    console.error(
      `BLOCKED: "${d}" is a protected directory (shepr config). A target that looks ` +
      `wrong gets REPORTED to the operator with a cited source — never edited.`
    );
    process.exit(2);
  }
}
process.exit(0);
