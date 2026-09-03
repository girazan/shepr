'use strict';
const fs = require('fs');
const path = require('path');
const { main } = require('../scripts/board-gh');
const SCRATCH = path.join(__dirname, 'scratch-board-gh');
fs.rmSync(SCRATCH, { recursive: true, force: true });
const CWD = path.join(SCRATCH, 'repo'), COMMON = path.join(SCRATCH, 'repo', '.git');
fs.mkdirSync(path.join(CWD, '.orch'), { recursive: true });
fs.mkdirSync(COMMON, { recursive: true });
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
const CFG = {
  owner: 'o', repo: 'r', projectOwner: 'o', ownerType: 'Organization', projectNumber: 1, projectId: 'PVT_1',
  fieldIds: { status: 'F_S', priority: 'F_R', pipeline: 'F_P', feature: null },
  optionIds: { status: { Todo: 's1', 'In progress': 's2', 'In review': 's3', Done: 's4' },
    priority: { Now: 'r1', Next: 'r2', Later: 'r3' }, pipeline: { Engine: 'p1' }, feature: {} },
};
function writeCfg(c) { fs.writeFileSync(path.join(CWD, '.orch', 'board.json'), JSON.stringify(c)); }
function fakeGh(handlers) {
  const calls = [];
  return { calls,
    graphql(q, v) { calls.push({ kind: 'graphql', q, v }); for (const [re, fn] of handlers) if (re.test(q)) return fn(v, q); throw new Error('unhandled graphql: ' + q.slice(0, 60)); },
    rest(m, p, b) { calls.push({ kind: 'rest', m, p, b }); for (const [re, fn] of handlers) if (re.test(m + ' ' + p)) return fn(b, m + ' ' + p); throw new Error('unhandled rest: ' + m + ' ' + p); },
  };
}
function run(argv, gh, extra = {}) {
  let out = '';
  const code = main(argv, { gh, cwd: CWD, commonDir: COMMON, stdout: s => { out += s; }, lockCfg: { __repoLocked: false }, ...extra });
  return { code, out };
}
const pi = (status, pipeline, priority) => ({ nodes: [{ project: { id: 'PVT_1' }, fieldValues: { nodes: [
  status ? { name: status, field: { name: 'Status' } } : null, pipeline ? { name: pipeline, field: { name: 'Pipeline' } } : null,
  priority ? { name: priority, field: { name: 'Priority' } } : null].filter(Boolean) } }] });

// --- no config → refuse -------------------------------------------------------
fs.rmSync(path.join(CWD, '.orch', 'board.json'), { force: true });
{ const r = run(['read'], fakeGh([])); check('read without board.json refuses with init hint', r.code === 1 && /orch:board init/.test(r.out)); }

// --- milestones ---------------------------------------------------------------
writeCfg(CFG);
{
  const gh = fakeGh([[/GET repos\/o\/r\/milestones/, () => [
    { number: 52, title: 'backlog', open_issues: 4, closed_issues: 25 },
    { number: 50, title: 'C2 Authoring tools ready', open_issues: 8, closed_issues: 2 },
    { number: 49, title: 'C1 SHU-HDS operable', open_issues: 60, closed_issues: 9 },
    { number: 30, title: 'v0.9.1', open_issues: 0, closed_issues: 7 } ]]]);
  const r = run(['milestones'], gh);
  const j = JSON.parse(r.out);
  check('milestones: C<n> numeric first, then backlog, then rest', j.map(c => c.number).join() === '49,50,52,30' && j[0].open === 60);
}

// --- read folds goal status -----------------------------------------------------
const GOALS = { repository: { issues: { nodes: [
  { number: 142, title: 'knowledge-gate', state: 'OPEN', updatedAt: '2026-09-01T00:00:00Z', body: 'BRIEF\ngoal: x',
    milestone: { number: 49, title: 'C1 SHU-HDS operable' }, labels: { nodes: [{ name: 'orch:goal' }] }, projectItems: pi('Todo'),
    subIssues: { nodes: [
      { number: 150, title: 'write grammar', state: 'OPEN', updatedAt: '2026-09-01T00:00:00Z', body: 'write grammar\n\noutcome: canonical home\n<!-- orch-item -->',
        labels: { nodes: [{ name: 'orch:item' }] }, assignees: { nodes: [] }, projectItems: pi('In progress', 'Engine', 'Now') },
      { number: 151, title: 'gate wired', state: 'OPEN', updatedAt: '2026-09-02T00:00:00Z', body: 'gate wired\n\ngate: GATE LIVE\n<!-- orch-item -->',
        labels: { nodes: [{ name: 'orch:item' }] }, assignees: { nodes: [] }, projectItems: pi('Todo', null, 'Next') },
      { number: 152, title: 'run /orch:setup', state: 'OPEN', updatedAt: '2026-09-02T00:00:00Z', body: 'run /orch:setup\n<!-- orch-item -->',
        labels: { nodes: [{ name: 'orch:item' }, { name: 'orch:you' }] }, assignees: { nodes: [{ login: 'me' }] }, projectItems: pi('Todo') } ] } },
  { number: 99, title: 'old goal', state: 'CLOSED', updatedAt: '2026-08-01T00:00:00Z', body: 'BRIEF', milestone: null,
    labels: { nodes: [{ name: 'orch:goal' }] }, projectItems: pi('Done'), subIssues: { nodes: [] } },
] } } };
{
  const gh = fakeGh([[/subIssues/, () => GOALS]]);
  const r = run(['read', '--json'], gh);
  const j = JSON.parse(r.out);
  check('read exits 0', r.code === 0);
  check('goal G142 in milestone 49 folds running', j.goals[0].lane === 'G142' && j.goals[0].milestone.number === 49 && j.goals[0].status === 'running' && j.goals[0].brief.startsWith('BRIEF'));
  check('items carry bucket(Priority)/pipeline/outcome/gate/you', j.goals[0].items[0].bucket === 'Now' && j.goals[0].items[0].pipeline === 'Engine' && j.goals[0].items[0].outcome === 'canonical home' && j.goals[0].items[1].bucket === 'Next' && j.goals[0].items[1].gate === 'GATE LIVE' && j.goals[0].items[2].you === true);
  check('unset Priority → first bucket', j.goals[0].items[2].bucket === 'Now');
  check('closed goal folds merged, null milestone sorts last', j.goals[1].lane === 'G99' && j.goals[1].status === 'merged' && j.goals[1].milestone === null);
  check('read makes exactly one graphql call', gh.calls.length === 1 && gh.calls[0].kind === 'graphql');
  check('--goal filters', JSON.parse(run(['read', '--json', '--goal', 'G99'], gh).out).goals.length === 1);
  check('buckets = Priority options in order', j.buckets.join() === 'Now,Next,Later');
}
{
  const blocked = JSON.parse(JSON.stringify(GOALS));
  blocked.repository.issues.nodes[0].subIssues.nodes[1].labels.nodes.push({ name: 'orch:blocked' });
  const gh = fakeGh([[/subIssues/, () => blocked],
    [/GET repos\/o\/r\/issues\/151\/comments/, () => [{ body: 'blocked: needs setup · owner: you\n<!-- opId:abc -->' }]]]);
  const j = JSON.parse(run(['read', '--json'], gh).out);
  check('blocked fold pulls blocker text from latest blocked: comment', j.goals[0].status === 'blocked' && j.goals[0].blocker === 'blocked: needs setup · owner: you');
}
module.exports = { check, run, fakeGh, writeCfg, CFG, CWD, COMMON, SCRATCH, finish() { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); } };
if (require.main === module) module.exports.finish();
