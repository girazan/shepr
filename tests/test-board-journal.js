'use strict';
const fs = require('fs');
const path = require('path');
const { openJournal } = require('../scripts/lib/journal');
const SCRATCH = path.join(__dirname, 'scratch-journal');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
const J = path.join(SCRATCH, 'board-journal.jsonl');
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
let j = openJournal(J);
check('fresh journal has no pending', j.pending().length === 0);
j.intent({ opId: 'a', lane: 'G1', subEffect: 'createIssue', desired: { title: 'x' } });
check('intent is pending', j.pending().map(r => r.opId).join() === 'a');
j.done('a', 'I_123');
check('done clears pending', j.pending().length === 0);
j.intent({ opId: 'b', lane: 'G1', subEffect: 'comment', desired: {} });
j.intent({ opId: 'c', lane: 'G1', subEffect: 'close', desired: {} });
j.done('c', 'x');
check('pending preserves file order and skips done', j.pending().map(r => r.opId).join() === 'b');
fs.appendFileSync(J, '{"opId":"torn","status":"inte');
check('torn final line is ignored', openJournal(J).pending().map(r => r.opId).join() === 'b');
j = openJournal(J);
j.intent({ opId: 'd', lane: 'G2', subEffect: 'x', desired: {} });
const lines = fs.readFileSync(J, 'utf8').split('\n').filter(Boolean);
check('append after torn line starts on a fresh line', JSON.parse(lines[lines.length - 1]).opId === 'd');
check('records carry ts', typeof JSON.parse(lines[0]).ts === 'string');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
