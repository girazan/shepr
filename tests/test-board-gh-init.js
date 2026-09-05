'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { main } = require('../scripts/board-gh');
const SCRATCH = path.join(__dirname, 'scratch-board-init');
fs.rmSync(SCRATCH, { recursive: true, force: true });
const CWD = path.join(SCRATCH, 'repo');
fs.mkdirSync(path.join(CWD, '.claude'), { recursive: true });
execFileSync('git', ['-C', CWD, 'init', '-q']);
execFileSync('git', ['-C', CWD, 'remote', 'add', 'origin', 'https://github.com/istart-dev/orch.git']);
fs.writeFileSync(path.join(CWD, '.claude', 'orch.json'), JSON.stringify({ contract: { domains: { numerics: { paths: [], decide: 'ai', ship: 'commit' }, hmi: { paths: [], decide: 'human', ship: 'none' } } } }));
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
function fakeGh(state) {
  const calls = [];
  return { calls,
    graphql(q, v) {
      calls.push({ q, v });
      if (/repositoryOwner/.test(q)) return { repositoryOwner: { id: 'OWN', __typename: 'Organization', projectsV2: { nodes: state.projects } } };
      if (/createProjectV2\(/.test(q)) { const p = { id: 'PVT_new', number: 9, title: v.t }; state.projects.push(p); return { createProjectV2: { projectV2: p } }; }
      if (/fields\(first/.test(q)) return { node: { fields: { nodes: state.fields } } };
      if (/updateProjectV2Field/.test(q)) { const f = state.fields.find(x => x.id === v.f); f.options = v.opts.map((o, i) => ({ id: f.id + i, name: o.name, color: o.color, description: o.description })); return { updateProjectV2Field: { projectV2Field: f } }; }
      if (/createProjectV2Field/.test(q)) { const f = { id: 'F_' + v.name, name: v.name, options: v.opts.map((o, i) => ({ id: v.name.toLowerCase() + i, name: o.name })) }; state.fields.push(f); return { createProjectV2Field: { projectV2Field: f } }; }
      throw new Error('unhandled ' + q.slice(0, 50));
    },
    rest(m, p, b) {
      calls.push({ m, p, b });
      if (m === 'GET' && /labels/.test(p)) return state.labels.map(nm => ({ name: nm }));
      if (m === 'POST' && /labels/.test(p)) { state.labels.push(b.name); return { name: b.name }; }
      throw new Error('unhandled ' + m + ' ' + p);
    } };
}
function run(argv, gh, extra = {}) { let out = ''; const code = main(argv, { gh, cwd: CWD, commonDir: path.join(CWD, '.git'), stdout: s => { out += s; }, lockCfg: { __repoLocked: false }, env: {}, ...extra }); return { code, out }; }
const CFGP = path.join(CWD, '.orch', 'board.json');
const ALL_LABELS = ['orch:goal', 'orch:item', 'orch:you', 'orch:blocked', 'orch:needs_attention'];
const STATUS4 = () => ['Todo', 'In progress', 'In review', 'Done'].map((nm, i) => ({ id: 's' + i, name: nm }));
const noMut = gh => !gh.calls.some(c => /create|update/.test(c.q || '') || c.m === 'POST');

// Fresh repo, nothing exists → create project, Priority, Pipeline, labels.
{
  const st = { projects: [], fields: [{ id: 'F_S', name: 'Status', options: [{ id: 'a', name: 'Todo', color: 'GREEN', description: 'd' }, { id: 'b', name: 'In Progress' }, { id: 'c', name: 'Done' }] }], labels: [] };
  const gh = fakeGh(st);
  const r = run(['init'], gh);
  check('init exits 0', r.code === 0);
  const cfg = JSON.parse(fs.readFileSync(CFGP, 'utf8'));
  check('project created and recorded', cfg.projectId === 'PVT_new' && cfg.projectNumber === 9 && cfg.owner === 'istart-dev' && cfg.repo === 'orch');
  check('Status gained In review, kept existing', st.fields[0].options.map(o => o.name).join() === 'Todo,In Progress,Done,In review');
  check('Priority created with Now/Next/Later when absent', st.fields.some(f => f.name === 'Priority' && f.options.map(o => o.name).join() === 'Now,Next,Later'));
  check('Pipeline created from contract domains when absent', st.fields.some(f => f.name === 'Pipeline' && f.options.map(o => o.name).join() === 'numerics,hmi'));
  check('optionIds recorded: canonical status names, priority, pipeline; feature null', cfg.optionIds.status['In review'] === 'F_S3' && cfg.optionIds.status['In progress'] === 'F_S1' && cfg.optionIds.priority.Now && cfg.optionIds.pipeline.numerics && cfg.fieldIds.feature === null);
  check('orch labels created (five, no bucket labels)', ALL_LABELS.every(l => st.labels.includes(l)) && !st.labels.some(l => l.startsWith('orch:bucket')));
  check('no milestone call ever', !gh.calls.some(c => /milestones/.test(c.p || '')));
  check('existing Status option colors preserved when adding In review', st.fields[0].options.find(o => o.name === 'Todo').color === 'GREEN' && st.fields[0].options.find(o => o.name === 'Todo').description === 'd');
}
// Adopt Pertasim-shaped project: everything present, P0/P1/P2 renamed by the operator already.
{
  const st = { projects: [{ id: 'PVT_pert', number: 1, title: 'Pertasim' }],
    fields: [{ id: 'F_S', name: 'Status', options: STATUS4() },
      { id: 'F_R', name: 'Priority', options: [{ id: 'r0', name: 'Now' }, { id: 'r1', name: 'Next' }, { id: 'r2', name: 'Later' }] },
      { id: 'F_P', name: 'Pipeline', options: [{ id: 'p0', name: 'Authoring' }, { id: 'p1', name: 'Engine' }] },
      { id: 'F_F', name: 'Feature', options: [{ id: 'f0', name: 'E· Numerics core' }] }],
    labels: ALL_LABELS.slice() };
  const gh = fakeGh(st);
  const r = run(['init', '--project', '1'], gh);
  check('adopt --project 1 exits 0', r.code === 0);
  const cfg = JSON.parse(fs.readFileSync(CFGP, 'utf8'));
  check('adopted project recorded, no creation', cfg.projectId === 'PVT_pert' && cfg.projectNumber === 1 && noMut(gh));
  check('Priority options read as-is (buckets Now,Next,Later)', Object.keys(cfg.optionIds.priority).join() === 'Now,Next,Later' && cfg.fieldIds.priority === 'F_R');
  check('Pipeline NOT modified from contract domains', st.fields[2].options.map(o => o.name).join() === 'Authoring,Engine' && cfg.optionIds.pipeline.Engine === 'p1');
  check('Feature recorded', cfg.fieldIds.feature === 'F_F' && cfg.optionIds.feature['E· Numerics core'] === 'f0');
  check('idempotent second run issues no mutations', run(['init', '--project', '1'], gh).code === 0 && noMut(gh));
}
// Adopt with un-renamed P0/P1/P2 → still works, buckets are whatever the options are.
{
  const st = { projects: [{ id: 'PVT_pert', number: 1, title: 'Pertasim' }],
    fields: [{ id: 'F_S', name: 'Status', options: STATUS4() }, { id: 'F_R', name: 'Priority', options: [{ id: 'r0', name: 'P0' }, { id: 'r1', name: 'P1' }, { id: 'r2', name: 'P2' }] }, { id: 'F_P', name: 'Pipeline', options: [{ id: 'p0', name: 'Authoring' }, { id: 'p1', name: 'Engine' }] }], labels: ALL_LABELS.slice() };
  const gh = fakeGh(st);
  run(['init', '--project', '1'], gh);
  check('un-renamed Priority is used verbatim, never renamed', Object.keys(JSON.parse(fs.readFileSync(CFGP, 'utf8')).optionIds.priority).join() === 'P0,P1,P2' && noMut(gh));
}
// Adopt with Status missing a canonical option → hard stop, no mutation.
{
  fs.rmSync(CFGP, { force: true });
  const st = { projects: [{ id: 'PVT_pert', number: 1, title: 'Pertasim' }],
    fields: [{ id: 'F_S', name: 'Status', options: [{ id: 's0', name: 'Todo' }, { id: 's1', name: 'In progress' }, { id: 's2', name: 'Done' }] },
      { id: 'F_R', name: 'Priority', options: [{ id: 'r0', name: 'Now' }, { id: 'r1', name: 'Next' }, { id: 'r2', name: 'Later' }] }],
    labels: ALL_LABELS.slice() };
  const gh = fakeGh(st);
  const r = run(['init', '--project', '1'], gh);
  check('adopt with Status missing In review → exit 1', r.code === 1);
  check('message names the project and missing option', /Status field on project #1 is missing option\(s\): In review/.test(r.out));
  check('no mutation on missing-option stop', noMut(gh));
  check('no config written', !fs.existsSync(CFGP));
  // same, but --dry-run — still a hard stop, not a silent add.
  const r2 = run(['init', '--project', '1', '--dry-run'], fakeGh(st));
  check('adopt dry-run with Status missing option → exit 1 too', r2.code === 1 && /missing option\(s\): In review/.test(r2.out));
}
// --project that doesn't exist → refuse.
{
  const st = { projects: [], fields: [], labels: [] };
  const r = run(['init', '--project', '77'], fakeGh(st));
  check('unknown --project refuses', r.code === 1 && /no project #77/.test(r.out));
}
// Dry run writes nothing.
{
  fs.rmSync(CFGP, { force: true });
  const st = { projects: [], fields: [{ id: 'F_S', name: 'Status', options: [] }], labels: [] };
  const gh = fakeGh(st);
  const r = run(['init', '--dry-run'], gh);
  check('dry-run prints DRY lines', /DRY create project/.test(r.out) && /DRY create Priority/.test(r.out));
  check('dry-run writes no config and no mutations', !fs.existsSync(CFGP) && noMut(gh));
}
// Empty Priority field → error even on dry-run.
{
  fs.rmSync(CFGP, { force: true });
  const st = { projects: [{ id: 'PVT_bad', number: 2, title: 'BadProject' }],
    fields: [{ id: 'F_S', name: 'Status', options: [{ id: 's0', name: 'Todo' }, { id: 's1', name: 'In progress' }, { id: 's2', name: 'In review' }, { id: 's3', name: 'Done' }] },
      { id: 'F_R', name: 'Priority', options: [] }],
    labels: ALL_LABELS.slice() };
  const gh = fakeGh(st);
  const r = run(['init', '--project', '2', '--dry-run'], gh);
  check('dry-run detects empty Priority field', r.code === 1 && /no options/.test(r.out));
  check('dry-run with empty Priority writes no config', !fs.existsSync(CFGP));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
