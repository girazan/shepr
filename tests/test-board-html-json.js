'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const SCRATCH = path.join(__dirname, 'scratch-board-html');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
const READ = { buckets: ['Now', 'Next', 'Later'],
  goals: [{ lane: 'G142', issue: 142, name: 'knowledge-gate', milestone: { number: 49, title: 'C1 SHU-HDS operable' }, status: 'running', blocker: null, brief: 'BRIEF', updated: 'x',
    items: [{ issue: 150, bucket: 'Now', pipeline: 'Engine', feature: null, status: 'In progress', text: 'write grammar', outcome: 'canonical home', gate: null, done: false, you: false, updated: 'x' },
            { issue: 151, bucket: 'Next', pipeline: null, feature: null, status: 'Done', text: 'tests', outcome: null, gate: 'GATE LIVE', done: true, you: false, updated: 'x' },
            { issue: 152, bucket: 'Now', pipeline: null, feature: null, status: 'Todo', text: 'run setup', outcome: null, gate: null, done: false, you: true, updated: 'x' }] }] };
const jp = path.join(SCRATCH, 'read.json'), out = path.join(SCRATCH, 'b.html');
fs.writeFileSync(jp, JSON.stringify(READ));
execFileSync('node', [path.join(__dirname, '..', 'scripts', 'board-html.js'), '--json', jp, out, '--title', 't']);
const html = fs.readFileSync(out, 'utf8');
check('renders G142 lane with name, milestone and status', /G142/.test(html) && /knowledge-gate/.test(html) && /C1 SHU-HDS operable/.test(html) && /running/.test(html));
check('renders items in buckets', /write grammar #150/.test(html) && /Next/.test(html));
check('done gate item struck through with its label', /<s>✓ tests #151<\/s>/.test(html) && /GATE LIVE/.test(html));
check('YOU item lands on the YOU lane', /run setup #152/.test(html) && /YOU/.test(html));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
