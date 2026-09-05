// role-guardrails: every ORCH_ROLE row (spec §6), fail-open, ADVISORY audit
// lines. Fresh git repo per run (the marker lives in the git common dir);
// fake HOME so the real lock never interferes.
'use strict';
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'hooks', 'role-guardrails.js');
const SCRATCH = path.join(__dirname, `scratch-roles-${process.pid}`);
const FAKEHOME = path.join(SCRATCH, 'home');
const PROJ = path.join(SCRATCH, 'proj');
const AUDIT = path.join(PROJ, '.claude', 'orch-audit.jsonl');
const LOCK = path.join(FAKEHOME, '.claude', 'orch-lock.json');
process.on('exit', () => { try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch {} });
fs.mkdirSync(path.join(FAKEHOME, '.claude'), { recursive: true });
fs.mkdirSync(path.join(PROJ, '.claude'), { recursive: true });
execFileSync('git', ['init', '-q', PROJ], { stdio: 'ignore' });
const { resolveRepoKey } = require('../hooks/lib/config');
const { writeMarker } = require('../hooks/lib/session');
const COMMON = resolveRepoKey(PROJ);

const CONTRACT = { contract: { domains: {
  core: { paths: ['src/**'], decide: 'human', ship: 'none' },
  docs: { paths: ['docs/**', '**/*.md'], decide: 'ai', ship: 'push' } } } };
function cfg(obj) { fs.writeFileSync(path.join(PROJ, '.claude', 'orch.json'), JSON.stringify(obj)); }
function put(rel, content) { const p = path.join(PROJ, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); }
function audit() { try { return fs.readFileSync(AUDIT, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } }
function last() { const a = audit(); return a[a.length - 1] || {}; }

let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
function run(tool, rel, role, input = {}, session = 'rg-none') {
  const payload = JSON.stringify({ session_id: session, cwd: PROJ, tool_name: tool, tool_input: { file_path: path.join(PROJ, rel), ...input } });
  const r = spawnSync('node', [HOOK], { input: payload, env: { ...process.env, USERPROFILE: FAKEHOME, HOME: FAKEHOME, ORCH_ROLE: role, ORCH_IDS: '' }, encoding: 'utf8' });
  return { code: r.status, err: r.stderr || '' };
}
cfg(CONTRACT);

// --- no role / fail-open --------------------------------------------------------
check('no ORCH_ROLE: Write anywhere -> 0', run('Write', 'src/a.js', '').code === 0 && run('Write', 'docs/reviews/x.md', '').code === 0);
check('unknown role: passes through', run('Write', 'docs/reviews/x.md', 'janitor').code === 2 && run('Write', 'src/a.js', 'janitor').code === 0);
check('no file_path -> 0', spawnSync('node', [HOOK], { input: JSON.stringify({ session_id: 's', cwd: PROJ, tool_name: 'Write', tool_input: {} }), env: { ...process.env, ORCH_ROLE: 'reviewer' }, encoding: 'utf8' }).status === 0);
check('unknown tool -> 0', run('Grep', 'src/a.js', 'reviewer').code === 0);
check('empty stdin -> 0', spawnSync('node', [HOOK], { input: '', env: { ...process.env, ORCH_ROLE: 'reviewer' }, encoding: 'utf8' }).status === 0);

// --- reviewer edits only docs/reviews/ ---------------------------------------------
{ const r = run('Write', 'src/a.js', 'reviewer');
  check('reviewer Write src/ -> 2, says ADVISORY', r.code === 2 && /^BLOCKED \(orch role-guardrail, ADVISORY\)/m.test(r.err) && /docs\/reviews/.test(r.err));
  check('audit line: role-guardrail, reviewer, label ADVISORY, file relative', last().action === 'role-guardrail' && last().role === 'reviewer' && last().label === 'ADVISORY' && last().file === 'src/a.js' && last().verdict === 'BLOCK'); }
check('reviewer Edit docs/reviews/M53.G142.S2.R1-1.md -> 0', run('Edit', 'docs/reviews/M53.G142.S2.R1-1.md', 'reviewer', { old_string: 'a', new_string: 'b' }).code === 0);
check('reviewer Write docs/reviews/rubrics/x.abc.md -> 0', run('Write', 'docs/reviews/rubrics/x.abc.md', 'reviewer', { content: '' }).code === 0);
check('reviewer Write docs/reviews-notes/x.md -> 2 (prefix is a segment)', run('Write', 'docs/reviews-notes/x.md', 'reviewer').code === 2);
check('reviewer Read src/ -> 0 (reads freely)', run('Read', 'src/a.js', 'reviewer').code === 0);

// --- only a reviewer writes docs/reviews/ -----------------------------------------
{ const r = run('Write', 'docs/reviews/M53.G142.S2.R1.md', 'dev');
  check('dev Write docs/reviews/ -> 2, names orch review', r.code === 2 && /orch review/.test(r.err) && last().role === 'dev'); }
check('architect Edit docs/reviews/ -> 2', run('Edit', 'docs/reviews/x.md', 'architect', { old_string: 'a', new_string: 'b' }).code === 2);
check('coordinator Write docs/reviews/ -> 2', run('Write', 'docs/reviews/x.md', 'coordinator').code === 2);
check('dev Write src/a.js -> 0', run('Write', 'src/a.js', 'dev', { content: 'x' }).code === 0);
check('dev Read docs/reviews/ -> 0', run('Read', 'docs/reviews/x.md', 'dev').code === 0);

// --- coordinator reads no code ------------------------------------------------------
check('coordinator Read tmp/handoffs/ -> 0', run('Read', 'tmp/handoffs/M53.G142.S2-dev.md', 'coordinator').code === 0);
check('coordinator Read docs/reviews/ -> 0', run('Read', 'docs/reviews/M53.G142.S2.R1.md', 'coordinator').code === 0);
check('coordinator Read .claude/orch.json -> 0', run('Read', '.claude/orch.json', 'coordinator').code === 0);
{ const r = run('Read', 'src/a.js', 'coordinator');
  check('coordinator Read src/ -> 2, points to dispatch', r.code === 2 && /reads no code/.test(r.err) && /dispatch/.test(r.err) && last().tool === 'Read'); }
check('coordinator Read .claude/orch-audit.jsonl -> 2 (allowlist is four entries)', run('Read', '.claude/orch-audit.jsonl', 'coordinator').code === 2);
check('coordinator with no marker goal: any worklog -> 0 (fail-open)', run('Read', 'tmp/worklogs/G7-x.md', 'coordinator').code === 0);
writeMarker(COMMON, 'rg-coord', { role: 'coordinator', milestone: 'M53', goal: 'G142', step: null, startedAt: '2026-01-01T00:00:00.000Z' });
check('coordinator with marker goal G142: its worklog -> 0', run('Read', 'tmp/worklogs/G142-hds.md', 'coordinator', {}, 'rg-coord').code === 0);
{ const r = run('Read', 'tmp/worklogs/G7-x.md', 'coordinator', {}, 'rg-coord');
  check('coordinator with marker goal G142: another worklog -> 2, names G142', r.code === 2 && /G142/.test(r.err)); }
check('coordinator Write src/ -> 0 (no write row for the coordinator)', run('Write', 'src/a.js', 'coordinator', { content: 'x' }).code === 0);
check('coordinator Read outside the repo -> 2', spawnSync('node', [HOOK], { input: JSON.stringify({ session_id: 's', cwd: PROJ, tool_name: 'Read', tool_input: { file_path: path.join(SCRATCH, 'elsewhere.js') } }), env: { ...process.env, USERPROFILE: FAKEHOME, HOME: FAKEHOME, ORCH_ROLE: 'coordinator' }, encoding: 'utf8' }).status === 2);

// --- every refusal so far is labelled ADVISORY --------------------------------------
check('all audit lines carry label ADVISORY and by hook', audit().length >= 8 && audit().every(a => a.label === 'ADVISORY' && a.by === 'hook' && a.verdict === 'BLOCK'));

module.exports = { run, cfg, put, audit, last, check, CONTRACT, COMMON, PROJ, LOCK, writeMarker };
if (require.main === module) { console.log(`\n${pass}/${pass + fail} pass`); process.exit(fail ? 1 : 0); }
