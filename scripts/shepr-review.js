#!/usr/bin/env node
// shepr review — the gate (spec §5). A script, not a skill: the brief is
// code. `shepr review G<k> --step S<j>` or `--plan`.
//   refuses: dirty tree under the goal's paths (frozen BRIEF, before any
//   range), dual review without models.review-alt, no models.review;
//   computes FROZEN / base / head / paths / slots / tier through the same
//   module the ship-gate lint uses; copies the rubrics content-addressed;
//   sets the item In review (board-gh); registers a roster entry; runs the
//   tests on a detached worktree under <git-common-dir>/orch/wt/<id>/;
//   spawns one reviewer per slot with ORCH_ROLE=reviewer in the CHILD env;
//   writes slot files + the manifest; commits `-- docs/reviews` only.
'use strict';
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const L = require('../hooks/lib/evidence-lint');
const { withLock } = require('./lib/lockfile');

const SANTA = 'You have NOT seen any other review. Your job is to find problems, not to approve.';
const REPLY = 'Reply with exactly one `verdict: pass|fail|inconclusive` line, then `reasons:` (each citing done: or the step\'s accept:), then `notes:`.';

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, '-c', 'core.quotePath=false', ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).toString();
}
function defaultSpawn({ model, brief, cwd, env, template }) {
  // `review.spawn`: a string template for every model, or an object keyed by
  // model name with `*` as the default — a second family (Codex) has its own CLI.
  const tpl = template && typeof template === 'object' ? (template[model] || template['*']) : template;
  const cmd = (tpl || 'claude -p --model {model} --output-format text').replace('{model}', model);
  return execSync(cmd, { input: brief, cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 1800000, maxBuffer: 64 * 1024 * 1024 });
}
function roster(commonDir, fn) {
  // Spec §4 fleet roster row: the script adds/removes its own entry (ADVISORY).
  const p = path.join(commonDir, 'orch', 'fleet.json');
  withLock(path.join(commonDir, 'orch', 'fleet.lock'), () => {
    let r = { delegates: [] };
    try { r = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    r.delegates = fn(r.delegates || []);
    fs.writeFileSync(p, JSON.stringify(r, null, 2) + '\n');
  });
}
function buildBrief(o) {
  const parts = [`# GATE REVIEW ${o.id}`, `range: ${o.base}..${o.head}`, o.paths ? `paths: ${o.paths.join(' ')}` : 'paths: (plan round — no diff)', '', SANTA, REPLY, ''];
  for (const r of o.rubrics) parts.push(`## RUBRIC ${r.name}.md@${r.h}`, r.body, '');
  parts.push('## BRIEF', o.brief, '');
  if (o.accept) parts.push('## STEP', `step: ${o.step}`, `accept: ${o.accept}`, '');
  parts.push('## HANDOFF', o.handoff, '');
  if (o.plan) parts.push('## PLAN SECTION (worklog at HEAD)', o.planText, '');
  else parts.push('## TEST OUTPUT', o.testOut, '', '## DIFF', o.diff || '(empty diff)', '');
  return parts.join('\n');
}

function main(argv, deps = {}) {
  const cwd = deps.cwd || process.cwd();
  const stdout = deps.stdout || (s => process.stdout.write(s));
  const say = s => stdout(s + '\n');
  const gm = /^G(\d+)$/i.exec(argv[0] || '');
  const si = argv.indexOf('--step');
  const stepArg = si >= 0 ? argv[si + 1] : null;
  const plan = argv.includes('--plan');
  if (!gm || (plan && si >= 0) || (!plan && !/^S\d+$/.test(stepArg || ''))) { say('usage: shepr review G<k> --step S<j> | --plan'); return 1; }
  const goalN = Number(gm[1]);
  let root; try { root = git(cwd, ['rev-parse', '--show-toplevel']).trim(); } catch { say('shepr review: not inside a git repository'); return 1; }
  const g = args => git(root, args);
  const commonDir = deps.commonDir || require('../hooks/lib/config').resolveRepoKey(root);
  const cfg = deps.cfg || require('../hooks/lib/config').loadConfig({ cwd: root });
  const contract = cfg.contract, models = cfg.models || {};
  if (!contract || !contract.domains || !Object.keys(contract.domains).length) { say('shepr review: no contract — run /shepr:setup'); return 1; }
  // FROZEN — domains: and base: as of the commit that introduced the ROUTE line (spec §5).
  const fz = L.frozen(g, goalN, contract);
  if (fz.miss) { say(`shepr review: ${fz.miss}`); return 1; }
  // Dirty tree under the goal's paths, before any range exists (spec §3, r8 S2).
  const dirty = g(['status', '--porcelain', '--', ...fz.paths]).trim();
  if (dirty) { say(`shepr review: dirty tree under goal paths — commit first (ship: none → the Director commits):\n${dirty}`); return 1; }
  const slots = L.slotsFor(contract, fz.domains);
  if (slots === 2 && !models['review-alt']) { say('shepr review: dual review (a frozen domain carries review: "dual") but models.review-alt is not configured — /shepr:setup asks for it; refusing rather than running single'); return 1; }
  if (!models.review) { say('shepr review: models.review is not configured — /shepr:setup'); return 1; }
  const tier = L.reviewTier(contract, fz.domains);
  // Board — item and milestone come from the board once; the manifest carries them so the lint never asks GitHub.
  const bg = require('./board-gh');
  const bcfg = bg.loadCfg(cwd);
  if (!bcfg) { say('shepr review: no usable .orch/board.json — run /shepr:board init'); return 1; }
  const gh = deps.gh || require('./lib/gh').makeGh();
  let goal; try { goal = bg.readBoard(gh, bcfg).goals.find(x => x.issue === goalN); } catch (e) { say(`shepr review: board unreachable — ${e.message}`); return 1; }
  if (!goal) { say(`shepr review: no goal G${goalN} on the board`); return 1; }
  const item = plan ? null : goal.items.find(i => i.step === stepArg);
  if (!plan && !item) { say(`shepr review: G${goalN} has no step ${stepArg}`); return 1; }
  const M = goal.milestone ? goal.milestone.number : 0;
  const unit = plan ? 'P' : stepArg;
  const revDir = path.join(root, 'docs', 'reviews');
  fs.mkdirSync(path.join(revDir, 'rubrics'), { recursive: true });
  const reNum = new RegExp(`^M${M}\\.G${goalN}\\.${unit}\\.R(\\d+)\\.md$`);
  const R = fs.readdirSync(revDir).map(f => reNum.exec(f)).filter(Boolean).reduce((x, m) => Math.max(x, Number(m[1])), 0) + 1;
  const id = `M${M}.G${goalN}.${unit}.R${R}`;
  // Range: base = latest passing step manifest by ancestry, else the frozen ROUTE base; head = HEAD now.
  const ch = L.chain(g, L.manifests(g, goalN));
  if (ch.miss) { say(`shepr review: ${ch.miss}`); return 1; }
  const base = plan ? fz.base : (ch.chain.length ? ch.chain[ch.chain.length - 1].head : fz.base);
  const head = plan ? fz.base : g(['rev-parse', 'HEAD']).trim();
  // Rubrics: review-goal always; the step's recipe rubric (or spec for a plan round) when the file exists.
  const rubricDir = deps.rubricDir || path.join(__dirname, '..', 'skills', 'go', 'recipes');
  const names = ['review-goal', ...(plan ? ['spec'] : item.recipe ? [item.recipe] : [])].filter(nm => fs.existsSync(path.join(rubricDir, `${nm}.md`)));
  if (!names.includes('review-goal')) { say(`shepr review: rubric review-goal.md not found under ${rubricDir}`); return 1; }
  const rubrics = names.map(nm => {
    const body = fs.readFileSync(path.join(rubricDir, `${nm}.md`), 'utf8'); const h = L.sha256(body);
    const copy = path.join(revDir, 'rubrics', `${nm}.${h}.md`);
    if (!fs.existsSync(copy)) fs.writeFileSync(copy, body);
    return { name: nm, h, body };
  });
  const rubricLine = rubrics.map(r => `${r.name}.md@${r.h}`).join(' + ');
  const handoffRel = plan ? `tmp/handoffs/M${M}.G${goalN}-architect.md` : `tmp/handoffs/M${M}.G${goalN}.${stepArg}-dev.md`;
  const handoff = fs.existsSync(path.join(root, handoffRel)) ? fs.readFileSync(path.join(root, handoffRel), 'utf8') : `(no handoff at ${handoffRel})`;
  const diff = plan ? '' : g(['diff', `${base}..${head}`, '--', ...fz.paths, ...L.EVIDENCE.map(e => `:(exclude)${e.replace(/\/\*\*$/, '')}`)]);
  // A plan round reviews the plan section, which the Architect commits after the ROUTE line — so the worklog at HEAD, while range stays base..base.
  const planText = plan ? g(['show', `HEAD:${fz.path}`]) : '';
  // Board: item In review at launch (spec §4 item Status row).
  if (item) {
    const rc = bg.main(['set-status', String(item.issue), 'In review'], { cwd, gh, commonDir, stdout: () => {}, lockCfg: deps.lockCfg, env: {} });
    if (rc !== 0) { say(`shepr review: board-gh set-status #${item.issue} "In review" failed`); return 1; }
  }
  const now = new Date().toISOString();
  const entry = { name: `review-${id}`, lane: `G${goalN}`, role: 'reviewer', vehicle: 'subprocess', status: 'running', ownerSessionId: deps.sessionId || process.env.CLAUDE_SESSION_ID || null, createdAt: now, lastSeen: now };
  roster(commonDir, d => [...d.filter(x => x.name !== entry.name), entry]);
  const wt = path.join(commonDir, 'orch', 'wt', id);
  fs.mkdirSync(path.dirname(wt), { recursive: true });
  const results = [];
  try {
    g(['worktree', 'add', '--detach', wt, head]);
    let testOut = '(plan round — no tests)';
    if (!plan) {
      const testCmd = deps.testCmd || (cfg.review && cfg.review.testCmd) || 'npm test';
      try { testOut = `exit 0\n${execSync(testCmd, { cwd: wt, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000, maxBuffer: 64 * 1024 * 1024 })}`; }
      catch (e) { testOut = `exit ${e.status == null ? '?' : e.status}\n${e.stdout || ''}${e.stderr || ''}`; }
      testOut = testOut.split(/\r?\n/).slice(-200).join('\n');
    }
    const brief = buildBrief({ id, base, head, paths: plan ? null : fz.paths, rubrics, brief: goal.brief, step: unit, accept: item ? item.accept : null, handoff, plan, planText, testOut, diff });
    const slotHeader = `review: ${id}\nrubric: ${rubricLine}\nrange: ${base}..${head}\n${plan ? '' : `paths: ${fz.paths.join(' ')}\n`}`;
    const env = { ...process.env, ORCH_ROLE: 'reviewer' }; // explicit child env — a spawner sets it (spec §3)
    const spawn = deps.spawn || defaultSpawn;
    const fallbacks = [];
    for (let k = 1; k <= slots; k++) {
      const locked = k === 1 ? models.review : models['review-alt'];
      let model = locked, out = null, reason = null;
      const attempt = m => { try { return String(spawn({ model: m, tier, brief, cwd: wt, env, slot: k, template: cfg.review && cfg.review.spawn })); } catch (e) { reason = (e && e.message || 'spawn failed').split('\n')[0].slice(0, 80); return null; } };
      out = attempt(locked);
      let vm = out && /^verdict:\s*(pass|fail|inconclusive)\b.*$/m.exec(out);
      // v0.9.0: the locked model failed to produce a verdict (quota, CLI error,
      // no verdict line) → models.review-fallback stands in AUTOMATICALLY and the
      // manifest says so; the lint accepts exactly that substitution.
      if (!vm && models['review-fallback'] && models['review-fallback'] !== locked) {
        if (!reason) reason = out ? 'no verdict line' : 'spawn failed';
        model = models['review-fallback'];
        out = attempt(model);
        vm = out && /^verdict:\s*(pass|fail|inconclusive)\b.*$/m.exec(out);
        fallbacks.push(`fallback: slot-${k} ${locked} → ${model} (${reason})`);
      }
      const verdict = vm ? vm[1] : 'missing';
      const file = `${id}-${k}.md`;
      // Strip the reviewer's own verdict line AND the newline right after it,
      // so removing it never leaves a blank line where it stood.
      const body = vm ? (out.slice(0, vm.index) + out.slice(vm.index + vm[0].length).replace(/^\n/, '')).replace(/^\n+/, '').trimEnd() : '';
      if (vm) fs.writeFileSync(path.join(revDir, file), `${slotHeader}verdict: ${verdict}\n${body}\n`);
      results.push({ file, model, verdict });
    }
    results.fallbacks = fallbacks;
  } finally {
    try { g(['worktree', 'remove', '--force', wt]); } catch {}
    roster(commonDir, d => d.filter(x => x.name !== entry.name));
  }
  const verdict = L.aggregate(results.map(r => r.verdict));
  const manifest = [`review: ${id}`, `goal: G${goalN} · step: ${unit} · item: ${item ? `#${item.issue}` : '-'}`, `rubric: ${rubricLine}`, `range: ${base}..${head}`,
    ...(plan ? [] : [`paths: ${fz.paths.join(' ')}`]), `slots: ${slots}`,
    ...results.map((r, i) => `slot-${i + 1}: ${r.file} · ${r.model} · ${tier} · ${r.verdict}`), ...(results.fallbacks || []), `verdict: ${verdict}`].join('\n') + '\n';
  fs.writeFileSync(path.join(revDir, `${id}.md`), manifest);
  // Evidence-only commit: pathspec-limited in code (script-enforced, spec §5).
  g(['add', '--', 'docs/reviews']);
  g(['commit', '-q', '-m', `review: ${id} ${verdict}`, '--', 'docs/reviews']);
  say(`${id} ${verdict} → docs/reviews/${id}.md`);
  return verdict === 'pass' ? 0 : verdict === 'fail' ? 1 : 3;
}

module.exports = { main, buildBrief, SANTA, REPLY };
if (require.main === module) process.exit(main(process.argv.slice(2)));
