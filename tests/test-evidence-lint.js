// Evidence lint (spec §5): every leg has a passing and a failing case on a
// hand-built scratch repo. The lint reads git + the contract object only.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const L = require('../hooks/lib/evidence-lint');

const SCRATCH = path.join(__dirname, 'scratch-evidence-lint');
const REPO = path.join(SCRATCH, 'repo');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(REPO, { recursive: true });
const g = (...a) => execFileSync('git', ['-C', REPO, '-c', 'core.quotePath=false', ...a], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const git = a => g(...a);
g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');

let pass = 0, fail = 0, n = 0;
function check(name, cond) { n++; if (cond) { pass++; console.log(`  ok ${n}. ${name}`); } else { fail++; console.log(`FAIL ${n}. ${name}`); } }

function commit(files, msg) {
  for (const [p, c] of Object.entries(files)) { const f = path.join(REPO, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); }
  g('add', '-f', '-A'); g('commit', '-qm', msg); return g('rev-parse', 'HEAD').trim();
}
// Run fn with HEAD = <from> + one variant commit on a throwaway branch, then return to main.
function variant(name, from, files, fn) { g('checkout', '-q', '-b', name, from); commit(files, name); const r = fn(); g('checkout', '-q', 'main'); return r; }

const CONTRACT = { domains: {
  hmi: { paths: ['src/hmi/**', 'docs/**'], decide: 'ai', ship: 'commit', tiers: { review: 'high' } },
  core: { paths: ['src/core/**'], decide: 'ai', ship: 'commit', review: 'dual' },
  docs: { paths: ['docs/adr/**'], decide: 'ai', ship: 'none' } } };
const MODELS = { frontier: 'opus', high: 'opus', mid: 'sonnet', low: 'haiku', review: 'opus', 'review-alt': 'gpt' };
const RUBRIC = 'review-goal rubric\n'; const RH = L.sha256(RUBRIC);
const RUBRIC_PATH = `docs/reviews/rubrics/review-goal.${RH}.md`;
const PATHS = 'docs/** src/hmi/**';
const slot = (id, range, verdict, paths = PATHS) => `review: ${id}\nrubric: review-goal.md@${RH}\nrange: ${range}\npaths: ${paths}\nverdict: ${verdict}\nreasons:\n- cites done:\nnotes:\n`;
function manifest(o) {
  const lines = [`review: ${o.id}`, `goal: ${o.goal || 'G142'} · step: ${o.step} · item: ${o.item || '#151'}`, `rubric: ${o.rubric || `review-goal.md@${RH}`}`, `range: ${o.range}`];
  if (o.paths !== undefined) lines.push(`paths: ${o.paths}`);
  lines.push(`slots: ${o.slotsLine !== undefined ? o.slotsLine : o.slots.length}`);
  o.slots.forEach((s, i) => lines.push(`slot-${i + 1}: ${o.id}-${i + 1}.md · ${s.model || 'opus'} · ${s.tier || 'high'} · ${s.verdict}`));
  lines.push(`verdict: ${o.verdict || L.aggregate(o.slots.map(s => s.verdict))}`);
  return lines.join('\n') + '\n';
}
const lint = verb => L.lint({ git, contract: CONTRACT, models: MODELS, verb });
const DONE1 = { kind: 'done', goal: 142, step: 1, item: 151 };
const CLOSE = { kind: 'close', goal: 142 };

// --- pure helpers ----------------------------------------------------------------
check('goalPaths: union, sorted, evidence globs removed', L.goalPaths(CONTRACT, ['hmi', 'docs']).join(' ') === PATHS);
check('matchesGoal: evidence file under docs/** never matches', L.matchesGoal(['docs/**'], 'docs/x.md') && !L.matchesGoal(['docs/**'], 'docs/reviews/M1.G1.S1.R1.md') && !L.matchesGoal(['**'], 'tmp/worklogs/G1-x.md'));
check('slotsFor: 2 iff a frozen domain is dual', L.slotsFor(CONTRACT, ['hmi']) === 1 && L.slotsFor(CONTRACT, ['hmi', 'core']) === 2);
check('reviewTier: never below high; a frontier floor lifts it', L.reviewTier(CONTRACT, ['core']) === 'high' && L.reviewTier({ domains: { x: { paths: [], tiers: { review: 'frontier' } } } }, ['x']) === 'frontier');
check('aggregate: any fail → fail; all pass → pass; missing → inconclusive', L.aggregate(['pass', 'fail']) === 'fail' && L.aggregate(['pass', 'pass']) === 'pass' && L.aggregate(['pass', 'missing']) === 'inconclusive' && L.aggregate(['fail', 'missing']) === 'fail');
check('sha256 normalises CRLF', L.sha256('a\r\nb') === L.sha256('a\nb'));

// --- history: seed → ROUTE (frozen) → dev → review S1.R1 ------------------------------
const S0 = commit({ 'README.md': 'seed\n' }, 'seed');
const WL = `BRIEF\ngoal: x\nmetric: m\ndone: d\ndomains: hmi\nfeature: hmi\nkill: k\n\nROUTE: lane:G142 · hmi · decide:ai · ship:commit · tier:mid · base:${S0} · review:single · approved:auto · 2026-09-06\n`;
const W = commit({ 'tmp/worklogs/G142-hmi.md': WL }, 'route');
check('frozen: no ROUTE commit → miss', /frozen BRIEF/.test(L.frozen(git, 7, CONTRACT).miss));
{
  const fz = L.frozen(git, 142, CONTRACT);
  check('frozen: commit, path, base, domains, paths', fz.commit === W && fz.path === 'tmp/worklogs/G142-hmi.md' && fz.base === S0 && fz.domains.join() === 'hmi' && fz.paths.join(' ') === PATHS);
}
check('frozen: a later rewrite of domains: changes nothing', variant('rewrite', W, { 'tmp/worklogs/G142-hmi.md': WL.replace('domains: hmi', 'domains: hmi core') }, () => L.frozen(git, 142, CONTRACT).domains.join() === 'hmi'));
check('frozen: two worklogs in the introducing commit → ambiguous', variant('ambig', S0, { 'tmp/worklogs/G7-a.md': WL.replace(/G142/g, 'G7'), 'tmp/worklogs/G7-b.md': WL.replace(/G142/g, 'G7') }, () => L.frozen(git, 7, CONTRACT).miss === 'frozen BRIEF ambiguous'));
check('frozen: unknown domain in the frozen BRIEF → miss', variant('unk', S0, { 'tmp/worklogs/G8-a.md': WL.replace(/G142/g, 'G8').replace('domains: hmi', 'domains: ghost') }, () => /domain ghost/.test(L.frozen(git, 8, CONTRACT).miss)));

const D1 = commit({ 'src/hmi/a.js': '1\n' }, 'dev 1');
const ID1 = 'M53.G142.S1.R1';
const R1 = commit({ [RUBRIC_PATH]: RUBRIC, [`docs/reviews/${ID1}-1.md`]: slot(ID1, `${S0}..${D1}`, 'pass'),
  [`docs/reviews/${ID1}.md`]: manifest({ id: ID1, step: 'S1', range: `${S0}..${D1}`, paths: PATHS, slots: [{ verdict: 'pass' }] }) }, 'review S1.R1');

// --- done: target + every leg, passing and failing ------------------------------------
{ const r = lint(DONE1); check('done: valid S1.R1 → ok, target named', r.ok && r.target === `docs/reviews/${ID1}.md`); }
check('target: no manifest for the step → miss', /target: no manifest/.test(lint({ ...DONE1, step: 2 }).miss));
check('target: item mismatch → miss (all three ids bound)', /target:/.test(lint({ ...DONE1, item: 152 }).miss));
check('target: goal line mismatch → miss', variant('badgoal', D1, { [RUBRIC_PATH]: RUBRIC, [`docs/reviews/${ID1}-1.md`]: slot(ID1, `${S0}..${D1}`, 'pass'), [`docs/reviews/${ID1}.md`]: manifest({ id: ID1, goal: 'G143', step: 'S1', range: `${S0}..${D1}`, paths: PATHS, slots: [{ verdict: 'pass' }] }) }, () => /target:/.test(lint(DONE1).miss)));
check('(e) fail manifest → miss names (e)', variant('fail', D1, { [RUBRIC_PATH]: RUBRIC, [`docs/reviews/${ID1}-1.md`]: slot(ID1, `${S0}..${D1}`, 'fail'), [`docs/reviews/${ID1}.md`]: manifest({ id: ID1, step: 'S1', range: `${S0}..${D1}`, paths: PATHS, slots: [{ verdict: 'fail' }] }) }, () => /^\(e\)/.test(lint(DONE1).miss)));
check('(a) rubric copy missing at HEAD → miss', variant('norubric', D1, { [`docs/reviews/${ID1}-1.md`]: slot(ID1, `${S0}..${D1}`, 'pass'), [`docs/reviews/${ID1}.md`]: manifest({ id: ID1, step: 'S1', range: `${S0}..${D1}`, paths: PATHS, slots: [{ verdict: 'pass' }] }) }, () => /^\(a\)/.test(lint(DONE1).miss)));
check('(a) rubric copy content ≠ hash → miss', variant('badhash', R1, { [RUBRIC_PATH]: 'tampered\n' }, () => /^\(a\).*hash/.test(lint(DONE1).miss)));
const X = variant('side', S0, { 'src/hmi/side.js': 'x\n' }, () => g('rev-parse', 'HEAD').trim());
check('(b) head not an ancestor of HEAD → miss', variant('headoff', D1, { [RUBRIC_PATH]: RUBRIC, [`docs/reviews/${ID1}-1.md`]: slot(ID1, `${S0}..${X}`, 'pass'), [`docs/reviews/${ID1}.md`]: manifest({ id: ID1, step: 'S1', range: `${S0}..${X}`, paths: PATHS, slots: [{ verdict: 'pass' }] }) }, () => /^\(b\)/.test(lint(DONE1).miss)));
check('(b) base not an ancestor of head → miss', variant('baseoff', D1, { [RUBRIC_PATH]: RUBRIC, [`docs/reviews/${ID1}-1.md`]: slot(ID1, `${X}..${D1}`, 'pass'), [`docs/reviews/${ID1}.md`]: manifest({ id: ID1, step: 'S1', range: `${X}..${D1}`, paths: PATHS, slots: [{ verdict: 'pass' }] }) }, () => /^\(b\)|^\(c\)/.test(lint(DONE1).miss)));
check('(c) chain[0].base ≠ ROUTE base → miss', variant('chain0', D1, { [RUBRIC_PATH]: RUBRIC, [`docs/reviews/${ID1}-1.md`]: slot(ID1, `${W}..${D1}`, 'pass'), [`docs/reviews/${ID1}.md`]: manifest({ id: ID1, step: 'S1', range: `${W}..${D1}`, paths: PATHS, slots: [{ verdict: 'pass' }] }) }, () => /^\(c\) chain/.test(lint(DONE1).miss)));
check('(d) paths: ≠ sorted GOALPATHS → miss', variant('paths', D1, { [RUBRIC_PATH]: RUBRIC, [`docs/reviews/${ID1}-1.md`]: slot(ID1, `${S0}..${D1}`, 'pass', 'src/hmi/**'), [`docs/reviews/${ID1}.md`]: manifest({ id: ID1, step: 'S1', range: `${S0}..${D1}`, paths: 'src/hmi/**', slots: [{ verdict: 'pass' }] }) }, () => /^\(d\) paths/.test(lint(DONE1).miss)));
check('(d) slot file missing though slot line says pass → miss', variant('noslot', D1, { [RUBRIC_PATH]: RUBRIC, [`docs/reviews/${ID1}.md`]: manifest({ id: ID1, step: 'S1', range: `${S0}..${D1}`, paths: PATHS, slots: [{ verdict: 'pass' }] }) }, () => /^\(d\) slot-1/.test(lint(DONE1).miss)));
check('(d) slot file range ≠ manifest range → miss', variant('slotrange', D1, { [RUBRIC_PATH]: RUBRIC, [`docs/reviews/${ID1}-1.md`]: slot(ID1, `${W}..${D1}`, 'pass'), [`docs/reviews/${ID1}.md`]: manifest({ id: ID1, step: 'S1', range: `${S0}..${D1}`, paths: PATHS, slots: [{ verdict: 'pass' }] }) }, () => /^\(d\) slot-1.*range/.test(lint(DONE1).miss)));
check('(d) manifest verdict ≠ aggregate of slot files → miss', variant('agg', D1, { [RUBRIC_PATH]: RUBRIC, [`docs/reviews/${ID1}-1.md`]: slot(ID1, `${S0}..${D1}`, 'fail'), [`docs/reviews/${ID1}.md`]: manifest({ id: ID1, step: 'S1', range: `${S0}..${D1}`, paths: PATHS, slots: [{ verdict: 'fail' }], verdict: 'pass' }) }, () => /^\(d\) verdict/.test(lint(DONE1).miss)));
check('(f) model ≠ models.review → miss', variant('model', D1, { [RUBRIC_PATH]: RUBRIC, [`docs/reviews/${ID1}-1.md`]: slot(ID1, `${S0}..${D1}`, 'pass'), [`docs/reviews/${ID1}.md`]: manifest({ id: ID1, step: 'S1', range: `${S0}..${D1}`, paths: PATHS, slots: [{ verdict: 'pass', model: 'sonnet' }] }) }, () => /^\(f\).*model/.test(lint(DONE1).miss)));
check('(f) tier below high → miss', variant('tier', D1, { [RUBRIC_PATH]: RUBRIC, [`docs/reviews/${ID1}-1.md`]: slot(ID1, `${S0}..${D1}`, 'pass'), [`docs/reviews/${ID1}.md`]: manifest({ id: ID1, step: 'S1', range: `${S0}..${D1}`, paths: PATHS, slots: [{ verdict: 'pass', tier: 'mid' }] }) }, () => /^\(f\).*tier/.test(lint(DONE1).miss)));
check('(f) models.review not locked → miss', /^\(f\)/.test(L.lint({ git, contract: CONTRACT, models: {}, verb: DONE1 }).miss));

// --- dual: slots recomputed from the frozen domains ------------------------------------
{
  const WL2 = WL.replace(/G142/g, 'G200').replace('domains: hmi', 'domains: hmi core');
  const P2 = 'docs/** src/core/** src/hmi/**';
  const ok = variant('dual', S0, { 'tmp/worklogs/G200-x.md': WL2 }, () => {
    const d1 = commit({ 'src/core/c.js': '1\n' }, 'dev');
    const id = 'M53.G200.S1.R1';
    commit({ [RUBRIC_PATH]: RUBRIC, [`docs/reviews/${id}-1.md`]: slot(id, `${S0}..${d1}`, 'pass', P2), [`docs/reviews/${id}-2.md`]: slot(id, `${S0}..${d1}`, 'pass', P2),
      [`docs/reviews/${id}.md`]: manifest({ id, goal: 'G200', step: 'S1', range: `${S0}..${d1}`, paths: P2, slots: [{ verdict: 'pass' }, { verdict: 'pass', model: 'gpt' }] }) }, 'dual review');
    const okDual = lint({ kind: 'done', goal: 200, step: 1, item: 151 }).ok;
    commit({ [`docs/reviews/${id}.md`]: manifest({ id, goal: 'G200', step: 'S1', range: `${S0}..${d1}`, paths: P2, slotsLine: 1, slots: [{ verdict: 'pass' }] }) }, 'single on dual');
    const missSlots = /^\(d\) slots/.test(lint({ kind: 'done', goal: 200, step: 1, item: 151 }).miss);
    commit({ [`docs/reviews/${id}.md`]: manifest({ id, goal: 'G200', step: 'S1', range: `${S0}..${d1}`, paths: P2, slots: [{ verdict: 'pass' }, { verdict: 'pass', model: 'opus' }] }) }, 'alt model wrong');
    const missAlt = /^\(f\) slot-2.*model/.test(lint({ kind: 'done', goal: 200, step: 1, item: 151 }).miss);
    return okDual && missSlots && missAlt;
  });
  check('dual: two matching slots pass; slots:1 on a dual goal → (d); slot-2 model ≠ review-alt → (f)', ok);
}

// --- chain: S2 chains from S1 head; branched history; target must be last ---------------
const D2 = commit({ 'src/hmi/b.js': '2\n' }, 'dev 2');
const ID2 = 'M53.G142.S2.R1';
const R2 = commit({ [`docs/reviews/${ID2}-1.md`]: slot(ID2, `${D1}..${D2}`, 'pass'), [`docs/reviews/${ID2}.md`]: manifest({ id: ID2, step: 'S2', item: '#152', range: `${D1}..${D2}`, paths: PATHS, slots: [{ verdict: 'pass' }] }) }, 'review S2.R1');
check('chain: S2 base == S1 head → done S2 ok', lint({ kind: 'done', goal: 142, step: 2, item: 152 }).ok);
check('chain: done on S1 now → (c) not the latest passing manifest', /^\(c\)/.test(lint(DONE1).miss));
check('chain: the range containing only the evidence commit is fine (evidence never matches a domain)', variant('evonly', R2, { 'src/hmi/c.js': '3\n' }, () => { const d3 = g('rev-parse', 'HEAD').trim(); const id = 'M53.G142.S3.R1'; commit({ [`docs/reviews/${id}-1.md`]: slot(id, `${D2}..${d3}`, 'pass'), [`docs/reviews/${id}.md`]: manifest({ id, step: 'S3', item: '#153', range: `${D2}..${d3}`, paths: PATHS, slots: [{ verdict: 'pass' }] }) }, 'review S3'); return lint({ kind: 'done', goal: 142, step: 3, item: 153 }).ok; }));
check('chain: S2 base ≠ S1 head → (c) chain', variant('gap', D2, { [`docs/reviews/${ID2}-1.md`]: slot(ID2, `${S0}..${D2}`, 'pass'), [`docs/reviews/${ID2}.md`]: manifest({ id: ID2, step: 'S2', item: '#152', range: `${S0}..${D2}`, paths: PATHS, slots: [{ verdict: 'pass' }] }) }, () => /^\(c\) chain/.test(lint({ kind: 'done', goal: 142, step: 2, item: 152 }).miss)));
check('chain: two passing heads on divergent history → branched history', variant('branched', R2, { [`docs/reviews/${ID2}-1.md`]: slot(ID2, `${D1}..${X}`, 'pass'), [`docs/reviews/${ID2}.md`]: manifest({ id: ID2, step: 'S2', item: '#152', range: `${D1}..${X}`, paths: PATHS, slots: [{ verdict: 'pass' }] }) }, () => /branched history/.test(lint({ kind: 'done', goal: 142, step: 2, item: 152 }).miss)));
check('chain: a higher-R fail after a pass is the target and fails (e)', variant('r2fail', R2, { [`docs/reviews/M53.G142.S2.R2-1.md`]: slot('M53.G142.S2.R2', `${D1}..${D2}`, 'fail'), [`docs/reviews/M53.G142.S2.R2.md`]: manifest({ id: 'M53.G142.S2.R2', step: 'S2', item: '#152', range: `${D1}..${D2}`, paths: PATHS, slots: [{ verdict: 'fail' }] }) }, () => /^\(e\)/.test(lint({ kind: 'done', goal: 142, step: 2, item: 152 }).miss)));
check('plan manifests are not in the chain', variant('plan', R2, { 'docs/reviews/M53.G142.P.R1.md': `review: M53.G142.P.R1\ngoal: G142 · step: P · item: -\nrubric: review-goal.md@${RH}\nrange: ${X}..${X}\nslots: 1\nslot-1: M53.G142.P.R1-1.md · opus · high · pass\nverdict: pass\n` }, () => lint({ kind: 'done', goal: 142, step: 2, item: 152 }).ok));

// --- close-goal: GATE subject + every chain member + close tail ----------------------------
check('close: no GATE block → miss', /GATE/.test(lint(CLOSE).miss));
const GATE = `${WL}\nGATE: subject:${D2} · regression:none · metric:ok · rootcause:named\n`;
const C1 = commit({ 'tmp/worklogs/G142-hmi.md': GATE }, 'gate');
check('close: GATE subject == last passing head, clean tail → ok', lint(CLOSE).ok);
check('close: GATE subject ≠ last head → miss', variant('badsubj', R2, { 'tmp/worklogs/G142-hmi.md': GATE.replace(D2, D1) }, () => /GATE subject/.test(lint(CLOSE).miss)));
check('close tail: a goal-path file after the last passing head → miss', variant('tail', C1, { 'src/hmi/late.js': 'x\n' }, () => /close tail: src\/hmi\/late\.js/.test(lint(CLOSE).miss)));
check('close tail: evidence and other domains after the last head are fine', variant('tailok', C1, { 'docs/adr/0001.md': 'x\n', 'src/core/other.js': 'x\n' }, () => lint(CLOSE).ok));
check('close: every chain member is linted (S1 rubric tampered) → miss names the file', variant('member', C1, { [RUBRIC_PATH]: 'tampered\n' }, () => /^\(a\).*\[docs\/reviews\/M53\.G142\.S1\.R1\.md\]|^\(a\)/.test(lint(CLOSE).miss)));
check('close: no passing manifest at all → (c)', variant('noreview', S0, { 'tmp/worklogs/G300-x.md': WL.replace(/G142/g, 'G300') }, () => /^\(c\) no passing/.test(lint({ kind: 'close', goal: 300 }).miss)));

console.log(`\n${pass}/${n} pass`);
process.exit(fail ? 1 : 0);
