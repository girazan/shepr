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
function mergeBaseAllowed(command) {
  const pats = Array.isArray(cfg.mergeBases) ? cfg.mergeBases.filter(p => typeof p === 'string' && p) : [];
  if (!pats.length) return false;
  const num = (command.match(/\bgh\b[^\n|;&]*\bpr\b[^\n|;&]*\bmerge\b[^\n|;&]*?\s(\d+)\b/) || [])[1];
  if (!num) return false;
  const { execSync } = require('child_process');
  const opts = { cwd: j.cwd || process.cwd(), timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] };
  let base, def;
  try {
    base = execSync(`gh pr view ${num} --json baseRefName -q .baseRefName`, opts).toString().trim();
    def = execSync('gh repo view --json defaultBranchRef -q .defaultBranchRef.name', opts).toString().trim();
  } catch { return false; }
  if (!base || !def || base === def) return false;
  const toRe = p => new RegExp('^' + p.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return pats.some(p => toRe(p).test(base));
}

for (const [re, name] of rules) {
  if (re.test(cmd)) {
    if (name.startsWith('gh pr merge') && mergeBaseAllowed(cmd)) continue;
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
