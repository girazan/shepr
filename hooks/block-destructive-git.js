// PreToolUse (Bash|PowerShell) — blocks destructive git operations.
// BLOCKING hook: fail-CLOSED on oversized/unverifiable payloads — a >1MB
// shell command is never legitimate, and failing open would waive the guard
// exactly when input is abnormal.
// Deliberately matches tokens anywhere inside one shell segment (no |;&
// crossing), so `git -C repo reset --hard`, `git.exe`, and long-form flags
// are caught — at the cost of blocking commands that merely QUOTE trigger
// words. The human operator overrides by running the command themselves.
// Denial-ordinal dampening: after 3 full denials per session, messages
// condense to one line so repeated blocks can't flood the context window.
'use strict';
const fs = require('fs');
const { readStdin, loadConfig, tmpMark } = require('./lib/config');

const { j, oversized } = readStdin();
if (oversized) {
  console.error('BLOCKED (shepr): oversized hook payload — command unverifiable, refusing.');
  process.exit(2);
}
if (!j) process.exit(0);
const cmd = (j.tool_input && (j.tool_input.command || '')) || '';
if (!cmd) process.exit(0);

const full = loadConfig(j);
if (full.__lockCorrupt) {
  // The operator locked guards and the lock is unreadable: their authority
  // is unrecoverable, so fail CLOSED rather than run ungated (spec §1).
  console.error('BLOCKED (shepr): ~/.claude/orch-lock.json is corrupt — locked guard authority unrecoverable. Fix the lock file.');
  process.exit(2);
}
const cfg = full.destructiveGit || {};
if (cfg.enabled === false) process.exit(0);

const SEG = '[^\\n|;&]*';
const G = '\\bgit(?:\\.exe)?\\b' + SEG;
const rules = [
  [new RegExp(G + '\\bpush\\b' + SEG + '(\\s--force(-with-lease)?\\b|\\s-f\\b)'), 'git push --force'],
  [new RegExp(G + '\\breset\\b' + SEG + '--hard'), 'git reset --hard'],
  [new RegExp(G + '\\bbranch\\b' + SEG + '\\s-D\\b'), 'git branch -D'],
  [new RegExp(G + '\\bclean\\b' + SEG + '\\s(-\\w*f|--force)'), 'git clean -f/--force'],
  [new RegExp(G + '\\bstash\\s+(pop|drop|clear)\\b'), 'git stash pop/drop/clear (refs/stash is SHARED across every worktree)'],
  [new RegExp(G + '\\b(checkout|restore)\\b' + SEG + '\\s(--\\s+)?\\.\\/?(\\s|$)'), 'git checkout/restore . (mass discard of working tree)'],
  // Remote ships that bypass any local git gate (round-3 review):
  [new RegExp('\\bgh\\b' + SEG + '\\bpr\\b' + SEG + '\\bmerge\\b'), 'gh pr merge (remote merge)'],
  [new RegExp('\\bgh\\b' + SEG + '\\bapi\\b' + SEG + '(-X\\s*|--method[\\s=]+)(POST|PUT|PATCH|DELETE)\\b', 'i'), 'gh api with mutating method'],
];
for (const extra of cfg.extraPatterns || []) {
  try { rules.push([new RegExp(extra.pattern), extra.name || extra.pattern]); } catch { /* bad user regex ignored */ }
}

// `destructiveGit.mergeBases` (e.g. ["autopilot/*"]): a `gh pr merge <n>` is
// allowed ONLY when the PR's base branch, as GitHub reports it, matches a
// listed pattern and is not the repo's default branch — the autopilot
// integration branch. Anything unverifiable (no number, gh error, base
// unknown) stays blocked. The project's own merge-evidence gate still runs.
// A second path onto the DEFAULT branch: `ship: merge` domains (owner-
// confirmed design 2026-09-06). Pure decision in lib/merge-check.js; this
// wrapper only fetches what GitHub and git know: base, files, body, the
// board item behind `Closes #n`, and the review manifests at the PR head.
let mergeReason = null;
function mergeBaseAllowed(command) {
  const pats = Array.isArray(cfg.mergeBases) ? cfg.mergeBases.filter(p => typeof p === 'string' && p) : [];
  const mergeDomains = full.contract && full.contract.domains
    ? Object.values(full.contract.domains).some(d => d && d.ship === 'merge') : false;
  if (!pats.length && !mergeDomains) return false;
  const num = (command.match(/\bgh\b[^\n|;&]*\bpr\b[^\n|;&]*\bmerge\b[^\n|;&]*?\s(\d+)\b/) || [])[1];
  if (!num) { mergeReason = 'no PR number'; return false; }
  const { execSync } = require('child_process');
  const cwd = j.cwd || process.cwd();
  const opts = { cwd, timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024 };
  let base, def;
  try {
    base = execSync(`gh pr view ${num} --json baseRefName -q .baseRefName`, opts).toString().trim();
    def = execSync('gh repo view --json defaultBranchRef -q .defaultBranchRef.name', opts).toString().trim();
  } catch { mergeReason = 'gh unreachable'; return false; }
  if (!base || !def) { mergeReason = 'base unknown'; return false; }
  const toRe = p => new RegExp('^' + p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  if (base !== def) return pats.some(p => toRe(p).test(base));
  if (!mergeDomains) { mergeReason = 'default branch, no ship: merge domain'; return false; }
  const { mergeCheck } = require('./lib/merge-check');
  const { parseManifest } = require('./lib/evidence-lint');
  let pr, item = null, manifests = [];
  try {
    pr = JSON.parse(execSync(`gh pr view ${num} --json body,headRefOid,files`, opts).toString());
  } catch { mergeReason = 'gh pr view failed'; return false; }
  const itemNo = Number((/\b(?:closes|fixes|resolves)\s+#(\d+)/i.exec(pr.body || '') || [])[1]);
  if (itemNo) {
    try {
      const bg = require('../scripts/board-gh');
      const root = execSync('git rev-parse --show-toplevel', opts).toString().trim();
      const bcfg = bg.loadCfg(root);
      if (bcfg) {
        const board = bg.readBoard(require('../scripts/lib/gh').makeGh(), bcfg);
        for (const goal of board.goals) {
          const it = goal.items.find(i => i.issue === itemNo);
          if (it) { item = { issue: it.issue, step: it.step, recipe: it.recipe, goal: goal.issue }; break; }
        }
      }
    } catch { item = null; }
  }
  try {
    execSync(`git fetch -q origin ${pr.headRefOid}`, opts);
    const list = execSync(`git ls-tree --name-only ${pr.headRefOid} docs/reviews/`, opts).toString().split(/\r?\n/).filter(f => /^docs\/reviews\/M\d+\.G\d+\.(S\d+|P)\.R\d+\.md$/.test(f.trim()));
    manifests = list.map(f => ({ file: f.trim(), ...parseManifest(execSync(`git show ${pr.headRefOid}:${f.trim()}`, opts).toString()) }));
  } catch { manifests = []; }
  const r = mergeCheck({ base, defaultBranch: def, files: (pr.files || []).map(f => f.path), body: pr.body, contract: full.contract, item, manifests });
  if (!r.ok) { mergeReason = r.miss; return false; }
  return true;
}

// v0.9.4: after a granted lane rebase (workflow.laneRebase) the lane must
// re-publish its OWN branch: `push --force-with-lease` (never bare --force)
// is allowed from a worktree under workflow.worktreeRoots when HEAD is a
// non-default branch and the command names no other branch or refspec.
function laneForcePushOk(command) {
  const wf = full.workflow || {};
  if (wf.laneRebase !== true || !Array.isArray(wf.worktreeRoots)) return false;
  if (/\s-f\b|--force(\s|$)/.test(command) || /:/.test(command.replace(/^[^ ]*:/, ''))) return false; // --force-with-lease only, no refspec
  const path = require('path');
  const { execSync } = require('child_process');
  const cwd = j.cwd || process.cwd();
  const opts = { cwd, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] };
  try {
    const common = fs.realpathSync.native(execSync('git rev-parse --git-common-dir', opts).toString().trim().replace(/^(?![A-Za-z]:|\/)/, cwd + path.sep));
    const mainTop = path.dirname(common);
    const here = fs.realpathSync.native(execSync('git rev-parse --show-toplevel', opts).toString().trim());
    const fold = p => (process.platform === 'win32' ? p.toLowerCase() : p);
    const roots = wf.worktreeRoots.filter(r => typeof r === 'string' && r && !path.isAbsolute(r) && !r.split(/[\\/]/).includes('..'));
    if (!roots.some(r => fold(here).startsWith(fold(path.join(mainTop, r) + path.sep)))) return false;
    const branch = execSync('git rev-parse --abbrev-ref HEAD', opts).toString().trim();
    if (!branch || branch === 'HEAD' || branch === 'main' || branch === 'master') return false;
    const pos = command.replace(/^.*\bpush\b/, '').split(/\s+/).filter(x => x && !x.startsWith('-'));
    return pos.length <= 2 && (pos.length < 2 || pos[1] === branch || pos[1] === 'HEAD');
  } catch { return false; }
}

for (let [re, name] of rules) {
  if (re.test(cmd)) {
    if (name === 'git push --force' && laneForcePushOk(cmd)) continue;
    if (name.startsWith('gh pr merge')) {
      if (mergeBaseAllowed(cmd)) continue;
      if (mergeReason) name = `${name} — ship: merge refused: ${mergeReason}`;
    }
    const counterFile = tmpMark('orch-destrgit', j.session_id || 'nosession');
    let n = 1;
    try { n = parseInt(fs.readFileSync(counterFile, 'utf8'), 10) + 1 || 1; } catch { n = 1; }
    try { fs.writeFileSync(counterFile, String(n)); } catch {}
    if (n <= 3) {
      console.error(
        `BLOCKED by shepr guard: ${name}. Not yours to run. ` +
        `If the operator truly wants this, they run it themselves.`
      );
    } else {
      console.error(`BLOCKED (shepr, denial #${n} this session): ${name} — operator runs it themselves if intended.`);
    }
    process.exit(2);
  }
}
process.exit(0);
