// Append-only JSONL journal of board sub-effects (spec §4.3). Every record
// is fsynced before the function returns: an intent that isn't durable
// before its GitHub call can vanish and duplicate on resume.
'use strict';
const fs = require('fs');
const path = require('path');

function readRecords(filePath) {
  let raw = '';
  try { raw = fs.readFileSync(filePath, 'utf8'); } catch { return { records: [], tornTail: false }; }
  const lines = raw.split('\n');
  const records = [];
  let tornTail = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    try { records.push(JSON.parse(l)); }
    catch {
      // Only the LAST non-empty line may be torn (crash mid-append); it is
      // treated as absent. Anything else unparseable is corruption → throw.
      if (lines.slice(i + 1).every(x => !x)) { tornTail = true; break; }
      throw new Error(`board journal corrupt at line ${i + 1}: ${filePath}`);
    }
  }
  return { records, tornTail };
}

function openJournal(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  function append(rec) {
    const { tornTail } = readRecords(filePath);
    const fd = fs.openSync(filePath, 'a');
    try {
      fs.writeSync(fd, (tornTail ? '\n' : '') + JSON.stringify({ ...rec, ts: new Date().toISOString() }) + '\n');
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  }
  return {
    intent(rec) { append({ ...rec, status: 'intent' }); },
    done(opId, remoteId) { append({ opId, status: 'done', remoteId: remoteId == null ? null : remoteId }); },
    pending() {
      const { records } = readRecords(filePath);
      const doneIds = new Set(records.filter(r => r.status === 'done').map(r => r.opId));
      return records.filter(r => r.status === 'intent' && !doneIds.has(r.opId));
    },
  };
}

module.exports = { openJournal };
