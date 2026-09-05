// stop-handoff: refuse one Stop until the role's handoff exists; size
// budgets advisory; fail-open on every missing input. Fresh git repo per
// run (marker in the common dir); fake HOME.
'use strict';
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'hooks', 'stop-handoff.js');
const SCRATCH = path.join(__dirname, `scratch-stop-${process.pid}`);
const FAKEHOME = path.join(SCRATCH, 'home');
const PROJ = path.join(SCRATCH, 'proj');
const TRANSCRIPT = path.join(SCRATCH, 'transcript.jsonl');
const AUDIT = path.join(PROJ, '.claude', 'orch-audit.jsonl');
process.on('exit', () => { try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch {} });
fs.mkdirSync(path.join(FAKEHOME, '.claude'), { recursive: true });
fs.mkdirSync(path.join(PROJ, '.claude'), { recursive: true });
execFileSync('git', ['init', '-q', PROJ], { stdio: 'ignore' });
const { resolveRepoKey } = require('../hooks/lib/config');
const { writeMarker } = require('../hooks/lib/session');
const { countEdits } = require('../hooks/lib/transcript');
const COMMON = resolveRepoKey(PROJ);

let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
const rec = (ts, name) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { content: [{ type: 'tool_use', name, input: {} }] } });
function transcript(lines) { fs.writeFileSync(TRANSCRIPT, lines.join('\n') + '\n'); }
function put(rel, content) { const p = path.join(PROJ, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); }
function run(session, extra = {}) {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify({ session_id: session, cwd: PROJ, transcript_path: TRANSCRIPT, ...extra }),
    env: { ...process.env, USERPROFILE: FAKEHOME, HOME: FAKEHOME, ORCH_ROLE: '', ORCH_IDS: '' }, encoding: 'utf8' });
  return { code: r.status, err: r.stderr || '' };
}
function audit() { try { return fs.readFileSync(AUDIT, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } }
const PAST = '2026-01-01T00:00:00.000Z';
const mark = (s, m) => writeMarker(COMMON, s, { milestone: null, goal: null, step: null, startedAt: PAST, ...m });

// --- countEdits ------------------------------------------------------------------
transcript([rec('2025-12-31T00:00:00Z', 'Edit'), rec('2026-01-02T00:00:00Z', 'Write'), rec('2026-01-03T00:00:00Z', 'Read'), '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit"}]}}', 'not json tool_use']);
check('countEdits: all Edit/Write, no since', countEdits(TRANSCRIPT) === 3);
check('countEdits: since drops older stamped records, keeps unstamped', countEdits(TRANSCRIPT, PAST) === 2);
check('countEdits: unreadable file -> 0', countEdits(path.join(SCRATCH, 'nope.jsonl')) === 0);

// --- fail-open ------------------------------------------------------------------------
transcript([rec('2026-01-02T00:00:00Z', 'Edit'), rec('2026-01-02T00:01:00Z', 'Write')]);
check('no marker -> 0', run('none').code === 0);
mark('norole', { role: null });
check('marker without role -> 0', run('norole').code === 0);
mark('rev', { role: 'reviewer', milestone: 'M53', goal: 'G142', step: 'S2' });
check('reviewer has no handoff -> 0', run('rev').code === 0);
mark('dev-noids', { role: 'dev', milestone: 'M53', goal: 'G142' });
check('dev without step id -> 0 (ids missing = fail-open)', run('dev-noids').code === 0);
mark('dev-nostart', { role: 'dev', milestone: 'M53', goal: 'G142', step: 'S2', startedAt: 'garbage' });
check('unparseable startedAt -> 0', run('dev-nostart').code === 0);
mark('dev-notx', { role: 'dev', milestone: 'M53', goal: 'G142', step: 'S2' });
check('unreadable transcript -> 0', run('dev-notx', { transcript_path: path.join(SCRATCH, 'nope.jsonl') }).code === 0);

// --- the rule -------------------------------------------------------------------------
mark('dev1', { role: 'dev', milestone: 'M53', goal: 'G142', step: 'S2' });
{ const r = run('dev1');
  check('dev, 2 edits, no handoff -> 2, names the file', r.code === 2 && /^HANDOFF \(orch, ADVISORY\)/m.test(r.err) && r.err.includes('tmp/handoffs/M53.G142.S2-dev.md'));
  const a = audit()[audit().length - 1];
  check('audit line: stop-handoff, dev, label ADVISORY, file named', a.action === 'stop-handoff' && a.role === 'dev' && a.label === 'ADVISORY' && a.file === 'tmp/handoffs/M53.G142.S2-dev.md' && a.verdict === 'BLOCK'); }
check('stop_hook_active -> 0 (refuse once)', run('dev1', { stop_hook_active: true }).code === 0);
transcript([rec('2025-12-31T00:00:00Z', 'Edit')]);
check('edits only before startedAt -> 0', run('dev1').code === 0);
transcript([rec('2026-01-02T00:00:00Z', 'Edit')]);
put('tmp/handoffs/M53.G142.S2-dev.md', 'done: wired\nnext: review\n');
check('handoff newer than startedAt -> 0', run('dev1').code === 0);
mark('dev-future', { role: 'dev', milestone: 'M53', goal: 'G142', step: 'S2', startedAt: '2030-01-01T00:00:00.000Z' });
transcript([rec('2030-01-01T01:00:00Z', 'Edit')]);
check('handoff older than startedAt (a previous pane\'s) -> 2', run('dev-future').code === 2);
transcript([rec('2026-01-02T00:00:00Z', 'Edit')]);
mark('arch1', { role: 'architect', milestone: 'M53', goal: 'G142' });
check('architect names M<n>.G<k>-architect.md', run('arch1').err.includes('tmp/handoffs/M53.G142-architect.md'));
mark('coord1', { role: 'coordinator', milestone: 'M53' });
check('coordinator names M<n>-coordinator.md', run('coord1').err.includes('tmp/handoffs/M53-coordinator.md'));
put('tmp/handoffs/M53.G142-architect.md', 'plan: 3 steps\n');
check('architect with handoff -> 0', run('arch1').code === 0);

// --- size budgets (advisory, exit 0) ----------------------------------------------------
put('tmp/handoffs/M53.G142-architect.md', Array.from({ length: 41 }, (_, i) => `line ${i}`).join('\n'));
{ const r = run('arch1');
  check('handoff over 40 lines -> 0 with a SIZE BUDGET line', r.code === 0 && /^SIZE BUDGET \(orch, ADVISORY\)/m.test(r.err) && /41 lines/.test(r.err)); }
put('tmp/handoffs/M53.G142-architect.md', 'short\n');
put('tmp/worklogs/G142-hds.md', 'BRIEF\ngoal: x\n\n## Plan\n' + Array.from({ length: 8 }, (_, i) => `- S${i + 1} step ${i + 1}`).join('\n') + '\n\n## Ledger\n');
{ const r = run('arch1');
  check('plan section with 8 steps -> 0 with a steps budget line', r.code === 0 && /8 steps/.test(r.err) && /budget 7/.test(r.err)); }
put('tmp/worklogs/G142-hds.md', 'BRIEF\ngoal: x\n\n## Plan\n' + Array.from({ length: 301 }, (_, i) => `note ${i}`).join('\n') + '\n## Ledger\n');
check('plan section over 300 lines -> budget line', /301 lines/.test(run('arch1').err));
put('tmp/worklogs/G142-hds.md', 'BRIEF\ngoal: x\n\n## Plan\n- S1 only\n\n## Ledger\n' + Array.from({ length: 400 }, (_, i) => `iter ${i}`).join('\n'));
check('a long ledger is not the plan section -> silent', run('arch1').err === '');
put('tmp/worklogs/G142-hds.md', 'BRIEF\ngoal: x\n\nno plan heading at all\n');
check('no ## Plan heading -> silent', run('arch1').err === '');

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
