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
function pick({ goals, named, filesOf }) {
  const skipped = [];
  const running = goals.filter(g => g.status === 'running').map(g => ({ lane: g.lane, files: new Set(filesOf(g)) }));
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
function pulseAge(audit, now = Date.now()) {
  const last = audit.filter(e => e.by === 'pulse').pop();
  return last ? Math.round((now - Date.parse(last.ts)) / 60000) : null;
}

const roundOf = p => Number((/\.R(\d+)\.md$/.exec(p) || [0, 0])[1]);
const verdictOf = text => (/^verdict:\s*(pass|fail|inconclusive)/m.exec(text || '') || [])[1] || null;

// One tick, one action (spec §7 step 2). Pure: every source is an input.
function tick({ goals, named, contract, lsFiles, roster, audit, capacity, now, worklogOf, manifestsOf }) {
  const filesOf = g => filesOfDomains(lsFiles, contract, domainsOf(g.brief));
  const { pick: g, skipped } = pick({ goals, named, filesOf });
  const cap = capacityCheck(roster, capacity);
  const out = { pick: g ? g.lane : null, skipped, capacity: cap, stale: pulseAge(audit, now) };
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
  const VERBS = {
    tick() {
      let board;
      try { board = deps.board ? deps.board() : require('./board-gh').readBoard(require('./lib/gh').makeGh(), require('./board-gh').loadCfg(cwd)); }
      catch (e) { stdout(`coordinator: board unreachable: ${e.message}\n`); return 1; }
      const lsFiles = deps.lsFiles ? deps.lsFiles() : sh(cwd, 'git', ['ls-files']).split(/\r?\n/).filter(Boolean);
      const t = tick({ goals: board.goals, named: pos[1], contract: cfg.contract || { domains: {} }, lsFiles, roster: readRoster(commonDir), audit: readAudit(cwd),
        capacity: (cfg.fleet && cfg.fleet.capacity) || 6, now,
        worklogOf: g => { const p = worklogPath(cwd, g.lane); return p ? fs.readFileSync(p, 'utf8') : ''; },
        manifestsOf: (g, step) => (step ? manifestsFor(cwd, g.lane, step.step) : []) });
      if (!opt['no-pulse']) appendAudit(cwd, { by: 'pulse', goal: t.pick, action: t.action, tick: new Date(now).toISOString(), ...(t.manifest ? { manifest: t.manifest.path } : {}) });
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
  };
  if (!verb || !VERBS[verb]) { stdout('usage: coordinator <tick [G<n>] [--no-pulse]|proposal|launch|fix-round|verdict|pr-text|milestone-summary|fleet> …\n'); return 1; }
  return VERBS[verb]() || 0;
}
if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { EVIDENCE, briefLine, domainsOf, filesOfDomains, pick, killCheck, capacityCheck, readAudit, pulseAge, tick, main, proposal, paneName, launch,
  noProgress, fixRound, verdictAction, handback, firstError };
