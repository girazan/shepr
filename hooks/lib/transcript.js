// Transcript reader shared by the Stop hooks. Counts real Edit/Write
// tool_use blocks by parsing the JSONL — never by regexing raw text (that
// counted rejected calls and broke on format drift). `since` (ISO) keeps
// only records stamped at or after it; an unstamped record counts.
// Unreadable file → 0; unparseable lines are skipped (fail-open).
'use strict';
const fs = require('fs');

function countEdits(transcriptPath, since) {
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split('\n'); } catch { return 0; }
  const cut = since ? Date.parse(since) : NaN;
  let edits = 0;
  for (const line of lines) {
    if (!line.includes('tool_use')) continue;
    try {
      const rec = JSON.parse(line);
      if (!Number.isNaN(cut) && rec.timestamp && Date.parse(rec.timestamp) < cut) continue;
      const content = (rec.message || {}).content;
      if (!Array.isArray(content)) continue;
      for (const c of content) if (c && c.type === 'tool_use' && /^(Edit|Write)$/.test(c.name)) edits++;
    } catch { /* not JSON or unexpected shape — skip the line */ }
  }
  return edits;
}
module.exports = { countEdits };
