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
// --- write verbs -----------------------------------------------------------------
const JOURNAL = path.join(COMMON, 'orch', 'board-journal.jsonl');
const BRIEF = path.join(SCRATCH, 'brief.md');
fs.writeFileSync(BRIEF, 'BRIEF\ngoal: learn from ships\nmetric: lessons/ship\ndone: gate live\ndomains: numerics\nkill: 3 sessions\n');
function ghStore() {
  const st = { milestones: [{ number: 49, title: 'C1 SHU-HDS operable', state: 'open', open_issues: 0, closed_issues: 0 }, { number: 52, title: 'backlog', state: 'open', open_issues: 0, closed_issues: 0 }],
    issues: {}, comments: {}, items: {}, fields: {}, parent: {}, next: 140, fail: null };
  const FIELD = { F_S: ['status', 'Status'], F_R: ['priority', 'Priority'], F_P: ['pipeline', 'Pipeline'], F_F: ['feature', 'Feature'] };
  const optName = (fid, oid) => Object.entries(CFG.optionIds[FIELD[fid][0]]).find(([, id]) => id === oid)[0];
  const fv = i => st.items[i.node_id] ? [{ project: { id: 'PVT_1' }, fieldValues: { nodes: Object.entries(st.fields).filter(([k]) => k.startsWith(st.items[i.node_id] + ':')).map(([k, o]) => { const fid = k.split(':')[1]; return { name: optName(fid, o), field: { name: FIELD[fid][1] } }; }) } }] : [];
  const node = i => ({ number: i.number, title: i.title, body: i.body, state: i.state.toUpperCase(), updatedAt: 'now', milestone: i.milestone ? st.milestones.find(m => m.number === i.milestone) : null,
    labels: { nodes: i.labels }, assignees: { nodes: (i.assignees || []).map(login => ({ login })) }, projectItems: { nodes: fv(i) } });
  const handlers = [
    [/GET repos\/o\/r\/milestones/, () => st.milestones],
    [/GET user$/, () => ({ login: 'me' })],
    // identity probe: all orch issues with the given label, newest first
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
  r = run(['move', String(n2), 'Later'], gh);
  check('move sets Priority only', r.code === 0 && st.fields['PI_I_' + n2 + ':F_R'] === 'r3' && !st.comments[n2]);
  run(['move', String(n2), 'Next'], gh);
  r = run(['add-item', 'G140', 'run /orch:setup', '--you'], gh);
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
  r = run(['done', String(n1)], gh);
  check('done → Status Done + closed', st.fields['PI_I_' + n1 + ':F_S'] === 's4' && st.issues[n1].state === 'closed');
  r = run(['close-goal', 'G140', '--evidence', 'iter 3 · G140 · 10 → 2'], gh);
  check('close-goal refuses while items are open', r.code === 1 && /open item/.test(r.out) && st.issues[140].state === 'open');
  run(['done', String(n2)], gh); run(['done', String(ny)], gh);
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
module.exports = { check, run, fakeGh, writeCfg, CFG, CWD, COMMON, SCRATCH, finish() { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); } };
if (require.main === module) module.exports.finish();
