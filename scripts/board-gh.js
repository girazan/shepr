#!/usr/bin/env node
// board-gh — GitHub Issues + Projects v2 ARE the shepr board (spec §4).
// Milestone (operator's) → objective = Issue orch:objective → goal = Issue orch:goal (sub-issue of its objective) → items = sub-issues.
// Verbs: init · milestones · add-objective · add-goal · add-item · move · set-status ·
// set-blocker · clear-blocker · attention · done · close-goal · read.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { makeGh } = require('./lib/gh');
const { foldStatus } = require('./lib/fold');
const { openJournal } = require('./lib/journal');
const { withLock } = require('./lib/lockfile');

const MARK = '<!-- orch-item -->';
const STATUS_OPTS = ['Todo', 'In progress', 'In review', 'Done'];

function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opt[k] = argv[++i]; else opt[k] = true; }
    else pos.push(a);
  }
  return { pos, opt };
}

function loadCfg(cwd) {
  const p = path.join(cwd, '.orch', 'board.json');
  if (!fs.existsSync(p)) return null;
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const k of ['owner', 'repo', 'projectId', 'fieldIds', 'optionIds']) if (c[k] == null) return null;
  if (!c.fieldIds.status || !c.fieldIds.priority || !c.optionIds.priority || !Object.keys(c.optionIds.priority).length) return null;
  c.buckets = Object.keys(c.optionIds.priority); // Priority options ARE the buckets, in field order
  return c;
}

function stripOpId(body) {
  // The opId marker is identity metadata (spec §4.3), never board content.
  return (body || '').split(/\r?\n/).filter(l => !/^<!-- opId:.* -->$/.test(l.trim()));
}
const RECIPES = ['spec', 'tdd', 'iterate', 'debug', 'research', 'cleanup', 'fast']; // spec §8
const EXEC_RECIPES = ['tdd', 'iterate', 'debug', 'cleanup', 'fast']; // the only ones a step may carry

function parseBody(body) {
  const lines = stripOpId(body).filter(l => l.trim() !== MARK);
  const grab = re => { const m = lines.map(l => l.match(re)).find(Boolean); return m ? m[1].trim() : null; };
  return { text: (lines[0] || '').trim(), step: grab(/^step:\s*(S\d+)/i), outcome: grab(/^outcome:\s*(.+)$/i), gate: grab(/^gate:\s*(.+)$/i),
    accept: grab(/^accept:\s*(.+)$/i), recipe: grab(/^recipe:\s*(\S+)/i) };
}
function bodyOf(text, { step, outcome, gate, accept, recipe } = {}) {
  return [text, '', step ? `step: ${step}` : null, outcome ? `outcome: ${outcome}` : null, gate ? `gate: ${gate}` : null,
    accept ? `accept: ${accept}` : null, recipe ? `recipe: ${recipe}` : null, MARK].filter(x => x !== null).join('\n');
}

// ponytail: page sizes are bounded by GitHub's 500k-node estimate (goals × projectItems × fieldValues × subIssues × …);
// 50×(3×12 + 40×3×12) ≈ 74k. Raising any first: multiplies the whole product — paginate instead.
const PI = `projectItems(first:3){ nodes{ project{ id } fieldValues(first:12){ nodes{ ... on ProjectV2ItemFieldSingleSelectValue { name field{ ... on ProjectV2FieldCommon { name } } } } } } }`;
// ponytail: first 50 goals (newest) / 40 sub-issues per goal; paginate when a repo outgrows it
const READ_QUERY = `query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){
  issues(first:50,states:[OPEN,CLOSED],labels:["orch:goal"],orderBy:{field:CREATED_AT,direction:DESC}){ nodes{
    number title body state updatedAt milestone{ number title } labels(first:30){ nodes{ name } } ${PI}
    subIssues(first:40){ nodes{ number title body state updatedAt labels(first:20){ nodes{ name } } assignees(first:5){ nodes{ login } } ${PI} } } } } } }`;

function fieldOf(node, cfg, name) {
  const pi = node.projectItems.nodes.find(p => p.project.id === cfg.projectId);
  const v = pi && pi.fieldValues.nodes.find(x => x.field && x.field.name === name);
  return v ? v.name : null;
}
function latestComment(gh, cfg, number, prefix) {
  const cs = gh.rest('GET', `repos/${cfg.owner}/${cfg.repo}/issues/${number}/comments?per_page=100`) || [];
  for (let i = cs.length - 1; i >= 0; i--) { const first = (cs[i].body || '').split(/\r?\n/)[0].trim(); if (first.startsWith(prefix)) return first; }
  return null;
}

function defaultVerify(cwd) {
  // The close-goal lint over git + the locked contract: a merged goal whose
  // last passing round does not cover its final range is `unverified` (spec §4).
  const { execFileSync } = require('child_process');
  const { loadConfig } = require('../hooks/lib/config');
  const { lint } = require('../hooks/lib/evidence-lint');
  let root = null;
  try { root = execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
  if (!root) return () => ({ ok: false, miss: 'not inside a git repository' });
  const cfg = loadConfig({ cwd: root });
  if (!cfg.contract || !cfg.contract.domains || !Object.keys(cfg.contract.domains).length) return () => ({ ok: false, miss: 'no contract' });
  const git = args => execFileSync('git', ['-C', root, '-c', 'core.quotePath=false', ...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  return n => { try { return lint({ git, contract: cfg.contract, models: cfg.models || {}, verb: { kind: 'close', goal: n } }); } catch (e) { return { ok: false, miss: String(e.message).split('\n')[0] }; } };
}

function readBoard(gh, cfg, verify) {
  const d = gh.graphql(READ_QUERY, { owner: cfg.owner, repo: cfg.repo });
  const goals = d.repository.issues.nodes.map(g => {
    const items = g.subIssues.nodes.map(i => {
      const labels = i.labels.nodes.map(l => l.name);
      const b = parseBody(i.body);
      const status = fieldOf(i, cfg, 'Status');
      return { issue: i.number, labels, status, pipeline: fieldOf(i, cfg, 'Pipeline'), feature: fieldOf(i, cfg, 'Feature'),
        bucket: fieldOf(i, cfg, 'Priority') || cfg.buckets[0],
        text: b.text || i.title, outcome: b.outcome, gate: b.gate, step: b.step, accept: b.accept, recipe: b.recipe,
        done: i.state === 'CLOSED' || status === 'Done', you: labels.includes('orch:you'), updated: i.updatedAt };
    });
    const forFold = items.map(i => ({ labels: i.labels, status: i.status,
      blockerComment: i.labels.includes('orch:blocked') ? latestComment(gh, cfg, i.issue, 'blocked:') : null }));
    const { status, blocker } = foldStatus({ state: g.state.toLowerCase(), labels: g.labels.nodes.map(l => l.name) }, forFold);
    const v = status === 'merged' && verify ? verify(g.number) : null;
    return { lane: `G${g.number}`, issue: g.number, name: g.title, milestone: g.milestone ? { number: g.milestone.number, title: g.milestone.title } : null,
      bucket: fieldOf(g, cfg, 'Priority'), feature: fieldOf(g, cfg, 'Feature'),
      status, blocker, unverified: !!(v && !v.ok), ...(v && !v.ok ? { unverifiedReason: v.miss } : {}),
      brief: stripOpId(g.body).join('\n'), updated: g.updatedAt, items: items.map(({ labels, ...rest }) => rest) };
  }).sort((a, b) => {
    // Spec §4 one rule: Priority bucket across milestones (unset last) → milestone (none last) → issue.
    const bi = x => (x.bucket ? cfg.buckets.indexOf(x.bucket) : cfg.buckets.length);
    const mi = x => (x.milestone ? x.milestone.number : Infinity);
    return (bi(a) - bi(b)) || (mi(a) - mi(b)) || (a.issue - b.issue);
  });
  return { goals, buckets: cfg.buckets };
}

// M<n> is the milestone grammar (spec §2); C<n> is the legacy prefix and
// still ranks — shepr never renames an existing milestone.
function milestoneRank(t) { const m = /^[MC](\d+)\b/.exec(t || ''); return m ? Number(m[1]) : t === 'backlog' ? 1e6 : 1e7; }
function pagedMilestones(gh, R, state) { // REST pages at 100; a repo can have more
  const out = [];
  for (let page = 1; ; page++) {
    const p = gh.rest('GET', `${R}/milestones?state=${state}&per_page=100&page=${page}`) || [];
    out.push(...p);
    if (p.length < 100) break;
  }
  return out;
}
function listMilestones(gh, cfg) {
  const ms = pagedMilestones(gh, `repos/${cfg.owner}/${cfg.repo}`, 'open');
  return ms.map(m => ({ number: m.number, title: m.title, open: m.open_issues, closed: m.closed_issues, r: milestoneRank(m.title) }))
    .sort((a, b) => a.r - b.r || a.number - b.number).map(({ r, ...m }) => m);
}

function main(argv, deps = {}) {
  const cwd = deps.cwd || process.cwd();
  const stdout = deps.stdout || (s => process.stdout.write(s));
  const gh = deps.gh || makeGh();
  const env = deps.env || process.env;
  const { pos, opt } = parseArgs(argv);
  const verb = pos[0];
  if (!verb) { stdout('usage: board-gh <init|milestones|add-milestone|close-milestone|sync-features|add-objective|add-goal [--objective O<n>]|add-item|move|set-status|set-blocker|clear-blocker|attention|done --goal G<n> --step S<j> <item#>|close-goal|read> …\n'); return 1; }
  if (verb === 'init') return require('./board-gh-init').init({ pos, opt, cwd, gh, stdout });
  const cfg = loadCfg(cwd);
  if (!cfg) { stdout('board-gh: no usable .orch/board.json — run `/shepr:board init` first.\n'); return 1; }
  if (verb === 'milestones') { stdout(JSON.stringify(listMilestones(gh, cfg), null, 2) + '\n'); return 0; }
  if (opt.goal === true) { stdout('board-gh: --goal requires a value\n'); return 1; }
  if (verb === 'read') {
    const b = readBoard(gh, cfg, deps.verify || defaultVerify(cwd));
    if (opt.goal) b.goals = b.goals.filter(g => g.lane === String(opt.goal).toUpperCase());
    stdout(JSON.stringify(b, null, opt.json ? 0 : 2) + '\n');
    return 0;
  }
  const commonDir = deps.commonDir || require('../hooks/lib/config').resolveRepoKey(cwd);
  if (!commonDir) { stdout('board-gh: not inside a git repository.\n'); return 1; }
  return require('./board-gh-write').write({ verb, pos: pos.slice(1), opt, cfg, gh, stdout, cwd, commonDir, lockCfg: deps.lockCfg, env,
    readBoard, bodyOf, MARK, STATUS_OPTS, EXEC_RECIPES, openJournal, withLock, crypto });
}

module.exports = { main, parseBody, bodyOf, readBoard, defaultVerify, listMilestones, pagedMilestones, milestoneRank, loadCfg, MARK, STATUS_OPTS, RECIPES, EXEC_RECIPES };
if (require.main === module) process.exit(main(process.argv.slice(2)));
