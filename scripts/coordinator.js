#!/usr/bin/env node
// coordinator — the Coordinator's tick as code (spec §7 step 2, §4 pick
// rule, d.21–25, d.29, d.33). Pure functions + a thin main(). The script
// READS (board, contract, git ls-files/log, roster, audit, worklogs,
// manifests) and WRITES only audit lines, the session marker + roster entry
// at launch, and tmp/handoffs/M<n>-coordinator.md. Every git/gh/board-gh
// mutation is typed by the Coordinator so the ship gate sees it (v2 caveat).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { globToRe, RANKS } = require('../hooks/lib/contract');
const { appendAudit, AUDIT_REL, loadConfig, resolveRepoKey } = require('../hooks/lib/config');
const { withLock } = require('./lib/lockfile');
const { readMarker } = require('../hooks/lib/session');

// Evidence paths are never domain files (spec §5) — removed before any match.
const EVIDENCE = ['docs/reviews/**', 'tmp/worklogs/**', 'docs/adr/**'];

const briefLine = (brief, key) => { const m = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(brief || ''); return m ? m[1].trim() : null; };
const domainsOf = brief => (briefLine(brief, 'domains') || '').split(/[,\s]+/).filter(Boolean);

// Files a goal owns at HEAD: git ls-files ∩ locked paths of EVERY domain in
// domains: (spec §4 rule 5 — files, not globs; Opus S7).
function filesOfDomains(lsFiles, contract, domains) {
  const pats = [];
  for (const d of domains) for (const p of (((contract || {}).domains || {})[d] || {}).paths || []) pats.push(globToRe(p));
  const ev = EVIDENCE.map(globToRe);
  return lsFiles.map(f => f.replace(/\\/g, '/')).filter(f => pats.some(r => r.test(f)) && !ev.some(r => r.test(f)));
}

// Spec §4 goal pick, rules 0–5. `goals` arrive in board order (plan 1's
// Priority → milestone → issue sort) — rules 3–4 are that order, never re-sorted here.
// `scope` (from the pane's ORCH_IDS — one Coordinator per milestone) narrows
// the CANDIDATES only. `running` is still computed over EVERY goal: rule 5's
// file-overlap check must see the other milestone's resident lanes, or two
// Coordinators dispatch lanes that edit the same files.
//
// Two spellings, because a board predating /shepr:milestone has its own
// titles: `M<n>` is the GitHub milestone NUMBER (shepr's own grammar —
// add-milestone titles it `M<n> · …`, so name and number agree), `C<n>` is
// the legacy TITLE prefix that milestoneRank already ranks. On a hand-made
// board "C1 SHU-HDS operable" is milestone #49, so M49 and C1 are the same
// milestone by two routes; C<n> is the one a human actually says.
function pick({ goals, named, filesOf, scope }) {
  const skipped = [];
  const running = goals.filter(g => g.status === 'running').map(g => ({ lane: g.lane, files: new Set(filesOf(g)) }));
  const sm = scope ? /^([MC])(\d+)$/.exec(String(scope).trim()) : null;
  if (scope && !sm) throw new Error(`pick: scope must match M<n> or C<n>, got ${scope}`);
  const sNum = sm ? Number(sm[2]) : null;
  const byTitle = sm && sm[1] === 'C' && new RegExp('^C' + sNum + '(?![0-9])');
  const inScope = g => {
    if (!sm) return true;
    if (!g.milestone) return false;
    return byTitle ? byTitle.test(g.milestone.title || '') : g.milestone.number === sNum;
  };
  const overlap = g => {
    const mine = filesOf(g);
    for (const r of running) { if (r.lane === g.lane) continue; const hit = mine.find(f => r.files.has(f)); if (hit) return `rule 5: shares ${hit} with ${r.lane}`; }
    return null;
  };
  const eligible = g => {
    if (g.status === 'merged') return false;
    if (g.status === 'blocked' || g.status === 'needs_attention') { skipped.push({ lane: g.lane, reason: `rule 0: ${g.status}` }); return false; }
    const o = overlap(g);
    if (o) { skipped.push({ lane: g.lane, reason: o }); return false; }
    if (!inScope(g)) { skipped.push({ lane: g.lane, reason: `rule 6: outside ${scope}` }); return false; }
    return true;
  };
  if (named) {
    const g = goals.find(x => x.lane === String(named).toUpperCase());
    if (!g) return { pick: null, skipped: [{ lane: String(named).toUpperCase(), reason: 'rule 1: not on the board' }] };
    return { pick: eligible(g) ? g : null, skipped };
  }
  // Compute eligibility for every goal once (not lazily inside .find's
  // condition) so rule 0/5 skips are recorded for every goal, not only the
  // ones a short-circuited && happens to reach.
  const elig = new Map(goals.map(g => [g.lane, eligible(g)]));
  const hasOpenItem = g => (g.items || []).some(i => !i.done && !i.you);
  const inflight = goals.find(g => (g.status === 'running' || g.status === 'review') && hasOpenItem(g) && elig.get(g.lane));
  if (inflight) return { pick: inflight, skipped };
  return { pick: goals.find(g => g.status === 'ready' && elig.get(g.lane)) || null, skipped };
}

// kill: is machine-checkable only as `<n> sessions|ticks|rounds` (counted as
// dispatch pulses on the goal); any other wording is the Coordinator's
// judgment — returned verbatim, never tripped by code (INSTRUCTED).
function killCheck(brief, sessions) {
  const line = briefLine(brief, 'kill');
  const m = /^(\d+)\s+(sessions?|ticks?|rounds?)\b/i.exec(line || '');
  if (!m) return { tripped: false, line, counted: null };
  return { tripped: sessions >= Number(m[1]), line, counted: sessions };
}

// v2 §3.1: the counted-status predicate is exactly {reserved, running}.
const COUNTED = new Set(['reserved', 'running']);
function capacityCheck(roster, capacity = 6) {
  const count = (((roster || {}).delegates) || []).filter(d => COUNTED.has(d.status)).length;
  return { count, capacity, full: count >= capacity };
}

function readAudit(root) {
  try {
    return fs.readFileSync(path.join(root, AUDIT_REL), 'utf8').split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
// Stale = age of the last pulse (d.22). Minutes; null = never pulsed.
// With one Coordinator per milestone the pulse stream is shared, so a scoped
// tick reads only its own milestone's pulses — otherwise a live M2 keeps a
// dead M1 Coordinator looking fresh forever.
function pulseAge(audit, now = Date.now(), scope = null) {
  const last = audit.filter(e => e.by === 'pulse' && (!scope || e.milestone === scope)).pop();
  return last ? Math.round((now - Date.parse(last.ts)) / 60000) : null;
}

const roundOf = p => Number((/\.R(\d+)\.md$/.exec(p) || [0, 0])[1]);
const verdictOf = text => (/^verdict:\s*(pass|fail|inconclusive)/m.exec(text || '') || [])[1] || null;

// One tick, one action (spec §7 step 2). Pure: every source is an input.
function tick({ goals, named, contract, lsFiles, roster, audit, capacity, now, worklogOf, manifestsOf, scope = null }) {
  const filesOf = g => filesOfDomains(lsFiles, contract, domainsOf(g.brief));
  const { pick: g, skipped } = pick({ goals, named, filesOf, scope });
  // Capacity is the FLEET's, not the Coordinator's: scoped Coordinators share
  // one roster and race for the same slots; the loser reports wait-capacity.
  const cap = capacityCheck(roster, capacity);
  const out = { pick: g ? g.lane : null, scope, skipped, capacity: cap, stale: pulseAge(audit, now, scope) };
  if (!g) return { action: 'idle', ...out };
  const sessions = audit.filter(e => e.by === 'pulse' && e.goal === g.lane && e.action === 'dispatch').length;
  out.kill = killCheck(g.brief, sessions);
  if (out.kill.tripped) return { action: 'kill', ...out };
  const step = g.items.find(i => !i.done && !i.you) || null;
  out.step = step ? { issue: step.issue, step: step.step, recipe: step.recipe || null, text: step.text || null, status: step.status || null } : null;
  if (g.status === 'review') {
    const ms = (manifestsOf(g, step) || []).slice().sort((a, b) => roundOf(a.path) - roundOf(b.path));
    const last = ms[ms.length - 1];
    if (!last) return { action: 'await-gate', ...out };
    out.manifest = { path: last.path, verdict: verdictOf(last.text) };
    const seen = audit.some(e => e.by === 'pulse' && e.action === 'verdict' && e.manifest === last.path);
    // An inconclusive that was already acted on (attention → cleared, goal back to review) re-runs the gate as R<r+1>.
    if (out.manifest.verdict === 'inconclusive' && seen) return { action: 'gate-rerun', ...out };
    return { action: 'verdict', ...out };
  }
  // A running goal is already routed and already dispatched — no need to
  // re-check its worklog for a ROUTE line; just wait on the resident pane.
  if (g.status === 'running') return { action: 'await-dev', ...out };
  if (!new RegExp(`^ROUTE: lane:${g.lane} `, 'm').test(worklogOf(g) || '')) return { action: 'route', ...out };
  if (!step) return { action: 'merge-gate', ...out };
  if (cap.full) return { action: 'wait-capacity', ...out };
  return { action: 'dispatch', ...out };
}

// The five-line dispatch proposal (d.29). Shown via AskUserQuestion under
// dispatch:"confirm"; written to the audit log under "auto". Pinned by the
// coordinator skill and tests/test-grammar.js — change both or neither.
function proposal(p) {
  const pad = k => (k + ':').padEnd(18);
  return [
    `${pad('goal/step')}${p.goal} · ${p.step} · #${p.item} · ${p.text}`,
    `${pad('role/tier/recipe')}${p.role} · ${p.tier} · ${p.recipe}`,
    `${pad('task')}${p.task}`,
    `${pad('domains/ship')}${p.domains.join(', ')} · ship:${p.ship} · review:${p.review}`,
    `${pad('caps')}fails ${p.fails}/3 · no-progress 2 · fleet ${p.fleet.count}/${p.fleet.capacity} · kill: ${p.kill || '—'}`,
  ].join('\n');
}
const paneName = (goal, step) => `impl-${goal}-${step}`;

// Pane launch: roster entry (v2 §3.1) under the roster lock, and — herdr
// only — the CLI calls. Under loop/native the skill spawns the Agent itself
// afterwards. ASSUMPTION VERIFIED against `herdr --help`/`herdr agent
// start --help`/`herdr agent wait --help` at execution: `agent start` has
// no `--env` (only --kind/--pane, attaching to an existing interactive
// pane); env is set at pane creation instead (`pane split --env K=V`), and
// wait is `herdr agent wait <target> --until …`. The session marker itself
// is plan 3's job: hooks/session-start.js materialises it from the pane's
// ORCH_ROLE/ORCH_IDS env once Claude's own session_id exists — this script
// never writes a marker file.
function launch({ commonDir, cwd, name, role, milestone, goal, step, tier, vehicle, brief, exec, now }) {
  const dir = path.join(commonDir, 'orch');
  fs.mkdirSync(dir, { recursive: true });
  const startedAt = new Date(now || Date.now()).toISOString();
  const roster = path.join(dir, 'fleet.json');
  withLock(path.join(dir, 'fleet.lock'), () => {
    let r = { delegates: [] };
    try { r = JSON.parse(fs.readFileSync(roster, 'utf8')); } catch { /* first entry */ }
    r.delegates = (r.delegates || []).filter(d => d.name !== name);
    r.delegates.push({ name, lane: goal, role: tier, vehicle, status: 'running', ownerSessionId: null, agentId: null, brief, createdAt: startedAt, lastSeen: startedAt });
    fs.writeFileSync(roster, JSON.stringify(r, null, 2) + '\n');
  });
  if (vehicle === 'herdr') {
    const ids = `${milestone}.${goal}.${step}`;
    const paneId = String(exec('herdr', ['pane', 'split', '--cwd', cwd || process.cwd(), '--env', `ORCH_ROLE=${role}`, '--env', `ORCH_IDS=${ids}`])).trim();
    exec('herdr', ['agent', 'start', name, '--kind', 'claude', '--pane', paneId]);
    exec('herdr', ['agent', 'prompt', name, fs.readFileSync(brief, 'utf8')]);
  }
  return { roster };
}

// No-progress detection, N = 2 (d.23): the last N hand-backs all had an empty
// diff, or all carried the same first error line.
function noProgress(history, N = 2) {
  const last = (history || []).slice(-N);
  if (last.length < N) return null;
  if (last.every(h => h.diffEmpty)) return `empty diff ${N}× in a row`;
  if (last[0].error && last.every(h => h.error === last[0].error)) return `same error ${N}× in a row: ${last[0].error}`;
  return null;
}
const tierUp = t => RANKS[Math.min(Math.max(RANKS.indexOf(t), 0) + 1, RANKS.length - 1)];
// Fix rounds count `fail` manifests only (spec §5); rounds 1–2 resume the
// resident, 3 = fresh one tier up (delegate.md), anything else = stall → Director.
function fixRound({ fails, history, tier }) {
  const stall = noProgress(history);
  if (stall) return { action: 'stall', reason: stall };
  if (fails <= 2) return { action: 'resume', tier };
  if (fails === 3) return { action: 'fresh', tier: tierUp(tier) };
  return { action: 'stall', reason: 'fail cap 3 reached' };
}
// Manifest verdict → the board-gh verb the Coordinator types (spec §4 item Status row).
function verdictAction({ verdict, goal, step, item, manifestPath }) {
  if (verdict === 'pass') return { cmd: `done --goal ${goal} --step ${step} ${item}`, next: 'next-step-or-merge-gate' };
  if (verdict === 'fail') return { cmd: `set-status ${item} "In progress"`, next: 'handback' };
  if (verdict === 'inconclusive') return { cmd: `attention ${goal} "inconclusive: ${manifestPath}"`, next: 'director' };
  return { cmd: null, next: `no verdict line in ${manifestPath}` };
}
const firstError = out => (out || '').split(/\r?\n/).find(l => /\b(FAIL|Error|error:|Exception|panic|BLOCKED)\b/.test(l)) || null;
// Ralphinho: a hand-back is never a bare retry — manifest reasons and the failing output travel with it.
function handback({ round, manifestText, failingOutput, conflicts }) {
  const reasons = /^reasons:/m.test(manifestText || '');
  if (!reasons && !(failingOutput || '').trim()) throw new Error('handback: nothing to hand back — a bare retry is refused; attach the failing output');
  return [`ROUND ${round}: FAIL`, '', (manifestText || '').trim(), '', '--- failing output ---', (failingOutput || '').trim(),
    ...(conflicts && conflicts.trim() ? ['', '--- conflict context ---', conflicts.trim()] : []), ''].join('\n');
}

// d.33: one branch per goal, from the ROUTE base: at first pick.
const branchName = (goal, name) => `goal/${goal}-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`;
// One PR per goal: title `G<k> · <name>`, body = BRIEF + links to every passing manifest.
function prText({ goal, name, brief, manifests }) {
  const passing = (manifests || []).filter(m => verdictOf(m.text) === 'pass').map(m => m.path).sort();
  if (!passing.length) throw new Error(`pr-text: ${goal} has no passing manifest — nothing to open a PR on`);
  return { title: `${goal} · ${name}`, body: `${brief.trim()}\n\n## Evidence\n${passing.map(p => `- ${p}`).join('\n')}\n` };
}
// §7 step 8: the summary line is judged by the Coordinator against done:; the script only checks completeness and writes it.
function milestoneSummary({ milestone, goals, line }) {
  const mine = goals.filter(g => g.milestone && g.milestone.number === Number(milestone));
  if (!mine.length) throw new Error(`milestone-summary: M${milestone} has no goals`);
  const open = mine.filter(g => g.status !== 'merged');
  if (open.length) throw new Error(`milestone-summary: not merged: ${open.map(g => g.lane).join(' ')}`);
  if (!line || !line.trim()) throw new Error('milestone-summary: --line "<one line against done:>" is required');
  return `M${milestone} · summary: ${line.trim()}\ngoals: ${mine.map(g => g.lane).join(' ')}\n`;
}

// /shepr:board FLEET footer (v2 §3.4): counted entries, ghost = running/reserved with lastSeen older than fleet.staleMinutes.
function fleetLines(roster, now = Date.now(), staleMinutes = 60) {
  return (((roster || {}).delegates) || []).filter(d => COUNTED.has(d.status)).map(d => {
    const age = Math.round((now - Date.parse(d.lastSeen || 0)) / 60000);
    return `${d.name} · ${d.lane} · ${d.role} · ${d.vehicle} · ${d.status} · ${age}m${age > staleMinutes ? ' 👻 ghost' : ''}`;
  });
}
// §5 residual: a Dev commit outside the goal's domains is not reviewed under this goal — list it for the Director.
function outOfScope(commits, goalPaths, otherPaths) {
  const goal = goalPaths.map(globToRe), other = otherPaths.map(globToRe), ev = EVIDENCE.map(globToRe);
  return commits.map(c => ({ sha: c.sha, files: c.files.map(f => f.replace(/\\/g, '/')).filter(f => !ev.some(r => r.test(f)) && !goal.some(r => r.test(f)) && other.some(r => r.test(f))) }))
    .filter(c => c.files.length);
}
function gitLogFiles(cwd, base) { // [{sha, files}] for base..HEAD
  const out = sh(cwd, 'git', ['log', `${base}..HEAD`, '--name-only', '--format=%H']);
  const commits = []; let cur = null;
  for (const line of out.split(/\r?\n/)) {
    if (/^[0-9a-f]{40}$/.test(line)) { cur = { sha: line, files: [] }; commits.push(cur); }
    else if (line.trim() && cur) cur.files.push(line.trim());
  }
  return commits;
}

// --- v0.10: anchor test + stale sweep (pure; the verbs below wire git/gh) -----------
// Anchor test (STRATEGY 5.2): a lane in an anchored domain may iterate only when its
// BRIEF names an anchor (PFD/OM value, conservation closure, textbook correlation) and
// a predicted delta on `metric:`. Otherwise it researches first. One Ruling line either way.
function anchorTest(brief, anchorDomains = []) {
  const doms = domainsOf(brief);
  // Fail closed: a BRIEF with no domains: line cannot be classified, so it is treated as anchored (a guard must never
  // silently switch itself off). Found on G2100, whose BRIEF predates the domains: line.
  if (!doms.length && anchorDomains.length) return { needed: true, ok: false, ruling: 'Ruling: anchor-test · research-first · BRIEF has no domains: line — add it (contract domain names), then re-run' };
  const needed = doms.some(d => anchorDomains.includes(d));
  if (!needed) return { needed, ok: true, ruling: `Ruling: anchor-test · n/a · domains ${doms.join(',')} are not anchored` };
  const anchor = (/^anchor:\s*(.+)$/m.exec(brief) || [])[1];
  const metric = (/^metric:\s*(.+)$/m.exec(brief) || [])[1] || '';
  const delta = /(→|->|\bto\b|from\b)/.test(metric) && /\d/.test(metric);
  if (anchor && anchor.trim() && delta) return { needed, ok: true, ruling: `Ruling: anchor-test · iterate · anchor "${anchor.trim()}" · predicted ${metric.trim()}` };
  const why = !anchor || !anchor.trim() ? 'no anchor: line in the BRIEF' : 'metric: has no predicted delta (write "<before> → <after>")';
  return { needed, ok: false, ruling: `Ruling: anchor-test · research-first · ${why}` };
}
// Stale sweep (STRATEGY 5.5): PRs idle over idleDays close as parked; branches already
// merged into the default branch are deleted. Unmerged branches are only ever listed.
const TRIAGE_STATES = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix'];
// An open issue with none of the five triage state labels is untriaged (intake rule; goals only open on ready-for-agent).
function untriaged(issues = []) {
  return issues.filter(i => !(i.labels || []).some(l => TRIAGE_STATES.includes(typeof l === 'string' ? l : l.name))).map(i => i.number);
}
function sweepPlan({ prs = [], branches = [], merged = [], issues = [], now = Date.now(), idleDays = 14, protect = [] }) {
  const cut = now - idleDays * 86400e3;
  const closePRs = prs.filter(p => new Date(p.updatedAt).getTime() < cut).map(p => ({ number: p.number, branch: p.headRefName, idleDays: Math.floor((now - new Date(p.updatedAt).getTime()) / 86400e3) }));
  const keep = new Set([...protect, ...prs.map(p => p.headRefName)]); // a branch with an open PR is never deleted
  const deleteBranches = merged.filter(b => branches.includes(b) && !keep.has(b) && /^(lane|goal)\//.test(b));
  const listOnly = branches.filter(b => /^(lane|goal)\//.test(b) && !merged.includes(b) && !keep.has(b));
  return { closePRs, deleteBranches, listOnly, untriaged: untriaged(issues) };
}

// --- v0.11: event-driven wake (firstmate's zero-token watcher) ----------------------
// A tick on a timer pays tokens for every quiet interval; last night's fleet ticked
// through hours where nothing moved. `wait` blocks INSIDE the script — no tokens — and
// returns the moment the fleet actually changes. The comparison is pure and testable;
// only the poll loop touches the world.
const SETTLED = /^(idle|done|blocked)$/;
// `roster` (lane names from fleet.json) is the fleet: `herdr agent list` is every pane in
// every workspace, including the caller, whose own turn-end (working -> done) woke the
// watcher the instant it was backgrounded. No roster = no lanes to wait for.
// `inbox` is the phone: lines the Telegram poller relayed to .orch/assistant-inbox.jsonl.
function snapshot({ agents = [], rulings = [], reviews = 0, inbox = [], roster = null } = {}) {
  const lanes = roster ? agents.filter(a => roster.includes(a.name)) : agents;
  return {
    agents: Object.fromEntries(lanes.map(a => [a.name || a.pane_id || '?', a.agent_status || '?'])),
    rulings: Object.fromEntries(rulings.map(r => [r.id, r.decided ? (r.decided.opt || 'decided') : 'open'])),
    reviews,
    inbox,
  };
}
// First change wins; a settled lane outranks a ruling, which outranks a new manifest, which outranks the phone.
function wakeReason(prev, now) {
  for (const [n, s] of Object.entries(now.agents)) {
    const was = prev.agents[n];
    if (was === undefined) return `${n} joined the fleet`;
    if (was !== s && SETTLED.test(s)) return `${n} ${was} -> ${s}`;
  }
  for (const n of Object.keys(prev.agents)) if (!(n in now.agents)) return `${n} left the fleet`;
  for (const [id, st] of Object.entries(now.rulings)) if (prev.rulings[id] === 'open' && st !== 'open') return `ruling ${id} decided (${st})`;
  if (now.reviews > prev.reviews) return `review manifest landed (${prev.reviews} -> ${now.reviews})`;
  if ((now.inbox || []).length > (prev.inbox || []).length) return `phone: ${now.inbox[now.inbox.length - 1]}`;
  return null;
}
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

// --- main -------------------------------------------------------------------------
function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opt[k] = argv[++i]; else opt[k] = true; }
    else pos.push(a);
  }
  return { pos, opt };
}
function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}
// The tick's milestone scope (one Coordinator per milestone): `--milestone
// M<n>` wins, else the pane's own session marker (materialised from
// ORCH_IDS by hooks/session-start.js). Unset — a plain unroled session —
// stays board-wide, which is the single-Coordinator behaviour.
function tickScope(opt, commonDir, env) {
  const flag = typeof opt.milestone === 'string' ? opt.milestone.trim() : null;
  if (flag) {
    if (!/^[MC]\d+$/.test(flag)) throw new Error(`--milestone must match M<n> or C<n>, got ${flag}`);
    return flag;
  }
  const sid = env.ORCH_SESSION_ID;
  if (!commonDir || !sid) return null;
  const marker = readMarker(commonDir, sid);
  return (marker && marker.milestone) || null;
}
function readRoster(commonDir) { try { return JSON.parse(fs.readFileSync(path.join(commonDir, 'orch', 'fleet.json'), 'utf8')); } catch { return { delegates: [] }; } }
function worklogPath(cwd, lane) {
  const dir = path.join(cwd, 'tmp', 'worklogs');
  try { const f = fs.readdirSync(dir).find(x => new RegExp(`^${lane}-.*\\.md$`).test(x)); return f ? path.join(dir, f) : null; } catch { return null; }
}
function manifestsFor(cwd, lane, step) {
  const dir = path.join(cwd, 'docs', 'reviews');
  try {
    return fs.readdirSync(dir).filter(f => new RegExp(`^M\\d+\\.${lane}\\.${step}\\.R\\d+\\.md$`).test(f))
      .map(f => ({ path: `docs/reviews/${f}`, text: fs.readFileSync(path.join(dir, f), 'utf8') }));
  } catch { return []; }
}

function main(argv, deps = {}) {
  const cwd = deps.cwd || process.cwd();
  const stdout = deps.stdout || (s => process.stdout.write(s));
  const now = deps.now || Date.now();
  const { pos, opt } = parseArgs(argv);
  const verb = pos[0];
  const commonDir = deps.commonDir || resolveRepoKey(cwd);
  const cfg = deps.config || loadConfig({ cwd });
  const board = () => { try { return deps.board ? deps.board() : require('./board-gh').readBoard(require('./lib/gh').makeGh(), require('./board-gh').loadCfg(cwd)); } catch (e) { throw new Error(`board unreachable: ${e.message}`); } };
  const VERBS = {
    tick() {
      let b;
      try { b = board(); } catch (e) { stdout(`coordinator: ${e.message}\n`); return 1; }
      const lsFiles = deps.lsFiles ? deps.lsFiles() : sh(cwd, 'git', ['ls-files']).split(/\r?\n/).filter(Boolean);
      let scope;
      try { scope = tickScope(opt, commonDir, deps.env || process.env); } catch (e) { stdout(`tick: ${e.message}
`); return 1; }
      let t;
      try {
        t = tick({ goals: b.goals, named: pos[1], contract: cfg.contract || { domains: {} }, lsFiles, roster: readRoster(commonDir), audit: readAudit(cwd),
          capacity: (cfg.fleet && cfg.fleet.capacity) || 6, now, scope,
          worklogOf: g => { const p = worklogPath(cwd, g.lane); return p ? fs.readFileSync(p, 'utf8') : ''; },
          manifestsOf: (g, step) => (step ? manifestsFor(cwd, g.lane, step.step) : []) });
      } catch (e) { stdout(`tick: ${e.message}
`); return 1; }
      if (!opt['no-pulse']) appendAudit(cwd, { by: 'pulse', goal: t.pick, action: t.action, tick: new Date(now).toISOString(), ...(scope ? { milestone: scope } : {}), ...(t.manifest ? { manifest: t.manifest.path } : {}) });
      stdout(JSON.stringify(t, null, 2) + '\n');
      return 0;
    },
    proposal() {
      const need = ['goal', 'step', 'item', 'text', 'role', 'tier', 'recipe', 'task', 'domains', 'ship', 'review'];
      for (const k of need) if (typeof opt[k] !== 'string' || !opt[k]) { stdout(`proposal: --${k} <value> is required\n`); return 1; }
      const p = { ...opt, domains: opt.domains.split(/[,\s]+/).filter(Boolean), fails: Number(opt.fails || 0), kill: typeof opt.kill === 'string' ? opt.kill : null,
        fleet: capacityCheck(readRoster(commonDir), (cfg.fleet && cfg.fleet.capacity) || 6) };
      const lines = proposal(p).split('\n');
      appendAudit(cwd, { by: 'dispatch', mode: opt.mode === 'auto' ? 'auto' : 'confirm', goal: opt.goal, step: opt.step, lines });
      stdout(lines.join('\n') + '\n');
      return 0;
    },
    launch() {
      const name = pos[1];
      for (const k of ['role', 'goal', 'step', 'milestone', 'tier', 'vehicle', 'brief']) if (typeof opt[k] !== 'string' || !opt[k]) { stdout(`launch: --${k} <value> is required\n`); return 1; }
      if (!name) { stdout('usage: launch <pane name> --role … --goal … --step … --milestone … --tier … --vehicle loop|herdr --brief <file>\n'); return 1; }
      const r = launch({ commonDir, cwd, name, role: opt.role, milestone: opt.milestone, goal: opt.goal, step: opt.step, tier: opt.tier, vehicle: opt.vehicle, brief: opt.brief,
        exec: deps.exec || ((c, a) => sh(cwd, c, a)), now });
      stdout(`${r.roster}\n`);
      return 0;
    },
    handback() {
      for (const k of ['goal', 'step', 'round', 'output']) if (typeof opt[k] !== 'string') { stdout(`handback: --${k} <value> is required\n`); return 1; }
      const m = manifestsFor(cwd, opt.goal, opt.step).find(x => x.path.endsWith(`.${opt.round}.md`));
      const failing = fs.existsSync(opt.output) ? fs.readFileSync(opt.output, 'utf8') : '';
      const conflicts = typeof opt.conflicts === 'string' && fs.existsSync(opt.conflicts) ? fs.readFileSync(opt.conflicts, 'utf8') : '';
      let text;
      try { text = handback({ round: opt.round, manifestText: m ? m.text : '', failingOutput: failing, conflicts }); } catch (e) { stdout(e.message + '\n'); return 1; }
      const diffEmpty = opt['diff-empty'] === true || opt['diff-empty'] === 'true';
      appendAudit(cwd, { by: 'handback', goal: opt.goal, step: opt.step, round: opt.round, error: firstError(failing), diffEmpty });
      stdout(text);
      return 0;
    },
    'fix-round'() {
      for (const k of ['goal', 'step', 'tier']) if (typeof opt[k] !== 'string') { stdout(`fix-round: --${k} <value> is required\n`); return 1; }
      const fails = manifestsFor(cwd, opt.goal, opt.step).filter(m => verdictOf(m.text) === 'fail').length;
      const history = readAudit(cwd).filter(e => e.by === 'handback' && e.goal === opt.goal && e.step === opt.step).map(e => ({ error: e.error, diffEmpty: !!e.diffEmpty }));
      stdout(JSON.stringify({ fails, ...fixRound({ fails, history, tier: opt.tier }) }) + '\n');
      return 0;
    },
    verdict() {
      for (const k of ['goal', 'step', 'item']) if (typeof opt[k] !== 'string') { stdout(`verdict: --${k} <value> is required\n`); return 1; }
      const ms = manifestsFor(cwd, opt.goal, opt.step).sort((a, b) => roundOf(a.path) - roundOf(b.path));
      const last = ms[ms.length - 1];
      if (!last) { stdout(`verdict: no manifest for ${opt.goal} ${opt.step} under docs/reviews/\n`); return 1; }
      const v = verdictAction({ verdict: verdictOf(last.text), goal: opt.goal, step: opt.step, item: opt.item, manifestPath: last.path });
      appendAudit(cwd, { by: 'pulse', goal: opt.goal, action: 'verdict', manifest: last.path, tick: new Date(now).toISOString() });
      stdout(JSON.stringify({ manifest: last.path, verdict: verdictOf(last.text), ...v }) + '\n');
      return v.cmd ? 0 : 1;
    },
    'pr-text'() {
      const lane = String(pos[1] || '').toUpperCase();
      if (!/^G\d+$/.test(lane)) { stdout('usage: pr-text G<k>\n'); return 1; }
      let g; try { g = board().goals.find(x => x.lane === lane); } catch (e) { stdout(`coordinator: ${e.message}\n`); return 1; }
      if (!g) { stdout(`pr-text: ${lane} is not on the board\n`); return 1; }
      const dir = path.join(cwd, 'docs', 'reviews');
      let ms = []; try { ms = fs.readdirSync(dir).filter(f => new RegExp(`^M\\d+\\.${lane}\\.S\\d+\\.R\\d+\\.md$`).test(f)).map(f => ({ path: `docs/reviews/${f}`, text: fs.readFileSync(path.join(dir, f), 'utf8') })); } catch { /* none */ }
      try { const t = prText({ goal: lane, name: g.name, brief: g.brief, manifests: ms }); stdout(`${t.title}\n\n${t.body}`); return 0; }
      catch (e) { stdout(e.message + '\n'); return 1; }
    },
    'milestone-summary'() {
      const m = /^M?(\d+)$/i.exec(pos[1] || '');
      if (!m || typeof opt.line !== 'string') { stdout('usage: milestone-summary M<n> --line "<one line against done:>"\n'); return 1; }
      let text; try { text = milestoneSummary({ milestone: Number(m[1]), goals: board().goals, line: opt.line }); } catch (e) { stdout(e.message + '\n'); return 1; }
      const p = path.join(cwd, 'tmp', 'handoffs', `M${m[1]}-coordinator.md`);
      fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text);
      stdout(`${path.relative(cwd, p).replace(/\\/g, '/')}\n`);
      return 0;
    },
    anchor() {
      const lane = (pos[1] || '').toUpperCase();
      if (!/^G\d+$/.test(lane)) { stdout('usage: anchor G<n>  — prints (and appends to the worklog) the anchor-test Ruling line\n'); return 1; }
      const wl = worklogPath(cwd, lane);
      if (!wl) { stdout(`coordinator: no worklog for ${lane} under tmp/worklogs/\n`); return 1; }
      const text = fs.readFileSync(wl, 'utf8');
      const doms = (cfg.workflow && cfg.workflow.anchorTest && cfg.workflow.anchorTest.domains) || [];
      const r = anchorTest(text, doms);
      if (!/^Ruling: anchor-test/m.test(text)) fs.appendFileSync(wl, `${text.endsWith('\n') ? '' : '\n'}${r.ruling}\n`);
      stdout(r.ruling + '\n');
      return r.ok ? 0 : 2; // 2 = research first
    },
    wait() {
      const timeout = Number(opt.timeout || (cfg.fleet && cfg.fleet.waitTimeoutSeconds) || 1800) * 1000;
      const poll = Math.max(5, Number(opt.poll || (cfg.fleet && cfg.fleet.waitPollSeconds) || 20)) * 1000;
      const listCmd = (cfg.fleetContext && cfg.fleetContext.listCmd) || 'herdr agent list';
      const read = () => {
        let agents = [], rulings = [], reviews = 0, inbox = [];
        try {
          const out = deps.fleetList ? deps.fleetList() : sh(cwd, listCmd.split(' ')[0], listCmd.split(' ').slice(1));
          const j = JSON.parse(out);
          agents = (j.result && j.result.agents) || j.agents || [];
        } catch {}
        const roster = (readRoster(commonDir).delegates || []).map(d => d.name);
        try { rulings = JSON.parse(fs.readFileSync(path.join(cwd, '.orch', 'owner-queue.json'), 'utf8')).rulings || []; } catch {}
        try { reviews = fs.readdirSync(path.join(cwd, 'docs', 'reviews')).filter(f => /\.md$/.test(f)).length; } catch {}
        try { inbox = fs.readFileSync(path.join(cwd, '.orch', 'assistant-inbox.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l).text; } catch { return l; } }); } catch {}
        return snapshot({ agents, rulings, reviews, inbox, roster });
      };
      const nap = deps.sleep || sleepSync;
      // ONE clock: reading `started` from `now` while elapsed came from deps.clock made
      // elapsed negative forever and the watcher never timed out.
      const clock = deps.clock || Date.now;
      const started = clock();
      let prev = read();
      for (;;) {
        const elapsed = clock() - started;
        if (elapsed >= timeout) { stdout(`wake: timeout after ${Math.round(elapsed / 1000)}s · fleet ${Object.keys(prev.agents).length} · nothing moved\n`); return 0; }
        nap(Math.min(poll, timeout - elapsed));
        const cur = read();
        const why = wakeReason(prev, cur);
        if (why) { stdout(`wake: ${why} · after ${Math.round((clock() - started) / 1000)}s\n`); return 0; }
        prev = cur;
      }
    },
    sweep() {
      const idleDays = Number(opt['idle-days'] || (cfg.board && cfg.board.sweepIdleDays) || 14);
      let prs = [], branches = [], merged = [], issues = [], def = 'main';
      try {
        try { def = sh(cwd, 'git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).trim().split('/').pop() || 'main'; } catch { def = 'main'; }
        prs = deps.prs ? deps.prs() : JSON.parse(sh(cwd, 'gh', ['pr', 'list', '--state', 'open', '--limit', '100', '--json', 'number,updatedAt,headRefName,title']));
        branches = sh(cwd, 'git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']).split(/\r?\n/).filter(Boolean);
        merged = sh(cwd, 'git', ['branch', '--merged', def, '--format=%(refname:short)']).split(/\r?\n/).filter(Boolean);
        issues = deps.issues ? deps.issues() : JSON.parse(sh(cwd, 'gh', ['issue', 'list', '--state', 'open', '--limit', '500', '--json', 'number,labels']));
      } catch (e) { stdout(`coordinator: sweep needs git + gh: ${e.message}\n`); return 1; }
      const plan = sweepPlan({ prs, branches, merged, issues, now, idleDays, protect: [def] });
      if (opt.apply) {
        for (const p of plan.closePRs) sh(cwd, 'gh', ['pr', 'close', String(p.number), '--comment', `parked: idle ${p.idleDays} days (weekly sweep); reopen when its objective picks it up`]);
        for (const b of plan.deleteBranches) sh(cwd, 'git', ['branch', '-d', b]);
      }
      const line = `sweep: ${opt.apply ? 'applied' : 'proposed'} · close ${plan.closePRs.length} PR(s) idle >${idleDays}d · delete ${plan.deleteBranches.length} merged branch(es) · ${plan.listOnly.length} unmerged lane branch(es) left for the Director · ${plan.untriaged.length} open issue(s) without a triage state`;
      stdout(JSON.stringify({ line, ...plan }, null, 2) + '\n');
      appendAudit(cwd, { by: 'pulse', timestamp: new Date(now).toISOString(), action: 'sweep', applied: !!opt.apply, closePRs: plan.closePRs.map(p => p.number), deleteBranches: plan.deleteBranches });
      return 0;
    },
    fleet() {
      const roster = readRoster(commonDir);
      const audit = readAudit(cwd);
      const age = pulseAge(audit, now);
      const staleAfter = (cfg.fleet && cfg.fleet.pulseStaleMinutes) || 30;
      const contract = cfg.contract || { domains: {} };
      const pathsOf = names => names.flatMap(d => ((contract.domains[d] || {}).paths) || []);
      let goals = []; try { goals = board().goals; } catch (e) { stdout(`coordinator: ${e.message}\n`); return 1; }
      const oos = {};
      for (const g of goals.filter(x => x.status === 'running')) {
        const wl = worklogPath(cwd, g.lane); const text = wl ? fs.readFileSync(wl, 'utf8') : '';
        const base = (new RegExp(`^ROUTE: lane:${g.lane} .*· base:([0-9a-f]+)`, 'm').exec(text) || [])[1];
        if (!base) continue;
        const mine = domainsOf(g.brief), others = Object.keys(contract.domains).filter(d => !mine.includes(d));
        const commits = deps.gitLog ? deps.gitLog(base) : gitLogFiles(cwd, base);
        const hits = outOfScope(commits, pathsOf(mine), pathsOf(others));
        if (hits.length) oos[g.lane] = hits;
      }
      stdout(JSON.stringify({ fleet: fleetLines(roster, now, (cfg.fleet && cfg.fleet.staleMinutes) || 60), pulse: { age, stale: age === null || age > staleAfter }, outOfScope: oos }, null, 2) + '\n');
      return 0;
    },
  };
  if (!verb || !VERBS[verb]) { stdout('usage: coordinator <tick [G<n>] [--milestone M<n>] [--no-pulse]|proposal|launch|fix-round|verdict|pr-text|milestone-summary|fleet|anchor G<n>|sweep [--apply] [--idle-days N]|wait [--timeout S] [--poll S]> …\n'); return 1; }
  return VERBS[verb]() || 0;
}
if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { EVIDENCE, briefLine, domainsOf, filesOfDomains, pick, killCheck, capacityCheck, readAudit, pulseAge, tick, tickScope, main, proposal, paneName, launch,
  noProgress, fixRound, verdictAction, handback, firstError, branchName, prText, milestoneSummary, fleetLines, outOfScope, anchorTest, sweepPlan, untriaged, TRIAGE_STATES, snapshot, wakeReason };
