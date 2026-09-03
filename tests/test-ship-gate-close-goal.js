'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const SHIPHOOK = path.join(__dirname, '..', 'hooks', 'contract-ship-gate.js');
const SCRATCH = path.join(__dirname, 'scratch-close-goal');
const FAKEHOME = path.join(SCRATCH, 'home');
const PROJ = path.join(SCRATCH, 'proj');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(path.join(FAKEHOME, '.claude'), { recursive: true });
fs.mkdirSync(path.join(PROJ, '.claude'), { recursive: true });
const g = a => execFileSync('git', ['-C', PROJ, ...a], { stdio: ['ignore', 'pipe', 'pipe'] });
g(['init', '-q']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
fs.writeFileSync(path.join(PROJ, '.claude', 'orch.json'), JSON.stringify({ contract: { domains: { all: { paths: ['**'], decide: 'ai', ship: 'commit' } } } }));
fs.writeFileSync(path.join(PROJ, 'README.md'), 'x');
g(['add', '.']); g(['commit', '-qm', 'init']);
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
function run(cmd) {
  const payload = JSON.stringify({ session_id: 's', cwd: PROJ, tool_input: { command: cmd } });
  try { execFileSync('node', [SHIPHOOK], { input: payload, env: { ...process.env, USERPROFILE: FAKEHOME, HOME: FAKEHOME }, stdio: ['pipe', 'pipe', 'pipe'] }); return 0; }
  catch (e) { return e.status; }
}
const CMD = 'node scripts/board-gh.js close-goal G142 --evidence "iter 3 · G142 · 10 → 2"';
check('no worklog at HEAD → BLOCK', run(CMD) === 2);
fs.mkdirSync(path.join(PROJ, 'tmp', 'worklogs'), { recursive: true });
fs.writeFileSync(path.join(PROJ, 'tmp', 'worklogs', 'G142-kg.md'), 'BRIEF\ngoal: x\n');
check('worklog uncommitted → still BLOCK', run(CMD) === 2);
g(['add', '-f', 'tmp/worklogs/G142-kg.md']); g(['commit', '-qm', 'wl']);
check('committed worklog without ledger line → BLOCK', run(CMD) === 2);
fs.appendFileSync(path.join(PROJ, 'tmp', 'worklogs', 'G142-kg.md'), 'iter 3 · G142 · 10 → 2 · ok\n');
check('ledger line only in working copy → BLOCK (HEAD is the truth)', run(CMD) === 2);
g(['add', '-f', 'tmp/worklogs/G142-kg.md']); g(['commit', '-qm', 'ledger']);
check('ledger line at HEAD → ALLOW', run(CMD) === 0);
check('other goal still blocked', run(CMD.replace(/G142/g, 'G7')) === 2);
check('read verb untouched', run('node scripts/board-gh.js read --json') === 0);
const audit = fs.readFileSync(path.join(PROJ, '.claude', 'orch-audit.jsonl'), 'utf8');
check('ALLOW audited with lane', /"action":"close-goal".*"lane":"G142".*"verdict":"ALLOW"/.test(audit));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
