// coordinator.js — the tick as code: pick rules 0–5 (file overlap), kill,
// capacity, pulse/stale, proposal text, launch side effects, fix rounds,
// verdict mapping, PR text, milestone summary, fleet/out-of-scope data.
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../scripts/coordinator');

let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}

const CONTRACT = { domains: {
  hmi: { paths: ['src/Hmi.Web/**', 'docs/**'], decide: 'ai', ship: 'commit', tiers: { work: 'mid', review: 'high' } },
  numerics: { paths: ['src/Core/**'], decide: 'human', ship: 'none' },
  shared: { paths: ['src/Shared/**'], decide: 'ai', ship: 'push', review: 'dual' } } };
const LS = ['src/Hmi.Web/a.cs', 'src/Core/calc.cs', 'src/Shared/util.cs', 'docs/reviews/M1.G2.S1.R1.md', 'docs/adr/0001-x.md', 'README.md'];
const goal = (lane, status, domains, items = [{ issue: 1, step: 'S1', recipe: 'tdd', text: 'the step', done: false, you: false, status: 'Todo' }]) =>
  ({ lane, issue: Number(lane.slice(1)), name: `name ${lane}`, status, bucket: 'Now', milestone: { number: 53, title: 'M53 · x' },
    brief: `BRIEF\ngoal: g\nmetric: m\ndone: d\ndomains: ${domains}\nfeature: ${domains.split(/[,\s]+/)[0]}\nkill: 3 sessions`, items });

// --- filesOfDomains ---------------------------------------------------------------
check('filesOfDomains: every listed domain, evidence paths removed', C.filesOfDomains(LS, CONTRACT, ['hmi', 'shared']).join() === 'src/Hmi.Web/a.cs,src/Shared/util.cs');
check('filesOfDomains: docs/** does not make a manifest or an ADR a domain file', !C.filesOfDomains(LS, CONTRACT, ['hmi']).some(f => f.startsWith('docs/')));
check('filesOfDomains: unknown domain → no files', C.filesOfDomains(LS, CONTRACT, ['nope']).length === 0);
check('domainsOf splits on comma or space', C.domainsOf('x\ndomains: hmi, numerics shared\n').join() === 'hmi,numerics,shared');

// --- pick: rules 0–5 ----------------------------------------------------------------
const filesOf = g => C.filesOfDomains(LS, CONTRACT, C.domainsOf(g.brief));
{
  const goals = [goal('G1', 'blocked', 'hmi'), goal('G2', 'needs_attention', 'hmi'), goal('G3', 'ready', 'hmi')];
  const r = C.pick({ goals, filesOf });
  check('rule 0: blocked and needs_attention are never picked, and are named', r.pick.lane === 'G3' && r.skipped.map(s => s.lane + ':' + s.reason).join('|') === 'G1:rule 0: blocked|G2:rule 0: needs_attention');
}
{
  const goals = [goal('G3', 'ready', 'hmi'), goal('G4', 'ready', 'numerics')];
  check('rule 1: the named goal wins over board order', C.pick({ goals, named: 'g4', filesOf }).pick.lane === 'G4');
  check('rule 1: a named goal that is blocked is not picked', C.pick({ goals: [goal('G4', 'blocked', 'numerics')], named: 'G4', filesOf }).pick === null);
  check('rule 1: a named goal not on the board → null, said', C.pick({ goals, named: 'G9', filesOf }).skipped[0].reason === 'rule 1: not on the board');
}
{
  const goals = [goal('G3', 'ready', 'hmi'), goal('G5', 'review', 'numerics'), goal('G6', 'running', 'shared')];
  check('rule 2: in-flight (review/running) beats ready, first in board order', C.pick({ goals, filesOf }).pick.lane === 'G5');
}
{
  const goals = [goal('G7', 'ready', 'hmi'), goal('G8', 'ready', 'numerics'), goal('G9', 'merged', 'hmi')];
  check('rules 3–4: board order is the tie-break; merged never picked', C.pick({ goals, filesOf }).pick.lane === 'G7');
}
{
  const goals = [goal('G6', 'running', 'hmi'), goal('G7', 'ready', 'hmi, numerics'), goal('G8', 'ready', 'numerics')];
  const r = C.pick({ goals, filesOf });
  check('rule 2 still picks the running goal itself', r.pick.lane === 'G6');
  const r2 = C.pick({ goals: goals.filter(g => g.lane !== 'G6').concat([{ ...goal('G6', 'running', 'hmi'), items: [] }]), filesOf });
  check('rule 5: a candidate sharing a file with a running goal is skipped with the file named',
    r2.pick.lane === 'G8' && r2.skipped.some(s => s.lane === 'G7' && s.reason === 'rule 5: shares src/Hmi.Web/a.cs with G6'));
  const ovl = [goal('G6', 'running', 'hmi'), goal('G7', 'ready', 'docs-only')];
  check('rule 5 compares files, not globs: overlapping globs with no common file do not collide', C.pick({ goals: ovl, named: 'G7', filesOf: g => g.lane === 'G7' ? ['docs/x.md'] : filesOf(g) }).pick.lane === 'G7');
}

// --- kill / capacity / pulse -----------------------------------------------------
check('killCheck: "<n> sessions" trips at n dispatches', C.killCheck('kill: 3 sessions', 3).tripped === true && C.killCheck('kill: 3 sessions', 2).tripped === false);
check('killCheck: prose kill lines are returned, never tripped by code', C.killCheck('kill: when the metric stops moving', 99).tripped === false && C.killCheck('kill: when the metric stops moving', 99).line === 'when the metric stops moving');
const ROSTER = { delegates: [{ name: 'impl-G6-S1', status: 'running' }, { name: 'impl-G2-S3', status: 'reserved' }, { name: 'old', status: 'done' }, { name: 'gone', status: 'torn-down' }] };
check('capacityCheck counts reserved+running only', C.capacityCheck(ROSTER, 6).count === 2 && C.capacityCheck(ROSTER, 2).full === true && C.capacityCheck(null).full === false);
const T0 = Date.parse('2026-09-06T10:00:00Z');
const AUDIT = [{ ts: '2026-09-06T09:00:00Z', by: 'hook' }, { ts: '2026-09-06T09:30:00Z', by: 'pulse', goal: 'G3', action: 'dispatch' }, { ts: '2026-09-06T09:40:00Z', by: 'pulse', goal: 'G3', action: 'await-dev' }];
check('pulseAge: minutes since the last pulse line, null when none', C.pulseAge(AUDIT, T0) === 20 && C.pulseAge([{ ts: '2026-09-06T09:00:00Z', by: 'hook' }], T0) === null);

// --- tick -------------------------------------------------------------------------
const base = { contract: CONTRACT, lsFiles: LS, roster: ROSTER, audit: AUDIT, now: T0, capacity: 6, worklogOf: () => 'BRIEF\n', manifestsOf: () => [] };
{
  const t = C.tick({ ...base, goals: [goal('G3', 'ready', 'hmi')] });
  check('tick: unrouted ready goal → route (branch + ROUTE line first)', t.action === 'route' && t.pick === 'G3' && t.step.step === 'S1' && t.step.recipe === 'tdd');
  const t2 = C.tick({ ...base, goals: [goal('G3', 'ready', 'hmi')], worklogOf: () => 'BRIEF\nROUTE: lane:G3 · hmi · decide:ai · ship:commit · tier:mid · base:abc · review:single · approved:auto · 2026-09-06\n' });
  check('tick: routed ready goal → dispatch', t2.action === 'dispatch' && t2.stale === 20);
  check('tick: capacity full → wait-capacity', C.tick({ ...base, capacity: 2, goals: [goal('G3', 'ready', 'hmi')], worklogOf: () => 'ROUTE: lane:G3 ' }).action === 'wait-capacity');
  check('tick: nothing eligible → idle', C.tick({ ...base, goals: [goal('G1', 'blocked', 'hmi')] }).action === 'idle');
  const killed = C.tick({ ...base, audit: AUDIT.concat([{ ts: '2026-09-06T09:50:00Z', by: 'pulse', goal: 'G3', action: 'dispatch' }, { ts: '2026-09-06T09:55:00Z', by: 'pulse', goal: 'G3', action: 'dispatch' }]), goals: [goal('G3', 'ready', 'hmi')] });
  check('tick: kill line tripped → kill, before anything else', killed.action === 'kill' && killed.kill.counted === 3);
  check('tick: running goal → await-dev', C.tick({ ...base, goals: [goal('G6', 'running', 'shared', [{ issue: 9, step: 'S1', done: false, you: false, status: 'In progress' }])] }).action === 'await-dev');
  const rev = [{ issue: 9, step: 'S1', done: false, you: false, status: 'In review' }];
  check('tick: review with no manifest yet → await-gate', C.tick({ ...base, goals: [goal('G6', 'review', 'shared', rev)] }).action === 'await-gate');
  const mf = (v, r) => ({ path: `docs/reviews/M53.G6.S1.R${r}.md`, text: `review: M53.G6.S1.R${r}\nverdict: ${v}\n` });
  const vt = C.tick({ ...base, goals: [goal('G6', 'review', 'shared', rev)], manifestsOf: () => [mf('fail', 1), mf('pass', 2)] });
  check('tick: review with a manifest → verdict, the highest round', vt.action === 'verdict' && vt.manifest.path.endsWith('R2.md'));
  const rr = C.tick({ ...base, goals: [goal('G6', 'review', 'shared', rev)], manifestsOf: () => [mf('inconclusive', 1)], audit: AUDIT.concat([{ ts: '2026-09-06T09:59:00Z', by: 'pulse', goal: 'G6', action: 'verdict', manifest: 'docs/reviews/M53.G6.S1.R1.md' }]) });
  check('tick: inconclusive already pulsed and attention cleared → gate-rerun', rr.action === 'gate-rerun');
  check('tick: routed goal with no open step → merge-gate', C.tick({ ...base, goals: [goal('G6', 'ready', 'shared', [{ issue: 9, step: 'S1', done: true, you: false, status: 'Done' }])], worklogOf: () => 'ROUTE: lane:G6 ' }).action === 'merge-gate');
  check('tick: YOU items are never a step', C.tick({ ...base, goals: [goal('G6', 'ready', 'shared', [{ issue: 9, step: 'S1', done: true, you: false }, { issue: 10, step: 'S2', done: false, you: true }])], worklogOf: () => 'ROUTE: lane:G6 ' }).action === 'merge-gate');
}
// main: tick prints JSON and appends {by:"pulse"}; --no-pulse does not.
{
  const SCRATCH = path.join(__dirname, 'scratch-coordinator'); fs.rmSync(SCRATCH, { recursive: true, force: true });
  const CWD = path.join(SCRATCH, 'repo'); fs.mkdirSync(path.join(CWD, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(CWD, '.claude', 'orch.json'), JSON.stringify({ contract: CONTRACT, fleet: { capacity: 6 } }));
  const deps = { cwd: CWD, commonDir: path.join(CWD, '.git'), board: () => ({ goals: [goal('G3', 'ready', 'hmi')] }), lsFiles: () => LS, now: T0 };
  let out = ''; const code = C.main(['tick'], { ...deps, stdout: s => { out += s; } });
  const j = JSON.parse(out);
  check('main tick: exit 0, JSON with action/pick/stale', code === 0 && j.action === 'route' && j.pick === 'G3' && j.stale === null);
  const audit = fs.readFileSync(path.join(CWD, '.claude', 'orch-audit.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  check('main tick: one pulse line {by:"pulse", goal, action, tick}', audit.length === 1 && audit[0].by === 'pulse' && audit[0].goal === 'G3' && audit[0].action === 'route' && audit[0].tick === new Date(T0).toISOString());
  out = ''; C.main(['tick', 'G3', '--no-pulse'], { ...deps, stdout: s => { out += s; } });
  check('main tick --no-pulse: no second line', fs.readFileSync(path.join(CWD, '.claude', 'orch-audit.jsonl'), 'utf8').trim().split('\n').length === 1 && JSON.parse(out).pick === 'G3');
  out = ''; const c2 = C.main(['tick'], { ...deps, board: () => { throw new Error('gh: HTTP 502'); }, stdout: s => { out += s; } });
  check('main tick: board unreachable → exit 1, says so, no pulse', c2 === 1 && /board unreachable: gh: HTTP 502/.test(out) && fs.readFileSync(path.join(CWD, '.claude', 'orch-audit.jsonl'), 'utf8').trim().split('\n').length === 1);
}

// --- proposal (d.29) — five lines, pinned ------------------------------------------
const P = { goal: 'G142', step: 'S2', item: 151, text: 'gate wired', role: 'dev', tier: 'mid', recipe: 'tdd', task: 'wire the ship gate to the GATE block',
  domains: ['hmi', 'numerics'], ship: 'none', review: 'single', fails: 0, fleet: { count: 2, capacity: 6 }, kill: '3 sessions' };
const FIVE = [
  'goal/step:        G142 · S2 · #151 · gate wired',
  'role/tier/recipe: dev · mid · tdd',
  'task:             wire the ship gate to the GATE block',
  'domains/ship:     hmi, numerics · ship:none · review:single',
  'caps:             fails 0/3 · no-progress 2 · fleet 2/6 · kill: 3 sessions' ].join('\n');
check('proposal is exactly five lines in the pinned shape', C.proposal(P) === FIVE);
check('proposal without a kill line says so', /kill: —$/.test(C.proposal({ ...P, kill: null })));
check('paneName is impl-G<k>-S<j>', C.paneName('G142', 'S2') === 'impl-G142-S2');

// --- launch: roster + herdr commands -------------------------------------------
// ASSUMPTION CORRECTED (Task 3 Step 0 — herdr --help / agent start --help /
// agent wait --help): the real CLI has no `--env` on `agent start` (it only
// takes --kind <KIND> --pane <ID>, attaching to an existing interactive
// pane); env vars are set at pane creation, `herdr pane split --env K=V`.
// `wait` is `herdr agent wait <target> --until …`, not a top-level `herdr
// wait`. Plan 3 also never grew an ORCH_MARKER lookup — hooks/lib/session.js
// keys the marker by the pane's real Claude session_id and materialises it
// lazily from ORCH_ROLE/ORCH_IDS env (hooks/session-start.js) — so launch()
// does not pre-create a marker file; it only sets that env on the new pane.
{
  const SCRATCH = path.join(__dirname, 'scratch-coordinator'); const REPO = path.join(SCRATCH, 'repo'); const COMMON = path.join(REPO, '.git');
  const BRIEF = path.join(SCRATCH, 'brief.md'); fs.writeFileSync(BRIEF, 'TASK: x\n');
  const calls = []; const exec = (cmd, args) => { calls.push([cmd, ...args]); return cmd === 'herdr' && args[0] === 'pane' ? 'pane-7\n' : ''; };
  const r = C.launch({ commonDir: COMMON, cwd: REPO, name: 'impl-G142-S2', role: 'dev', milestone: 'M53', goal: 'G142', step: 'S2', tier: 'mid', vehicle: 'herdr', brief: BRIEF, exec, now: T0 });
  const roster = JSON.parse(fs.readFileSync(r.roster, 'utf8'));
  const d = roster.delegates.find(x => x.name === 'impl-G142-S2');
  check('launch upserts a running roster entry in the v2 §3.1 shape', d && d.lane === 'G142' && d.role === 'mid' && d.vehicle === 'herdr' && d.status === 'running' && d.brief === BRIEF && d.createdAt === new Date(T0).toISOString() && d.lastSeen === d.createdAt);
  check('launch (herdr): pane split with ORCH_ROLE/ORCH_IDS env, then agent start --kind/--pane, then agent prompt with the brief text',
    calls.length === 3 &&
    calls[0][0] === 'herdr' && calls[0][1] === 'pane' && calls[0][2] === 'split' && calls[0].includes('ORCH_ROLE=dev') && calls[0].includes('ORCH_IDS=M53.G142.S2') &&
    calls[1][0] === 'herdr' && calls[1].slice(1, 3).join(' ') === 'agent start' && calls[1][3] === 'impl-G142-S2' && calls[1].includes('--kind') && calls[1].includes('--pane') && calls[1].includes('pane-7') &&
    calls[2][0] === 'herdr' && calls[2].slice(1, 3).join(' ') === 'agent prompt' && calls[2][3] === 'impl-G142-S2' && calls[2][4] === 'TASK: x\n');
  calls.length = 0;
  C.launch({ commonDir: COMMON, cwd: REPO, name: 'impl-G142-S2', role: 'dev', milestone: 'M53', goal: 'G142', step: 'S2', tier: 'high', vehicle: 'loop', brief: BRIEF, exec, now: T0 + 60000 });
  const again = JSON.parse(fs.readFileSync(r.roster, 'utf8')).delegates.filter(x => x.name === 'impl-G142-S2');
  check('launch (loop): no herdr call; re-launch replaces the entry, never duplicates', calls.length === 0 && again.length === 1 && again[0].role === 'high' && again[0].vehicle === 'loop');
}
// main: proposal prints the five lines and audits them; launch wires through.
{
  const SCRATCH = path.join(__dirname, 'scratch-coordinator'); const CWD = path.join(SCRATCH, 'repo');
  let out = '';
  const code = C.main(['proposal', '--goal', 'G142', '--step', 'S2', '--item', '151', '--text', 'gate wired', '--role', 'dev', '--tier', 'mid', '--recipe', 'tdd', '--task', 'wire the ship gate to the GATE block', '--domains', 'hmi,numerics', '--ship', 'none', '--review', 'single', '--fails', '0', '--kill', '3 sessions', '--mode', 'auto'],
    { cwd: CWD, commonDir: path.join(CWD, '.git'), stdout: s => { out += s; }, now: T0 });
  const audit = fs.readFileSync(path.join(CWD, '.claude', 'orch-audit.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const last = audit[audit.length - 1];
  check('main proposal: prints the five lines, audits {by:"dispatch", mode, lines}', code === 0 && out.trim().split('\n').slice(0, 5).join('\n') === FIVE.replace('fleet 2/6', 'fleet 1/6') && last.by === 'dispatch' && last.mode === 'auto' && last.goal === 'G142' && last.step === 'S2' && last.lines.length === 5);
  check('main proposal: fleet count read from the roster', /fleet 1\/6/.test(out));
  out = '';
  const c2 = C.main(['proposal', '--goal', 'G142'], { cwd: CWD, commonDir: path.join(CWD, '.git'), stdout: s => { out += s; } });
  check('main proposal: missing fields refused, none audited', c2 === 1 && /proposal: --step/.test(out) && fs.readFileSync(path.join(CWD, '.claude', 'orch-audit.jsonl'), 'utf8').trim().split('\n').length === audit.length);
}


console.log(`
${pass}/${n} pass`);
process.exit(fail ? 1 : 0);
