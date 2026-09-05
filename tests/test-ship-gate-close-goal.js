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
function run(cmd) { return runFull(cmd).code; }
function runFull(cmd) {
  const payload = JSON.stringify({ session_id: 's', cwd: PROJ, tool_input: { command: cmd } });
  try { execFileSync('node', [SHIPHOOK], { input: payload, env: { ...process.env, USERPROFILE: FAKEHOME, HOME: FAKEHOME }, stdio: ['pipe', 'pipe', 'pipe'] }); return { code: 0, err: '' }; }
  catch (e) { return { code: e.status, err: (e.stderr || Buffer.alloc(0)).toString() }; }
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
check('boundary: G14 does not match G142-*.md file', run(CMD.replace(/G142/g, 'G14')) === 2);
const audit = fs.readFileSync(path.join(PROJ, '.claude', 'orch-audit.jsonl'), 'utf8');
check('ALLOW audited with lane', /"action":"close-goal".*"lane":"G142".*"verdict":"ALLOW"/.test(audit));
check('without a lock entry the lint is ADVISORY: audit carries lint:ADVISORY and a reason', /"lint":"ADVISORY".*"reason":"frozen BRIEF/.test(audit));

// evidence text-fallback removed: a word from --evidence appearing anywhere
// in the worklog is not enough — only a ledger line naming the goal passes.
fs.writeFileSync(path.join(PROJ, 'tmp', 'worklogs', 'G8-kg.md'), 'BRIEF\ngoal: x\n');
g(['add', '-f', 'tmp/worklogs/G8-kg.md']); g(['commit', '-qm', 'wl8']);
check('evidence word present but no ledger line → BLOCK', run('node scripts/board-gh.js close-goal G8 --evidence BRIEF') === 2);

// close-goal no longer short-circuits: chained with a gated git verb, the
// close-goal pre-check ALLOWs its own part but control must continue into
// classify() so the chained verb is still gated.
check('close-goal ALLOW chained with git push → still gated (unresolvable base)',
  run(`${CMD} && git push origin main`) === 2);
check('git merge chained with close-goal ALLOW → still gated (denied verb)',
  run(`git merge x && ${CMD}`) === 2);
// ===================================================== ENFORCED*: lock entry present (spec §6 last row)
const { resolveRepoKey } = require('../hooks/lib/config');
const L = require('../hooks/lib/evidence-lint');
const CONTRACT = { domains: { all: { paths: ['**'], decide: 'ai', ship: 'commit', tiers: { review: 'high' } } } };
fs.writeFileSync(path.join(FAKEHOME, '.claude', 'orch-lock.json'), JSON.stringify({ repos: { [resolveRepoKey(PROJ)]: { contract: CONTRACT, models: { frontier: 'opus', high: 'opus', mid: 'sonnet', low: 'haiku', review: 'opus' }, board: { github: true } } } }));
const DONE = 'node scripts/board-gh.js done --goal G142 --step S1 151';
{
  const r = runFull('node scripts/board-gh.js done 151');
  check('bare done <item#> → BLOCK naming --goal/--step', r.code === 2 && /--goal G<n> --step S<j>/.test(r.err));
}
{
  const r = runFull(CMD);
  check('locked: close-goal with a ledger line but no ROUTE/manifest → BLOCK names the miss', r.code === 2 && /frozen BRIEF/.test(r.err));
}
{
  const r = runFull(DONE);
  check('locked: done with no ROUTE line → BLOCK (frozen BRIEF)', r.code === 2 && /frozen BRIEF/.test(r.err));
}
// Build a valid chain by hand: ROUTE at base → dev commit → rubric copy + slot + manifest.
const base = g(['rev-parse', 'HEAD']).toString().trim();
const WL = `BRIEF\ngoal: x\nmetric: m\ndone: d\ndomains: all\nfeature: all\nkill: k\n\nROUTE: lane:G142 · all · decide:ai · ship:commit · tier:mid · base:${base} · review:single · approved:auto · 2026-09-06\niter 3 · G142 · 10 → 2 · ok\n`;
fs.writeFileSync(path.join(PROJ, 'tmp', 'worklogs', 'G142-kg.md'), WL);
g(['add', '-f', 'tmp/worklogs/G142-kg.md']); g(['commit', '-qm', 'route']);
fs.writeFileSync(path.join(PROJ, 'src.js'), '1\n'); g(['add', 'src.js']); g(['commit', '-qm', 'dev']);
const head = g(['rev-parse', 'HEAD']).toString().trim();
const RUBRIC = 'rubric\n'; const RH = L.sha256(RUBRIC);
fs.mkdirSync(path.join(PROJ, 'docs', 'reviews', 'rubrics'), { recursive: true });
fs.writeFileSync(path.join(PROJ, 'docs', 'reviews', 'rubrics', `review-goal.${RH}.md`), RUBRIC);
const ID = 'M0.G142.S1.R1';
fs.writeFileSync(path.join(PROJ, 'docs', 'reviews', `${ID}-1.md`), `review: ${ID}\nrubric: review-goal.md@${RH}\nrange: ${base}..${head}\npaths: **\nverdict: pass\nreasons:\n- ok\nnotes:\n`);
fs.writeFileSync(path.join(PROJ, 'docs', 'reviews', `${ID}.md`), `review: ${ID}\ngoal: G142 · step: S1 · item: #151\nrubric: review-goal.md@${RH}\nrange: ${base}..${head}\npaths: **\nslots: 1\nslot-1: ${ID}-1.md · opus · high · pass\nverdict: pass\n`);
check('locked: manifest only in the working tree → BLOCK (HEAD is the truth)', runFull(DONE).code === 2);
g(['add', 'docs/reviews']); g(['commit', '-qm', 'review']);
{
  const r = runFull(DONE);
  check('locked: valid manifest at HEAD → done ALLOW', r.code === 0);
  check('locked: item mismatch → BLOCK names target', runFull(DONE.replace('151', '152')).code === 2 && /target:/.test(runFull(DONE.replace('151', '152')).err));
}
check('locked: close-goal without GATE block → BLOCK', /GATE/.test(runFull(CMD).err));
fs.appendFileSync(path.join(PROJ, 'tmp', 'worklogs', 'G142-kg.md'), `GATE: subject:${head} · regression:none · metric:ok · rootcause:named\n`);
g(['add', '-f', 'tmp/worklogs/G142-kg.md']); g(['commit', '-qm', 'gate']);
check('locked: GATE at HEAD, clean tail → close-goal ALLOW', runFull(CMD).code === 0);
fs.writeFileSync(path.join(PROJ, 'late.js'), 'x\n'); g(['add', 'late.js']); g(['commit', '-qm', 'late']);
{ const r = runFull(CMD); check('locked: a goal-path commit after the last passing head → BLOCK close tail', r.code === 2 && /close tail: late\.js/.test(r.err)); }
{
  const a = fs.readFileSync(path.join(PROJ, '.claude', 'orch-audit.jsonl'), 'utf8');
  check('audit: done ALLOW carries lint:PASS and the target', /"action":"done".*"verdict":"ALLOW".*"lint":"PASS".*"target":"docs\/reviews\/M0\.G142\.S1\.R1\.md"/.test(a));
  check('audit: BLOCK lines name the leg', /"action":"close-goal".*"verdict":"BLOCK".*"reason":"close-goal: evidence lint MISS close tail/.test(a));
}
fs.unlinkSync(path.join(FAKEHOME, '.claude', 'orch-lock.json'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
