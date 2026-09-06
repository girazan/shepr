// shepr review: refusals, brief assembly, worktree lifecycle, slot/manifest
// grammar, board + roster side effects, the pathspec-limited commit, and
// round-trip through the evidence lint. GitHub is a fake; the reviewer is
// an injected function; the repo is real git.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const L = require('../hooks/lib/evidence-lint');
const { main, SANTA, REPLY } = require('../scripts/shepr-review');

const SCRATCH = path.join(__dirname, 'scratch-shepr-review');
const REPO = path.join(SCRATCH, 'repo');
const RUBRICS = path.join(SCRATCH, 'recipes');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(path.join(REPO, '.orch'), { recursive: true }); fs.mkdirSync(RUBRICS, { recursive: true });
const g = (...a) => execFileSync('git', ['-C', REPO, '-c', 'core.quotePath=false', ...a], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const git = a => g(...a);
g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'core.autocrlf', 'false');
const COMMON = g('rev-parse', '--git-common-dir').trim() === '.git' ? path.join(REPO, '.git') : g('rev-parse', '--git-common-dir').trim();
let pass = 0, fail = 0, n = 0;
function check(name, cond) { n++; if (cond) { pass++; console.log(`  ok ${n}. ${name}`); } else { fail++; console.log(`FAIL ${n}. ${name}`); } }
function commit(files, msg) { for (const [p, c] of Object.entries(files)) { const f = path.join(REPO, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c); } g('add', '-f', '-A'); g('commit', '-qm', msg); return g('rev-parse', 'HEAD').trim(); }

fs.writeFileSync(path.join(RUBRICS, 'review-goal.md'), 'REVIEW-GOAL RUBRIC\n');
fs.writeFileSync(path.join(RUBRICS, 'tdd.md'), 'TDD RUBRIC\n');
fs.writeFileSync(path.join(RUBRICS, 'spec.md'), 'SPEC RUBRIC\n');
const CONTRACT = { domains: { hmi: { paths: ['src/hmi/**'], decide: 'ai', ship: 'commit', tiers: { review: 'high' } }, core: { paths: ['src/core/**'], decide: 'ai', ship: 'commit', review: 'dual' } } };
const MODELS = { frontier: 'opus', high: 'opus', mid: 'sonnet', low: 'haiku', review: 'opus', 'review-alt': 'gpt' };
const cfgOf = (models = MODELS) => ({ contract: CONTRACT, models });
const BOARD = { owner: 'o', repo: 'r', projectOwner: 'o', ownerType: 'Organization', projectNumber: 1, projectId: 'PVT_1',
  fieldIds: { status: 'F_S', priority: 'F_R', pipeline: 'F_P', feature: 'F_F' },
  optionIds: { status: { Todo: 's1', 'In progress': 's2', 'In review': 's3', Done: 's4' }, priority: { Now: 'r1' }, pipeline: {}, feature: { hmi: 'f1', core: 'f2' } } };
fs.writeFileSync(path.join(REPO, '.orch', 'board.json'), JSON.stringify(BOARD));

// Minimal GitHub fake: one goal with two steps; set-status writes fields + a comment.
function fakeBoard(goalNumber, domains) {
  const st = { fields: {}, comments: {} };
  const pi = status => ({ nodes: [{ project: { id: 'PVT_1' }, fieldValues: { nodes: [{ name: status, field: { name: 'Status' } }] } }] });
  const item = (num, step, recipe) => ({ number: num, title: `step ${step}`, state: 'OPEN', updatedAt: 'now', body: `step ${step}\n\nstep: ${step}\naccept: it works\n${recipe ? `recipe: ${recipe}\n` : ''}<!-- orch-item -->`, labels: { nodes: [{ name: 'orch:item' }] }, assignees: { nodes: [] }, projectItems: pi(st.fields[`PI_I_${num}:F_S`] === 's3' ? 'In review' : 'In progress') });
  const goals = () => ({ repository: { issues: { nodes: [{ number: goalNumber, title: 'the goal', state: 'OPEN', updatedAt: 'now', body: `BRIEF\ngoal: make it\nmetric: m\ndone: d\ndomains: ${domains}\nfeature: hmi\nkill: k`, milestone: { number: 53, title: 'M53 · x' }, labels: { nodes: [{ name: 'orch:goal' }] }, projectItems: pi('Todo'), subIssues: { nodes: [item(151, 'S1', 'tdd'), item(152, 'S2', null)] } }] } } });
  const handlers = [
    [/subIssues/, goals],
    [/issue\(number/, v => ({ repository: { issue: { id: `I_${v.n}`, databaseId: v.n, state: 'OPEN', parent: { number: goalNumber }, projectItems: { nodes: [{ id: `PI_I_${v.n}`, project: { id: 'PVT_1' } }] } } } })],
    [/updateProjectV2ItemFieldValue/, v => { st.fields[`${v.i}:${v.f}`] = v.o; return { updateProjectV2ItemFieldValue: { projectV2Item: { id: v.i } } }; }],
    [/GET repos\/o\/r\/issues\/(\d+)\/comments/, (b, k) => st.comments[k.match(/issues\/(\d+)/)[1]] || []],
    [/POST repos\/o\/r\/issues\/(\d+)\/comments/, (b, k) => { const i = k.match(/issues\/(\d+)/)[1]; (st.comments[i] = st.comments[i] || []).push({ body: b.body }); return { id: 1 }; }],
  ];
  const gh = { graphql(q, v) { for (const [re, fn] of handlers) if (re.test(q)) return fn(v, q); throw new Error('unhandled graphql ' + q.slice(0, 40)); },
    rest(m, p, b) { for (const [re, fn] of handlers) if (re.test(m + ' ' + p)) return fn(b, m + ' ' + p); throw new Error('unhandled rest ' + m + ' ' + p); } };
  return { st, gh };
}
function run(argv, extra = {}) {
  let out = ''; const calls = [];
  const spawn = extra.spawn || (() => 'verdict: pass\nreasons:\n- done: met\nnotes:\n- fine\n');
  const code = main(argv, { cwd: REPO, commonDir: COMMON, stdout: s => { out += s; }, cfg: extra.cfg || cfgOf(), gh: extra.gh, spawn: a => { calls.push(a); return spawn(a); },
    testCmd: extra.testCmd || 'node -e "console.log(\'TESTS RAN\')"', rubricDir: RUBRICS, lockCfg: { __repoLocked: false }, sessionId: 'sess-1', ...extra.deps });
  return { code, out, calls };
}
const roster = () => { try { return JSON.parse(fs.readFileSync(path.join(COMMON, 'orch', 'fleet.json'), 'utf8')).delegates; } catch { return []; } };

// --- refusals --------------------------------------------------------------------------
const S0 = commit({ 'README.md': 'seed\n', 'src/hmi/a.js': '0\n' }, 'seed');
{ const { gh } = fakeBoard(142, 'hmi');
  check('usage: no goal', run([], { gh }).code === 1 && /usage/.test(run([], { gh }).out));
  check('usage: --step and --plan together', /usage/.test(run(['G142', '--step', 'S1', '--plan'], { gh }).out));
  check('no ROUTE line yet → refuses naming frozen BRIEF', /frozen BRIEF/.test(run(['G142', '--step', 'S1'], { gh }).out)); }
const WL = `BRIEF\ngoal: make it\nmetric: m\ndone: d\ndomains: hmi\nfeature: hmi\nkill: k\n\nROUTE: lane:G142 · hmi · decide:ai · ship:commit · tier:mid · base:${S0} · review:single · approved:auto · 2026-09-06\n`;
commit({ 'tmp/worklogs/G142-x.md': WL }, 'route');
fs.writeFileSync(path.join(REPO, 'src', 'hmi', 'a.js'), 'dirty\n');
{ const { gh } = fakeBoard(142, 'hmi'); const r = run(['G142', '--step', 'S1'], { gh });
  check('dirty tree under goal paths → refused before any range, names the file', r.code === 1 && /dirty tree under goal paths/.test(r.out) && /src\/hmi\/a\.js/.test(r.out) && !fs.existsSync(path.join(REPO, 'docs', 'reviews'))); }
fs.writeFileSync(path.join(REPO, 'src', 'hmi', 'a.js'), '0\n');
fs.writeFileSync(path.join(REPO, 'notes.txt'), 'untracked outside goal paths\n');
{ const { gh } = fakeBoard(142, 'hmi'); const r = run(['G142', '--step', 'S1'], { gh, cfg: cfgOf({ frontier: 'opus', high: 'opus', mid: 'sonnet', low: 'haiku' }) });
  check('models.review missing → refused', r.code === 1 && /models\.review/.test(r.out)); }
{ const { gh } = fakeBoard(142, 'hmi'); const r = run(['G142', '--step', 'S9'], { gh });
  check('unknown step → refused', r.code === 1 && /no step S9/.test(r.out)); }

// --- a passing single round ------------------------------------------------------------------
const D1 = commit({ 'src/hmi/a.js': '1\n', 'tmp/handoffs/M53.G142.S1-dev.md': 'HANDOFF S1\n' }, 'dev 1');
const RH = L.sha256('REVIEW-GOAL RUBRIC\n'), TH = L.sha256('TDD RUBRIC\n');
{
  const { st, gh } = fakeBoard(142, 'hmi');
  const r = run(['G142', '--step', 'S1'], { gh });
  const ID = 'M53.G142.S1.R1';
  const man = fs.readFileSync(path.join(REPO, 'docs', 'reviews', `${ID}.md`), 'utf8');
  check('exit 0, prints the id, verdict and manifest path', r.code === 0 && r.out.trim() === `${ID} pass → docs/reviews/${ID}.md`);
  check('manifest grammar exactly per §5', man === `review: ${ID}\ngoal: G142 · step: S1 · item: #151\nrubric: review-goal.md@${RH} + tdd.md@${TH}\nrange: ${S0}..${D1}\npaths: src/hmi/**\nslots: 1\nslot-1: ${ID}-1.md · opus · high · pass\nverdict: pass\n`);
  const slot = fs.readFileSync(path.join(REPO, 'docs', 'reviews', `${ID}-1.md`), 'utf8');
  check('slot file: same header, its own verdict line, reviewer body', slot.startsWith(`review: ${ID}\nrubric: review-goal.md@${RH} + tdd.md@${TH}\nrange: ${S0}..${D1}\npaths: src/hmi/**\nverdict: pass\n`) && /reasons:\n- done: met/.test(slot));
  check('rubric copies are content-addressed', fs.readFileSync(path.join(REPO, 'docs', 'reviews', 'rubrics', `review-goal.${RH}.md`), 'utf8') === 'REVIEW-GOAL RUBRIC\n' && fs.existsSync(path.join(REPO, 'docs', 'reviews', 'rubrics', `tdd.${TH}.md`)));
  const a = r.calls[0];
  check('one slot spawned with models.review, tier high, ORCH_ROLE=reviewer in the child env, cwd = the worktree', r.calls.length === 1 && a.model === 'opus' && a.tier === 'high' && a.env.ORCH_ROLE === 'reviewer' && a.cwd === path.join(COMMON, 'orch', 'wt', ID) && a.slot === 1);
  check('brief: rubric + diff + handoff + BRIEF + accept + test output + Santa lines', [ 'REVIEW-GOAL RUBRIC', 'TDD RUBRIC', '+1', 'HANDOFF S1', 'goal: make it', 'accept: it works', 'TESTS RAN', SANTA, REPLY ].every(s => a.brief.includes(s)) && /^range: /m.test(a.brief));
  check('brief diff is scoped to goal paths (worklog/handoff not in it)', !/tmp\/worklogs/.test(a.brief.split('DIFF')[1] || '') );
  check('worktree removed after the round', !fs.existsSync(path.join(COMMON, 'orch', 'wt', ID)) && !/orch\/wt/.test(g('worktree', 'list')));
  check('item set In review through board-gh (field + comment)', st.fields['PI_I_151:F_S'] === 's3' && st.comments[151].some(c => /status → In review/.test(c.body)));
  check('roster entry removed after the round', !roster().some(d => d.name === `review-${ID}`));
  const last = g('log', '-1', '--format=%s').trim(), files = g('show', '--name-only', '--format=', 'HEAD').split(/\r?\n/).filter(Boolean);
  check('evidence-only commit, pathspec-limited to docs/reviews', last === `review: ${ID} pass` && files.length === 4 && files.every(f => f.startsWith('docs/reviews/')));
  check('the untracked file outside goal paths was neither refused on nor committed', fs.existsSync(path.join(REPO, 'notes.txt')) && !files.includes('notes.txt'));
  check('the lint accepts what the script wrote (done G142 S1 #151)', L.lint({ git, contract: CONTRACT, models: MODELS, verb: { kind: 'done', goal: 142, step: 1, item: 151 } }).ok);
}
// --- second step chains from the first head; a fail round ----------------------------------------
const D2 = commit({ 'src/hmi/b.js': '2\n' }, 'dev 2');
{
  const { gh } = fakeBoard(142, 'hmi');
  const r = run(['G142', '--step', 'S2'], { gh, spawn: () => 'preamble\nverdict: fail\nreasons:\n- accept: not met\nnotes:\n' });
  const ID = 'M53.G142.S2.R1';
  const man = fs.readFileSync(path.join(REPO, 'docs', 'reviews', `${ID}.md`), 'utf8');
  check('fail round: exit 1, base = previous passing head, no tdd rubric (step has no recipe)', r.code === 1 && man.includes(`range: ${D1}..${D2}\n`) && man.includes(`rubric: review-goal.md@${RH}\n`) && man.endsWith('verdict: fail\n'));
  check('fail round: slot file drops the reviewer\'s own verdict line, keeps its body', /^verdict: fail\npreamble\nreasons:/m.test(fs.readFileSync(path.join(REPO, 'docs', 'reviews', `${ID}-1.md`), 'utf8')));
  check('lint: done S2 on a fail manifest → (e)', /^\(e\)/.test(L.lint({ git, contract: CONTRACT, models: MODELS, verb: { kind: 'done', goal: 142, step: 2, item: 152 } }).miss));
  // The fail round's own evidence commit just advanced HEAD past D2, so the
  // re-run's head is that evidence commit, not D2 literally — base stays D1.
  const headAfterFail = g('rev-parse', 'HEAD').trim();
  const r2 = run(['G142', '--step', 'S2'], { gh });
  check('next round numbers R2 on the same base', r2.code === 0 && fs.readFileSync(path.join(REPO, 'docs', 'reviews', 'M53.G142.S2.R2.md'), 'utf8').includes(`range: ${D1}..${headAfterFail}\n`));
  check('lint: done S2 → ok after R2 pass', L.lint({ git, contract: CONTRACT, models: MODELS, verb: { kind: 'done', goal: 142, step: 2, item: 152 } }).ok);
}
// --- dual: refusal without review-alt; a missing slot is inconclusive ---------------------------
const S1b = commit({ 'src/core/c.js': '0\n' }, 'seed core');
const WLD = `BRIEF\ngoal: dual\nmetric: m\ndone: d\ndomains: hmi core\nfeature: core\nkill: k\n\nROUTE: lane:G200 · core · decide:ai · ship:commit · tier:mid · base:${S1b} · review:dual · approved:auto · 2026-09-06\n`;
commit({ 'tmp/worklogs/G200-d.md': WLD }, 'route dual');
const D3 = commit({ 'src/core/c.js': '1\n' }, 'dev core');
{
  const { gh } = fakeBoard(200, 'hmi core');
  const r = run(['G200', '--step', 'S1'], { gh, cfg: cfgOf({ ...MODELS, 'review-alt': undefined }) });
  check('dual without models.review-alt → refused before spawning, nothing written', r.code === 1 && /review-alt/.test(r.out) && r.calls.length === 0 && !fs.existsSync(path.join(REPO, 'docs', 'reviews', 'M53.G200.S1.R1.md')));
  const r2 = run(['G200', '--step', 'S1'], { gh, spawn: a => { if (a.slot === 2) throw new Error('spawn failed'); return 'verdict: pass\nreasons:\nnotes:\n'; } });
  const man = fs.readFileSync(path.join(REPO, 'docs', 'reviews', 'M53.G200.S1.R1.md'), 'utf8');
  check('dual: slot 2 uses review-alt; a failed spawn is `missing`; verdict inconclusive; exit 3', r2.code === 3 && r2.calls[1].model === 'gpt' && man.includes('slots: 2\n') && /^slot-2: M53\.G200\.S1\.R1-2\.md · gpt · high · missing$/m.test(man) && man.endsWith('verdict: inconclusive\n') && !fs.existsSync(path.join(REPO, 'docs', 'reviews', 'M53.G200.S1.R1-2.md')));
  check('dual paths: union of both domains, sorted', man.includes('paths: src/core/** src/hmi/**\n'));
  // The inconclusive round's own evidence commit just advanced HEAD past D3.
  const headAfterInconclusive = g('rev-parse', 'HEAD').trim();
  const r3 = run(['G200', '--step', 'S1'], { gh, spawn: a => (a.slot === 2 ? 'verdict: pass\nreasons:\nnotes:\n' : 'verdict: pass\nreasons:\nnotes:\n') });
  check('re-run after inconclusive is R2 on the same base (the latest passing manifest did not change)', r3.code === 0 && fs.readFileSync(path.join(REPO, 'docs', 'reviews', 'M53.G200.S1.R2.md'), 'utf8').includes(`range: ${S1b}..${headAfterInconclusive}\n`));
  check('lint accepts the dual round', L.lint({ git, contract: CONTRACT, models: MODELS, verb: { kind: 'done', goal: 200, step: 1, item: 151 } }).ok);
}
// --- plan round ---------------------------------------------------------------------------------
{
  const { st, gh } = fakeBoard(142, 'hmi');
  const r = run(['G142', '--plan'], { gh });
  const man = fs.readFileSync(path.join(REPO, 'docs', 'reviews', 'M53.G142.P.R1.md'), 'utf8');
  check('plan round: P.R1, range base..base, no paths line, item -, spec rubric', r.code === 0 && man.includes(`range: ${S0}..${S0}\n`) && !/^paths:/m.test(man) && man.includes('goal: G142 · step: P · item: -\n') && man.includes(`spec.md@${L.sha256('SPEC RUBRIC\n')}`));
  check('plan round: brief carries the plan section (worklog at HEAD), not a diff', r.calls[0].brief.includes('ROUTE: lane:G142') && !/^## DIFF/m.test(r.calls[0].brief));
  check('plan round: no item status change', !st.fields['PI_I_151:F_S']);
  check('plan manifests never enter the lint chain', L.lint({ git, contract: CONTRACT, models: MODELS, verb: { kind: 'done', goal: 142, step: 2, item: 152 } }).ok);
}
console.log(`\n${pass}/${n} pass`);
process.exit(fail ? 1 : 0);
