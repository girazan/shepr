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
  fieldIds: { status: 'F_S', priority: 'F_R', pipeline: 'F_P', feature: 'F_F' },
  optionIds: { status: { Todo: 's1', 'In progress': 's2', 'In review': 's3', Done: 's4' },
    priority: { Now: 'r1', Next: 'r2', Later: 'r3' }, pipeline: { Engine: 'p1' }, feature: { numerics: 'f1', hmi: 'f2' } },
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
  const code = main(argv, { gh, cwd: CWD, commonDir: COMMON, stdout: s => { out += s; }, lockCfg: { __repoLocked: false }, verify: () => ({ ok: true }), env: {}, ...extra });
  return { code, out };
}
const pi = (status, pipeline, priority, feature) => ({ nodes: [{ project: { id: 'PVT_1' }, fieldValues: { nodes: [
  status ? { name: status, field: { name: 'Status' } } : null, pipeline ? { name: pipeline, field: { name: 'Pipeline' } } : null,
  priority ? { name: priority, field: { name: 'Priority' } } : null, feature ? { name: feature, field: { name: 'Feature' } } : null].filter(Boolean) } }] });

// --- no config → refuse -------------------------------------------------------
fs.rmSync(path.join(CWD, '.orch', 'board.json'), { force: true });
{ const r = run(['read'], fakeGh([])); check('read without board.json refuses with init hint', r.code === 1 && /shepr:board init/.test(r.out)); }

// --- milestones ---------------------------------------------------------------
writeCfg(CFG);
{
  const gh = fakeGh([[/GET repos\/o\/r\/milestones\?state=open/, () => [
    { number: 52, title: 'backlog', open_issues: 4, closed_issues: 25 },
    { number: 50, title: 'C2 Authoring tools ready', open_issues: 8, closed_issues: 2 },
    { number: 55, title: 'M3 · October target', open_issues: 1, closed_issues: 0 },
    { number: 49, title: 'C1 SHU-HDS operable', open_issues: 60, closed_issues: 9 },
    { number: 30, title: 'v0.9.1', open_issues: 0, closed_issues: 7 } ]]]);
  const j = JSON.parse(run(['milestones'], gh).out);
  check('milestones: M<n>/C<n> numeric first, then backlog, then rest', j.map(c => c.number).join() === '49,50,55,52,30' && j[0].open === 60);
  const { milestoneRank } = require('../scripts/board-gh');
  check('milestoneRank: M3 → 3, C2 → 2, backlog → 1e6, other → 1e7',
    milestoneRank('M3 · October target') === 3 && milestoneRank('C2 Authoring') === 2 && milestoneRank('backlog') === 1e6 && milestoneRank('v0.9.1') === 1e7);
}

// --- read folds goal status -----------------------------------------------------
const GOALS = { repository: { issues: { nodes: [
  { number: 142, title: 'knowledge-gate', state: 'OPEN', updatedAt: '2026-09-01T00:00:00Z', body: 'BRIEF\ngoal: x',
    milestone: { number: 49, title: 'C1 SHU-HDS operable' }, labels: { nodes: [{ name: 'orch:goal' }] }, projectItems: pi('Todo', null, 'Next', 'hmi'),
    subIssues: { nodes: [
      { number: 150, title: 'write grammar', state: 'OPEN', updatedAt: '2026-09-01T00:00:00Z', body: 'write grammar\n\nstep: S1\noutcome: canonical home\naccept: grammar test names the file\nrecipe: tdd\n<!-- orch-item -->',
        labels: { nodes: [{ name: 'orch:item' }] }, assignees: { nodes: [] }, projectItems: pi('In progress', 'Engine', 'Now') },
      { number: 151, title: 'gate wired', state: 'OPEN', updatedAt: '2026-09-02T00:00:00Z', body: 'gate wired\n\nstep: S2\ngate: GATE LIVE\n<!-- orch-item -->',
        labels: { nodes: [{ name: 'orch:item' }] }, assignees: { nodes: [] }, projectItems: pi('Todo', null, 'Next') },
      { number: 152, title: 'run /shepr:setup', state: 'OPEN', updatedAt: '2026-09-02T00:00:00Z', body: 'run /shepr:setup\n\nstep: S3\n<!-- orch-item -->',
        labels: { nodes: [{ name: 'orch:item' }, { name: 'orch:you' }] }, assignees: { nodes: [{ login: 'me' }] }, projectItems: pi('Todo') } ] } },
  { number: 143, title: 'second goal', state: 'OPEN', updatedAt: '2026-09-01T00:00:00Z', body: 'BRIEF\ngoal: y',
    milestone: { number: 49, title: 'C1 SHU-HDS operable' }, labels: { nodes: [{ name: 'orch:goal' }] }, projectItems: pi('Todo', null, 'Now'),
    subIssues: { nodes: [] } },
  { number: 99, title: 'old goal', state: 'CLOSED', updatedAt: '2026-08-01T00:00:00Z', body: 'BRIEF', milestone: null,
    labels: { nodes: [{ name: 'orch:goal' }] }, projectItems: pi('Done'), subIssues: { nodes: [] } },
] } } };
{
  const gh = fakeGh([[/subIssues/, () => GOALS]]);
  const r = run(['read', '--json'], gh);
  const j = JSON.parse(r.out);
  check('read exits 0', r.code === 0);
  const g142 = j.goals.find(g => g.lane === 'G142'), g99 = j.goals.find(g => g.lane === 'G99');
  check('goal G142 in milestone 49 folds running', g142.milestone.number === 49 && g142.status === 'running' && g142.brief.startsWith('BRIEF'));
  check('items carry bucket(Priority)/pipeline/outcome/gate/you', g142.items[0].bucket === 'Now' && g142.items[0].pipeline === 'Engine' && g142.items[0].outcome === 'canonical home' && g142.items[1].bucket === 'Next' && g142.items[1].gate === 'GATE LIVE' && g142.items[2].you === true && g142.items[0].step === 'S1' && g142.items[2].step === 'S3' && g142.items[0].accept === 'grammar test names the file' && g142.items[0].recipe === 'tdd');
  check('unset Priority → first bucket', g142.items[2].bucket === 'Now');
  check('closed goal folds merged, null milestone sorts last', g99.status === 'merged' && g99.milestone === null && j.goals[j.goals.length - 1].lane === 'G99');
  check('read makes exactly one graphql call', gh.calls.length === 1 && gh.calls[0].kind === 'graphql');
  check('--goal filters', JSON.parse(run(['read', '--json', '--goal', 'G99'], gh).out).goals.length === 1);
  check('buckets = Priority options in order', j.buckets.join() === 'Now,Next,Later');
  check('goals sort Priority-first across milestones, then milestone, then issue', j.goals.map(g => g.lane).join() === 'G143,G142,G99');
  check('goal carries bucket and feature', g142.bucket === 'Next' && g142.feature === 'hmi' && j.goals.find(g => g.lane === 'G143').feature === null);
}
{
  const two = JSON.parse(JSON.stringify(GOALS));
  two.repository.issues.nodes[0].milestone = { number: 60, title: 'M2 · later' }; // G142 (Next) moves to a higher milestone
  two.repository.issues.nodes[1].milestone = { number: 49, title: 'C1 SHU-HDS operable' };
  two.repository.issues.nodes[1].projectItems = pi('Todo', null, 'Next'); // G143 becomes Next too
  const j = JSON.parse(run(['read', '--json'], fakeGh([[/subIssues/, () => two]])).out);
  check('same bucket → lower milestone first', j.goals.map(g => g.lane).slice(0, 2).join() === 'G143,G142');
  two.repository.issues.nodes[0].projectItems = pi('Todo', null, 'Now', 'hmi'); // G142 Now under M2 beats G143 Next under C1
  const j2 = JSON.parse(run(['read', '--json'], fakeGh([[/subIssues/, () => two]])).out);
  check('Now under a later milestone beats Next under an earlier one', j2.goals.map(g => g.lane).slice(0, 2).join() === 'G142,G143');
}
{
  const blocked = JSON.parse(JSON.stringify(GOALS));
  blocked.repository.issues.nodes[0].subIssues.nodes[1].labels.nodes.push({ name: 'orch:blocked' });
  const gh = fakeGh([[/subIssues/, () => blocked],
    [/GET repos\/o\/r\/issues\/151\/comments/, () => [{ body: 'blocked: needs setup · owner: you\n<!-- opId:abc -->' }]]]);
  const j = JSON.parse(run(['read', '--json'], gh).out);
  const gb = j.goals.find(g => g.lane === 'G142');
  check('blocked fold pulls blocker text from latest blocked: comment', gb.status === 'blocked' && gb.blocker === 'blocked: needs setup · owner: you');
}
// --- write verbs -----------------------------------------------------------------
const JOURNAL = path.join(COMMON, 'orch', 'board-journal.jsonl');
const BRIEF = path.join(SCRATCH, 'brief.md');
fs.writeFileSync(BRIEF, 'BRIEF\ngoal: learn from ships\nmetric: lessons/ship\ndone: gate live\ndomains: numerics\nfeature: numerics\nkill: 3 sessions\n');
function ghStore() {
  const st = { milestones: [{ number: 49, title: 'C1 SHU-HDS operable', description: '', state: 'open', open_issues: 0, closed_issues: 0 }, { number: 52, title: 'backlog', description: '', state: 'open', open_issues: 0, closed_issues: 0 }],
    issues: {}, comments: {}, items: {}, fields: {}, parent: {}, next: 140, fail: null, extraGoalsInMilestone: 0, swapGoalInMilestone: false };
  const FIELD = { F_S: ['status', 'Status'], F_R: ['priority', 'Priority'], F_P: ['pipeline', 'Pipeline'], F_F: ['feature', 'Feature'] };
  const optName = (fid, oid) => Object.entries(CFG.optionIds[FIELD[fid][0]]).find(([, id]) => id === oid)[0];
  const fv = i => st.items[i.node_id] ? [{ project: { id: 'PVT_1' }, fieldValues: { nodes: Object.entries(st.fields).filter(([k]) => k.startsWith(st.items[i.node_id] + ':')).map(([k, o]) => { const fid = k.split(':')[1]; return { name: optName(fid, o), field: { name: FIELD[fid][1] } }; }) } }] : [];
  const node = i => ({ number: i.number, title: i.title, body: i.body, state: i.state.toUpperCase(), updatedAt: 'now', milestone: i.milestone ? st.milestones.find(m => m.number === i.milestone) : null,
    labels: { nodes: i.labels }, assignees: { nodes: (i.assignees || []).map(login => ({ login })) }, projectItems: { nodes: fv(i) } });
  const handlers = [
    [/GET repos\/o\/r\/milestones\?state=(open|all)/, (b, k) => { const s = k.match(/state=(\w+)/)[1]; const page = Number((k.match(/[?&]page=(\d+)/) || [])[1] || 1); return st.milestones.filter(m => s === 'all' || m.state === s).slice((page - 1) * 100, page * 100); }],
    [/POST repos\/o\/r\/milestones$/, b => { const m = { number: Math.max(52, ...st.milestones.map(m => m.number)) + 1, state: 'open', open_issues: 0, closed_issues: 0, ...b }; st.milestones.push(m); return m; }],
    [/PATCH repos\/o\/r\/milestones\/(\d+)/, (b, k) => { const m = st.milestones.find(m => m.number === Number(k.match(/milestones\/(\d+)/)[1])); Object.assign(m, b); return m; }],
    [/GET user$/, () => ({ login: 'me' })],
    [/GET repos\/o\/r\/issues\?milestone=(\d+)&labels=orch:goal/, (b, k) => { const ms = Number(k.match(/milestone=(\d+)/)[1]); const real = Object.values(st.issues).filter(i => i.milestone === ms && i.labels.some(x => x.name === 'orch:goal')); const n = st.extraGoalsInMilestone; if (st.swapGoalInMilestone) return real.map((i, k) => k === 0 ? { number: 9100, labels: i.labels } : i); return n < 0 ? real.slice(0, real.length + n) : real.concat(Array.from({ length: n }, (_, i) => ({ number: 9000 + i, labels: [{ name: 'orch:goal' }] }))); }],
    [/GET repos\/o\/r\/issues\/(\d+)\/sub_issues/, (b, k) => { const p = Number(k.match(/issues\/(\d+)/)[1]); return Object.values(st.issues).filter(c => st.parent[c.number] === p).map(c => ({ number: c.number, body: c.body, state: c.state })); }],
    // identity probe: all shepr issues with the given label, newest first
    [/GET repos\/o\/r\/issues\?/, (b, k) => { const l = decodeURIComponent(k.match(/labels=([^&]*)/)[1]);
      return Object.values(st.issues).filter(i => i.labels.some(x => x.name === l)).sort((a, c) => c.number - a.number); }],
    [/POST repos\/o\/r\/issues$/, b => { const n = st.next++; st.issues[n] = { number: n, id: 1000 + n, node_id: 'I_' + n, state: 'open', ...b, labels: (b.labels || []).map(x => ({ name: x })) }; return st.issues[n]; }],
    [/GET repos\/o\/r\/issues\/(\d+)\/comments/, (b, k) => st.comments[k.match(/issues\/(\d+)/)[1]] || []],
    [/POST repos\/o\/r\/issues\/(\d+)\/comments/, (b, k) => { const n = k.match(/issues\/(\d+)/)[1]; (st.comments[n] = st.comments[n] || []).push({ body: b.body }); return { id: 1 }; }],
    [/POST repos\/o\/r\/issues\/(\d+)\/sub_issues/, (b, k) => { const p = Number(k.match(/issues\/(\d+)/)[1]); const child = Object.values(st.issues).find(i => i.id === b.sub_issue_id); st.parent[child.number] = p; return {}; }],
    [/POST repos\/o\/r\/issues\/(\d+)\/labels/, (b, k) => { const i = st.issues[k.match(/issues\/(\d+)/)[1]]; for (const l of b.labels) if (!i.labels.some(x => x.name === l)) i.labels.push({ name: l }); return i.labels; }],
    [/DELETE repos\/o\/r\/issues\/(\d+)\/labels\/(.+)/, (b, k) => { const m = k.match(/issues\/(\d+)\/labels\/(.+)$/); const i = st.issues[m[1]]; i.labels = i.labels.filter(x => x.name !== decodeURIComponent(m[2])); return null; }],
    [/GET repos\/o\/r\/issues\/(\d+)$/, (b, k) => st.issues[k.match(/issues\/(\d+)/)[1]]],
    [/PATCH repos\/o\/r\/issues\/(\d+)/, (b, k) => { const i = st.issues[k.match(/issues\/(\d+)/)[1]]; Object.assign(i, b); return i; }],
    [/issue\(number/, v => { const i = st.issues[v.n]; return { repository: { issue: { id: i.node_id, databaseId: i.id, state: i.state.toUpperCase(), parent: st.parent[i.number] ? { number: st.parent[i.number] } : null, projectItems: { nodes: st.items[i.node_id] ? [{ id: st.items[i.node_id], project: { id: 'PVT_1' } }] : [] } } } }; }],
    [/addProjectV2ItemById/, v => { st.items[v.c] = 'PI_' + v.c; return { addProjectV2ItemById: { item: { id: st.items[v.c] } } }; }],
    [/updateProjectV2ItemFieldValue/, v => { st.fields[v.i + ':' + v.f] = v.o; return { updateProjectV2ItemFieldValue: { projectV2Item: { id: v.i } } }; }],
    [/subIssues/, () => ({ repository: { issues: { nodes: Object.values(st.issues).filter(i => i.labels.some(l => l.name === 'orch:goal')).map(g => ({ ...node(g),
      subIssues: { nodes: Object.values(st.issues).filter(c => st.parent[c.number] === g.number).map(node) } })) } } })],
  ];
  const gh = fakeGh(handlers);
  const g = gh.graphql, r = gh.rest;
  gh.graphql = (q, v) => { if (st.fail && st.fail(q)) throw new Error('simulated outage'); return g(q, v); };
  gh.rest = (m, p, b) => { if (st.fail && st.fail(m + ' ' + p)) throw new Error('simulated outage'); return r(m, p, b); };
  return { st, gh };
}
fs.rmSync(JOURNAL, { force: true });
writeCfg(CFG);
{
  const { st, gh } = ghStore();
  let r = run(['add-goal', '49', 'knowledge-gate', '--brief', BRIEF], gh);
  check('add-goal creates orch:goal issue in milestone, BRIEF body, prints G<n>', r.code === 0 && r.out.trim() === 'G140' && st.issues[140].milestone === 49 && st.issues[140].body.startsWith('BRIEF') && st.issues[140].labels.some(l => l.name === 'orch:goal'));
  check('goal on project with Status Todo', st.items['I_140'] && st.fields['PI_I_140:F_S'] === 's1');
  r = run(['add-goal', 'backlog', 'someday', '--brief', BRIEF], gh);
  check('backlog resolves to the backlog milestone', st.issues[141].milestone === 52);
  r = run(['add-goal', 'nope', 'x', '--brief', BRIEF], gh);
  check('unknown milestone refused', r.code === 1 && /milestone/.test(r.out));
  r = run(['add-item', 'G140', 'write grammar', '--pipeline', 'Engine', '--outcome', 'canonical home'], gh);
  const n1 = Number(r.out.trim());
  check('add-item: sub-issue of goal, same milestone, marker + orch:item', r.code === 0 && st.parent[n1] === 140 && st.issues[n1].milestone === 49 && /<!-- orch-item -->$/.test(st.issues[n1].body) && st.issues[n1].labels.some(l => l.name === 'orch:item'));
  check('add-item on project: Status Todo, Priority = first bucket (Now), Pipeline set', st.fields['PI_I_' + n1 + ':F_S'] === 's1' && st.fields['PI_I_' + n1 + ':F_R'] === 'r1' && st.fields['PI_I_' + n1 + ':F_P'] === 'p1');
  r = run(['add-item', 'G140', 'grammar tests', '--bucket', 'Next', '--gate', 'GATE LIVE'], gh);
  const n2 = Number(r.out.trim());
  check('--bucket Next → Priority option r2; --gate in body', st.fields['PI_I_' + n2 + ':F_R'] === 'r2' && /\ngate: GATE LIVE\n/.test(st.issues[n2].body) && !st.issues[n2].labels.some(l => l.name.startsWith('orch:bucket')));
  r = run(['add-item', 'G140', 'x', '--bucket', 'Someday'], gh);
  check('unknown bucket refused, lists valid options', r.code === 1 && /Now, Next, Later/.test(r.out));
  r = run(['add-item', 'G140', 'x', '--bucket'], gh);
  check('bare --bucket is refused', r.code === 1 && /--bucket requires a value/.test(r.out));
  r = run(['add-goal', '49', 'y', '--brief'], gh);
  check('bare --brief is refused', r.code === 1 && /--brief requires a value/.test(r.out));
  r = run(['read', '--goal'], gh);
  check('bare read --goal is refused', r.code === 1 && /--goal requires a value/.test(r.out));
  r = run(['move', String(n2), 'Later'], gh);
  check('move sets Priority only', r.code === 0 && st.fields['PI_I_' + n2 + ':F_R'] === 'r3' && !st.comments[n2]);
  run(['move', String(n2), 'Next'], gh);
  r = run(['add-item', 'G140', 'run /shepr:setup', '--you'], gh);
  const ny = Number(r.out.trim());
  check('--you: orch:you + assignee, still a sub-issue', st.issues[ny].labels.some(l => l.name === 'orch:you') && st.issues[ny].assignees[0] === 'me' && st.parent[ny] === 140);
  r = run(['set-status', String(n1), 'In progress'], gh);
  check('set-status sets field and comments with opId', st.fields['PI_I_' + n1 + ':F_S'] === 's2' && /<!-- opId:/.test(st.comments[n1][0].body));
  r = run(['set-blocker', String(n2), 'needs setup', '--owner', 'you'], gh);
  check('set-blocker adds label + blocked: comment', st.issues[n2].labels.some(l => l.name === 'orch:blocked') && st.comments[n2][0].body.startsWith('blocked: needs setup · owner: you'));
  let b = JSON.parse(run(['read', '--json'], gh).out);
  check('read folds G140 blocked with blocker text', b.goals[0].lane === 'G140' && b.goals[0].status === 'blocked' && b.goals[0].blocker === 'blocked: needs setup · owner: you');
  check('read reports buckets from Priority and the gate item', b.goals[0].items.find(i => i.issue === n1).bucket === 'Now' && b.goals[0].items.find(i => i.issue === n2).bucket === 'Next' && b.goals[0].items.find(i => i.issue === n2).gate === 'GATE LIVE');
  r = run(['clear-blocker', String(n2)], gh);
  check('clear-blocker removes label, comments unblocked', !st.issues[n2].labels.some(l => l.name === 'orch:blocked') && st.comments[n2][1].body.startsWith('unblocked'));
  r = run(['attention', 'G140', 'blocked on infra decision'], gh);
  check('attention: exit 0', r.code === 0);
  check('attention: label added to goal issue', st.issues[140].labels.some(l => l.name === 'orch:needs_attention'));
  check('attention: comment added', st.comments[140].some(c => c.body.startsWith('attention: blocked on infra decision')));
  b = JSON.parse(run(['read', '--json'], gh).out);
  check('read folds needs_attention', b.goals[0].status === 'needs_attention');
  r = run(['attention', 'G140', '--clear', 'infra unblocked'], gh);
  check('attention --clear: exit 0', r.code === 0);
  check('attention --clear: label removed', !st.issues[140].labels.some(l => l.name === 'orch:needs_attention'));
  check('attention --clear: comment added', st.comments[140].some(c => c.body.startsWith('attention cleared')));
  b = JSON.parse(run(['read', '--json'], gh).out);
  check('read folds back to items\' own status (running) after clear', b.goals[0].status === 'running');
  r = run(['done', '--goal', 'G140', '--step', 'S1', String(n1)], gh);
  check('done → Status Done + closed', st.fields['PI_I_' + n1 + ':F_S'] === 's4' && st.issues[n1].state === 'closed');
  r = run(['done', String(n2)], gh);
  check('bare done <item#> is refused with the reason', r.code === 1 && /--goal G<n> --step S<j>/.test(r.out) && st.issues[n2].state === 'open');
  r = run(['done', '--goal', 'G141', '--step', 'S2', String(n2)], gh);
  check('done refuses an item that is not under --goal', r.code === 1 && /belongs to G140/.test(r.out));
  r = run(['done', '--goal', 'G140', '--step', 'S9', String(n2)], gh);
  check('done refuses a step that is not the item\'s step: line', r.code === 1 && /is step S2, not S9/.test(r.out));
  r = run(['close-goal', 'G140', '--evidence', 'iter 3 · G140 · 10 → 2'], gh);
  check('close-goal refuses while items are open', r.code === 1 && /open item/.test(r.out) && st.issues[140].state === 'open');
  run(['done', '--goal', 'G140', '--step', 'S2', String(n2)], gh); run(['done', '--goal', 'G140', '--step', 'S3', String(ny)], gh);
  r = run(['close-goal', 'G140'], gh);
  check('close-goal refuses without --evidence', r.code === 1 && /evidence/.test(r.out));
  r = run(['close-goal', 'G140', '--evidence', 'iter 3 · G140 · 10 → 2'], gh);
  check('close-goal: evidence comment on goal, Status Done, closed', r.code === 0 && st.comments[140].some(c => /^evidence: iter 3 · G140/.test(c.body)) && st.fields['PI_I_140:F_S'] === 's4' && st.issues[140].state === 'closed');
  b = JSON.parse(run(['read', '--json'], gh).out);
  check('read folds merged', b.goals[0].status === 'merged');
  check('journal has no pending after clean run', require('../scripts/lib/journal').openJournal(JOURNAL).pending().length === 0);
}
// --- outage: intent stays pending, step fails, next verb resumes -------------------
{
  const { st, gh } = ghStore();
  run(['add-goal', '49', 'g', '--brief', BRIEF], gh);
  st.fail = s => /POST repos\/o\/r\/issues$/.test(s);
  const r = run(['add-item', 'G140', 'flaky item'], gh);
  check('outage → non-zero exit, item not created', r.code === 1 && Object.keys(st.issues).length === 1);
  const pend = require('../scripts/lib/journal').openJournal(JOURNAL).pending();
  check('createIssue intent left pending', pend.length === 1 && pend[0].subEffect === 'createIssue');
  st.fail = null;
  const r2 = run(['add-item', 'G140', 'second item'], gh);
  check('next verb replays pending first: both items exist, flaky created once', r2.code === 0 && Object.values(st.issues).filter(i => st.parent[i.number] === 140).map(i => i.title).sort().join() === 'flaky item,second item');
  check('journal drained', require('../scripts/lib/journal').openJournal(JOURNAL).pending().length === 0);
}
// --- resume probes are idempotent: comment landed, done record lost ----------------
{
  const { st, gh } = ghStore();
  run(['add-goal', '49', 'g', '--brief', BRIEF], gh);
  const num = Number(run(['add-item', 'G140', 'once'], gh).out.trim());
  const { openJournal } = require('../scripts/lib/journal');
  openJournal(JOURNAL).intent({ opId: 'op-crash', lane: 'G140', subEffect: 'comment', desired: { issue: num, body: 'status → In progress' } });
  (st.comments[num] = st.comments[num] || []).push({ body: 'status → In progress\n<!-- opId:op-crash -->' });
  run(['set-status', String(num), 'In review'], gh);
  check('comment with matching opId is NOT re-posted', st.comments[num].filter(c => /opId:op-crash/.test(c.body)).length === 1);
  check('crash intent now recorded done', openJournal(JOURNAL).pending().length === 0);
}
// --- crash AFTER createIssue landed, before its done record ------------------------
// The orphan has no parent link yet, so readBoard cannot see it; only the opId
// marker in its body identifies it. Replay must adopt it, not create a twin.
{
  const { st, gh } = ghStore();
  const { bodyOf } = require('../scripts/board-gh');
  const { openJournal } = require('../scripts/lib/journal');
  fs.rmSync(JOURNAL, { force: true });
  run(['add-goal', '49', 'g', '--brief', BRIEF], gh);
  const text = 'crashed item';
  const body = bodyOf(text).replace(/<!-- orch-item -->$/, '<!-- opId:A:0 -->\n<!-- orch-item -->');
  st.issues[141] = { number: 141, id: 1141, node_id: 'I_141', state: 'open', title: text, body, milestone: 49, labels: [{ name: 'orch:item' }] };
  st.next = 142; // orphan: no sub-issue link, not on the project, no fields
  const args = { goal: 140, lane: 'G140', title: text, text, body: bodyOf(text), labels: ['orch:item'], milestoneNumber: 49,
    bucket: 'Now', pipeline: null, feature: null, assignee: null };
  openJournal(JOURNAL).intent({ opId: 'A:0', actionId: 'A', lane: 'G140', subEffect: 'createIssue', action: { name: 'add-item', args },
    desired: { goal: 140, title: text, text, body: args.body, labels: args.labels, milestoneNumber: 49, assignee: null } });
  const r = run(['add-item', 'G140', 'another'], gh);
  check('crash after create: orphan adopted, no duplicate issue', r.code === 0 && Object.values(st.issues).filter(i => i.title === text).length === 1);
  check('crash after create: orphan linked + on project with Status Todo, Priority Now',
    st.parent[141] === 140 && st.items['I_141'] === 'PI_I_141' && st.fields['PI_I_141:F_S'] === 's1' && st.fields['PI_I_141:F_R'] === 'r1');
  const outLines = r.out.trim().split(/\r?\n/);
  check('crash after create: replay resumed line printed before the verb output', /^board-gh: resumed \d+ pending sub-effect\(s\)/.test(outLines[0]));
  check('crash after create: journal drained, new item wired too', openJournal(JOURNAL).pending().length === 0 && st.parent[Number(outLines[outLines.length - 1])] === 140);
}
// --- lock authority -----------------------------------------------------------------
{
  const { gh } = ghStore();
  const r1 = run(['add-goal', '49', 'z', '--brief', BRIEF], gh, { lockCfg: { __repoLocked: true, board: { github: false } } });
  check('locked repo without board.github → refuse', r1.code === 1 && /board\.github/.test(r1.out));
  const r2 = run(['add-goal', '49', 'z', '--brief', BRIEF], gh, { lockCfg: { __repoLocked: true, board: { github: true } } });
  check('locked repo with board.github → allowed', r2.code === 0);
}
// --- add-milestone / close-milestone / move on goals (Director-only, journaled) ----
{
  const { st, gh } = ghStore();
  let r = run(['add-milestone', 'Ship the HMI', '--target', '2026-10-31', '--done', 'operator runs a shift on HMI alone'], gh);
  const m = st.milestones.find(x => /Ship the HMI$/.test(x.title));
  check('add-milestone creates then retitles to M<github#> · objective, prints M<github#>', r.code === 0 && m && m.number === 53 && m.title === 'M53 · Ship the HMI' && r.out.trim() === 'M53');
  check('add-milestone description/due_on follow the grammar', m.description === 'target: 2026-10-31 · done: operator runs a shift on HMI alone' && m.due_on === '2026-10-31T00:00:00Z');
  const before = st.milestones.length;
  r = run(['add-milestone', 'Ship the HMI', '--target', '2026-10-31', '--done', 'x'], gh);
  check('add-milestone is idempotent on the objective', r.code === 0 && st.milestones.length === before && /exists: #53/.test(r.out));
  r = run(['add-milestone', 'SHU-HDS operable', '--target', '2026-10-31', '--done', 'x'], gh);
  check('a legacy C1 title does not count as the same objective', r.code === 0 && st.milestones.length === before + 1);
  st.milestones.push({ number: 70, title: 'M9 · Wrong ordinal', description: '', state: 'open', open_issues: 0, closed_issues: 0 });
  r = run(['add-milestone', 'Wrong ordinal', '--target', '2026-10-31', '--done', 'x'], gh);
  check('a malformed M<k> title (k ≠ number) is refused, not adopted', r.code === 1 && /malformed/.test(r.out) && !st.milestones.some(m => m.title === 'M70 · Wrong ordinal'));
  st.milestones.pop();
  r = run(['add-milestone', 'Anything', '--target', '2026-99-99', '--done', 'x'], gh);
  check('add-milestone rejects an impossible date', r.code === 1 && /YYYY-MM-DD/.test(r.out));
  r = run(['add-milestone', 'Anything', '--target', '2026-10-31'], gh);
  check('add-milestone requires --done', r.code === 1 && /usage: add-milestone/.test(r.out));
  r = run(['add-milestone', 'Anything', '--target', '2026-10-31', '--done', 'x'], gh, { env: { ORCH_ROLE: 'coordinator' } });
  check('add-milestone refuses inside a roled pane, before any call', r.code === 1 && /refused/.test(r.out) && /ORCH_ROLE=coordinator/.test(r.out) && st.milestones.length === before + 1);

  run(['add-goal', String(m.number), 'HDS', '--brief', BRIEF], gh);
  const s1 = Number(run(['add-item', 'G140', 'the only step', '--gate', 'DONE'], gh).out.trim());
  r = run(['close-milestone', String(m.number), '--summary', 'shift ran alone'], gh);
  check('close-milestone refuses while a goal is not merged, names it', r.code === 1 && /G140/.test(r.out) && m.state === 'open');
  st.extraGoalsInMilestone = 1; // one orch:goal issue the 50-goal read window would miss
  r = run(['close-milestone', String(m.number), '--summary', 'x'], gh);
  check('close-milestone refuses when the REST goal count exceeds what read returned', r.code === 1 && /differs/.test(r.out));
  st.extraGoalsInMilestone = -1; // REST returns fewer than read (concurrent move)
  r = run(['close-milestone', String(m.number), '--summary', 'x'], gh);
  check('close-milestone refuses when the REST goal count is lower than read', r.code === 1 && /differs/.test(r.out));
  st.extraGoalsInMilestone = 0;
  st.swapGoalInMilestone = true; // same count, different membership (merged goal moved out, open one moved in)
  r = run(['close-milestone', String(m.number), '--summary', 'x'], gh);
  check('close-milestone refuses when the REST goal set differs at equal count', r.code === 1 && /differs/.test(r.out));
  st.swapGoalInMilestone = false;
  r = run(['move', 'G140', 'Later'], gh);
  check('move on a goal sets the goal Priority', r.code === 0 && st.fields['PI_I_140:F_R'] === 'r3');
  r = run(['move', 'G140', 'Now'], gh, { env: { ORCH_ROLE: 'dev' } });
  check('move on a goal refuses inside a roled pane', r.code === 1 && /refused/.test(r.out) && st.fields['PI_I_140:F_R'] === 'r3');
  r = run(['add-goal', '49', 'empty', '--brief', BRIEF], gh); // add-goal→140, add-item→141, so this goal is 142
  r = run(['close-goal', 'G142', '--evidence', 'iter 1 · G142 · done'], gh);
  check('close-goal refuses a goal with no step', r.code === 1 && /no step/.test(r.out) && st.issues[142].state === 'open');
  run(['done', '--goal', 'G140', '--step', 'S1', String(s1)], gh);
  run(['close-goal', 'G140', '--evidence', 'iter 1 · G140 · done'], gh);
  r = run(['close-milestone', 'M53 · Ship the HMI', '--summary', 'shift ran alone'], gh);
  check('close-milestone by title closes when every goal is merged, appends closed/summary', r.code === 0 && m.state === 'closed' && /\nclosed: \d{4}-\d{2}-\d{2} · summary: shift ran alone$/.test(m.description) && /closed \(1 goals\)/.test(r.out));
  r = run(['close-milestone', '52', '--summary', 'x'], gh);
  check('close-milestone refuses a milestone with zero goals', r.code === 1 && /nothing was done/.test(r.out));
  r = run(['close-milestone', '52'], gh);
  check('close-milestone requires --summary', r.code === 1 && /--summary/.test(r.out));
  r = run(['close-milestone', '52', '--summary', 'x'], gh, { env: { ORCH_ROLE: 'coordinator' } });
  check('close-milestone refuses inside a roled pane', r.code === 1 && /refused/.test(r.out));
}
// --- replay never executes a Director-only action in a roled pane -----------------
{
  const { st, gh } = ghStore();
  const { openJournal } = require('../scripts/lib/journal');
  fs.rmSync(JOURNAL, { force: true });
  run(['add-goal', '49', 'g', '--brief', BRIEF], gh); // un-roled, before the intent exists
  openJournal(JOURNAL).intent({ opId: 'D:0', actionId: 'D', lane: 'M?', subEffect: 'createMilestone', action: { name: 'add-milestone', args: { objective: 'Pending', description: 'target: 2026-10-31 · done: x', due_on: '2026-10-31T00:00:00Z' } }, desired: { title: 'Pending', description: 'target: 2026-10-31 · done: x', due_on: '2026-10-31T00:00:00Z' } });
  const r = run(['add-item', 'G140', 'x'], gh, { env: { ORCH_ROLE: 'dev' } });
  check('roled add-item leaves the pending add-milestone pending and says so', r.code === 0 && !st.milestones.some(m => /Pending/.test(m.title)) && /skipped 1 Director-only pending/.test(r.out) && openJournal(JOURNAL).pending().length === 1);
  const r2 = run(['add-item', 'G140', 'y'], gh);
  check('un-roled call replays it, create then retitle', r2.code === 0 && st.milestones.some(m => m.title === 'M53 · Pending') && openJournal(JOURNAL).pending().length === 0);
}
// --- crash between create and retitle: replay retitles, never duplicates ---------
{
  const { st, gh } = ghStore();
  const { openJournal } = require('../scripts/lib/journal');
  fs.rmSync(JOURNAL, { force: true });
  st.milestones.push({ number: 53, title: 'Half done', description: 'target: 2026-10-31 · done: x', due_on: '2026-10-31T00:00:00Z', state: 'open', open_issues: 0, closed_issues: 0 });
  const args = { objective: 'Half done', description: 'target: 2026-10-31 · done: x', due_on: '2026-10-31T00:00:00Z' };
  openJournal(JOURNAL).intent({ opId: 'H:0', actionId: 'H', lane: 'M?', subEffect: 'createMilestone', action: { name: 'add-milestone', args }, desired: { title: 'Half done', description: args.description, due_on: args.due_on } });
  run(['add-goal', '49', 'g', '--brief', BRIEF], gh);
  check('replay after a crash between create and retitle adopts #53 and retitles it', st.milestones.filter(m => /Half done$/.test(m.title)).length === 1 && st.milestones[2].title === 'M53 · Half done' && openJournal(JOURNAL).pending().length === 0);
}
// --- crash between create-done and retitle-intent: no journal record, bare title -----
{
  const { st, gh } = ghStore();
  const { openJournal } = require('../scripts/lib/journal');
  fs.rmSync(JOURNAL, { force: true });
  st.milestones.push({ number: 53, title: 'Bare', description: 'target: 2026-10-31 · done: x', due_on: '2026-10-31T00:00:00Z', state: 'open', open_issues: 0, closed_issues: 0 });
  const before = st.milestones.length;
  const r = run(['add-milestone', 'Bare', '--target', '2026-10-31', '--done', 'x'], gh);
  check('a bare <objective> title is half-done: retitled, not reused, not duplicated', r.code === 0 && r.out.trim() === 'M53' && st.milestones.length === before && st.milestones[2].title === 'M53 · Bare' && openJournal(JOURNAL).pending().length === 0);
}
// --- milestone lookups page past 100 -------------------------------------------------
{
  const { st, gh } = ghStore();
  for (let i = 0; i < 100; i++) st.milestones.push({ number: 200 + i, title: `filler ${i}`, description: '', state: 'open', open_issues: 0, closed_issues: 0 });
  st.milestones.push({ number: 300, title: 'M300 · On page two', description: 'target: 2026-10-31 · done: x', due_on: '2026-10-31T00:00:00Z', state: 'open', open_issues: 0, closed_issues: 0 });
  const before = st.milestones.length;
  let r = run(['add-milestone', 'On page two', '--target', '2026-10-31', '--done', 'x'], gh);
  check('add-milestone finds an existing milestone on page 2', r.code === 0 && /exists: #300/.test(r.out) && st.milestones.length === before);
  r = run(['close-milestone', '300', '--summary', 'x'], gh);
  check('close-milestone finds its target on page 2 (refuses for zero goals, not "no open milestone")', r.code === 1 && /has no goals/.test(r.out) && !/no open milestone/.test(r.out));
}
// --- accept: / recipe: ----------------------------------------------------------
{
  const { parseBody, bodyOf, RECIPES, EXEC_RECIPES } = require('../scripts/board-gh');
  check('RECIPES is the seven-name list', RECIPES.join() === 'spec,tdd,iterate,debug,research,cleanup,fast');
  check('EXEC_RECIPES is the execution group', EXEC_RECIPES.join() === 'tdd,iterate,debug,cleanup,fast');
  const body = bodyOf('wire the gate', { step: 'S2', outcome: 'gate wired', gate: 'GATE LIVE', accept: 'test-grammar passes', recipe: 'tdd' });
  check('bodyOf orders step, outcome, gate, accept, recipe, mark last', body === 'wire the gate\n\nstep: S2\noutcome: gate wired\ngate: GATE LIVE\naccept: test-grammar passes\nrecipe: tdd\n<!-- orch-item -->');
  const p = parseBody(body + '\n<!-- opId:x -->');
  check('parseBody reads step, accept and recipe', p.step === 'S2' && p.accept === 'test-grammar passes' && p.recipe === 'tdd' && p.gate === 'GATE LIVE');
  check('legacy body → null step/accept/recipe', parseBody('old\n\noutcome: y\n<!-- orch-item -->').step === null && parseBody('old').recipe === null);
  const { st, gh } = ghStore();
  run(['add-goal', '49', 'g', '--brief', BRIEF], gh);
  let r = run(['add-item', 'G140', 'wire the gate', '--accept', 'test-grammar passes', '--recipe', 'tdd'], gh);
  const n = Number(r.out.trim());
  check('add-item assigns step: S1 and writes accept:/recipe:', r.code === 0 && /\nstep: S1\n/.test(st.issues[n].body) && /\naccept: test-grammar passes\nrecipe: tdd\n<!-- opId:/.test(st.issues[n].body));
  r = run(['add-item', 'G140', 'second'], gh);
  check('next add-item gets S2', /\nstep: S2\n/.test(st.issues[Number(r.out.trim())].body));
  run(['done', '--goal', 'G140', '--step', 'S1', String(n)], gh);
  r = run(['add-item', 'G140', 'third'], gh);
  check('step numbers are never reused (S3 after S1 closed)', /\nstep: S3\n/.test(st.issues[Number(r.out.trim())].body));
  for (let i = 0; i < 45; i++) run(['add-item', 'G140', 'bulk ' + i], gh); // past the 40-item read window
  r = run(['add-item', 'G140', 'forty-ninth'], gh);
  check('step allocation pages all sub-issues, not the 40-item read window', /\nstep: S49\n/.test(st.issues[Number(r.out.trim())].body));
  r = run(['add-item', 'G140', 'x', '--recipe', 'yolo'], gh);
  check('add-item rejects an unknown recipe', r.code === 1 && /recipe must be one of tdd \| iterate/.test(r.out));
  r = run(['add-item', 'G140', 'x', '--recipe', 'spec'], gh);
  check('add-item rejects a shaping recipe on a step', r.code === 1 && /recipe must be one of tdd \| iterate/.test(r.out) && !Object.values(st.issues).some(i => /recipe: spec/.test(i.body)));
  r = run(['add-item', 'G140', 'x', '--recipe'], gh);
  check('bare --recipe is refused', r.code === 1 && /--recipe requires a value/.test(r.out));
}
// --- feature: parsed from the BRIEF; items inherit ---------------------------------
{
  const { st, gh } = ghStore();
  let r = run(['add-goal', '49', 'HDS', '--brief', BRIEF], gh);
  check('add-goal sets the goal Feature from the brief feature: line', r.code === 0 && st.fields['PI_I_140:F_F'] === 'f1');
  check('add-goal writes no base: line', !/^base:/m.test(st.issues[140].body));
  const noFeat = path.join(SCRATCH, 'brief-nofeat.md'); fs.writeFileSync(noFeat, 'BRIEF\ngoal: z\ndomains: hmi\n');
  r = run(['add-goal', '49', 'Z', '--brief', noFeat], gh);
  check('add-goal refuses a brief without feature: when the Project has a Feature field', r.code === 1 && /feature:/.test(r.out) && !st.issues[141]);
  const notInDomains = path.join(SCRATCH, 'brief-notin.md'); fs.writeFileSync(notInDomains, 'BRIEF\ngoal: z\ndomains: numerics\nfeature: hmi\n');
  r = run(['add-goal', '49', 'Z', '--brief', notInDomains], gh);
  check('add-goal refuses a feature: that is not one of domains:', r.code === 1 && /not one of domains/.test(r.out) && !st.issues[141]);
  const badFeat = path.join(SCRATCH, 'brief-bad.md'); fs.writeFileSync(badFeat, 'BRIEF\ngoal: z\nfeature: nope\n');
  r = run(['add-goal', '49', 'Z', '--brief', badFeat], gh);
  check('add-goal refuses an unknown feature before writing', r.code === 1 && /unknown feature "nope"/.test(r.out) && !st.issues[141]);
  r = run(['add-item', 'G140', 'inherits'], gh);
  const n1 = Number(r.out.trim());
  check('add-item inherits the goal feature', st.fields['PI_I_' + n1 + ':F_F'] === 'f1');
  r = run(['add-item', 'G140', 'overrides', '--feature', 'hmi'], gh);
  const n2 = Number(r.out.trim());
  check('add-item --feature overrides the inherited value', st.fields['PI_I_' + n2 + ':F_F'] === 'f2');
  // a record journaled before this task (feature: null in args) still inherits on replay
  const { openJournal } = require('../scripts/lib/journal');
  const args = { goal: 140, lane: 'G140', title: 'old', text: 'old', body: require('../scripts/board-gh').bodyOf('old', { step: 'S9' }), labels: ['orch:item'], milestoneNumber: 49, bucket: 'Now', pipeline: null, feature: null, assignee: null };
  openJournal(JOURNAL).intent({ opId: 'B:0', actionId: 'B', lane: 'G140', subEffect: 'createIssue', action: { name: 'add-item', args }, desired: { goal: 140, title: 'old', text: 'old', body: args.body, labels: args.labels, milestoneNumber: 49, assignee: null } });
  run(['add-item', 'G140', 'trigger replay'], gh);
  const old = Object.values(st.issues).find(i => i.title === 'old');
  check('replayed pre-upgrade add-item inherits the goal feature', old && st.fields['PI_' + old.node_id + ':F_F'] === 'f1');
  delete st.fields['PI_I_140:F_F']; // the goal predates the Feature field (adopt mode); only its BRIEF says feature:
  r = run(['add-item', 'G140', 'late field'], gh);
  check('add-item falls back to the BRIEF feature: line when the goal has no Feature value', st.fields['PI_I_' + r.out.trim() + ':F_F'] === 'f1');
  // a goal record journaled before this task (no feature key) parses feature: from its body on replay
  const gBody = fs.readFileSync(BRIEF, 'utf8');
  openJournal(JOURNAL).intent({ opId: 'C:0', actionId: 'C', lane: 'G?', subEffect: 'createGoal', action: { name: 'add-goal', args: { name: 'pre-upgrade goal', body: gBody, milestoneNumber: 49 } }, desired: { title: 'pre-upgrade goal', body: gBody, milestoneNumber: 49 } });
  run(['add-item', 'G140', 'trigger replay again'], gh);
  const pre = Object.values(st.issues).find(i => i.title === 'pre-upgrade goal');
  check('replayed pre-upgrade add-goal sets Feature from the body feature: line', pre && st.fields['PI_' + pre.node_id + ':F_F'] === 'f1');
}
// --- read: merged goals are unverified when no passing round covers their final range -----
{
  const gh = fakeGh([[/subIssues/, () => GOALS]]);
  const seen = [];
  const j = JSON.parse(run(['read', '--json'], gh, { verify: n => { seen.push(n); return { ok: false, miss: `(c) no passing step manifest for G${n} at HEAD` }; } }).out);
  const g99 = j.goals.find(g => g.lane === 'G99'), g142 = j.goals.find(g => g.lane === 'G142');
  check('merged goal without a passing manifest is unverified with the miss', g99.unverified === true && /no passing step manifest for G99/.test(g99.unverifiedReason));
  check('open goals are never unverified; the verifier runs only for merged goals', g142.unverified === false && seen.join() === '99');
  const j2 = JSON.parse(run(['read', '--json'], gh, { verify: () => ({ ok: true }) }).out);
  check('merged goal with a covering passing round is verified', j2.goals.find(g => g.lane === 'G99').unverified === false);
}
// --- add-goal: domains: must name contract domains ------------------------------------------
{
  const { st, gh } = ghStore();
  const BAD = path.join(SCRATCH, 'brief-bad.md');
  fs.writeFileSync(BAD, 'BRIEF\ngoal: x\nmetric: m\ndone: d\ndomains: numerics, ghost\nfeature: numerics\nkill: k\n');
  const lockCfg = { __repoLocked: false, contract: { domains: { numerics: { paths: ['src/**'], decide: 'ai', ship: 'commit' } } } };
  let r = run(['add-goal', '49', 'bad', '--brief', BAD], gh, { lockCfg });
  check('add-goal refuses a domains: name absent from the contract', r.code === 1 && /ghost/.test(r.out) && !Object.values(st.issues).some(i => i.title === 'bad'));
  r = run(['add-goal', '49', 'good', '--brief', BRIEF], gh, { lockCfg });
  check('add-goal accepts domains: that name contract domains', r.code === 0);
  r = run(['add-goal', '49', 'nocontract', '--brief', BAD], gh);
  check('no contract → domains: not validated (nothing to validate against)', r.code === 0);
}
module.exports = { check, run, fakeGh, writeCfg, CFG, CWD, COMMON, SCRATCH, finish() { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); } };
if (require.main === module) module.exports.finish();
