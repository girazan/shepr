// PreToolUse (Bash|PowerShell) — the contract's ship gate.
// DENY-BY-DEFAULT: with an active contract, git subcommands outside a
// read/local allowlist are refused; commit/push are gated by repo STATE
// (staged ∪ dirty ∪ unpushed) — command arguments are never trusted for
// file resolution, so quoting/pathspec/alias games have nothing to bypass.
// Fail CLOSED on: corrupt/invalid config, retargeting (cd/-C/GIT_DIR),
// denied verbs, non-narrow push args, unresolvable base, empty file set,
// oversized payload. Inactive (no contract key, or valid empty domains)
// is the only silent pass-through. Every other exit writes an audit line.
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const { readStdin, loadConfig, loadLock, appendAudit, AUDIT_REL, resolveRepoKey } = require('./lib/config');
const { globToRe } = require('./lib/contract');
const { isEvidence, lint } = require('./lib/evidence-lint');

const RANK = { none: 0, commit: 1, push: 2 };
// Deny-by-default: only local/read commands escape the gate untouched.
// submodule/worktree/clone/init/archive/format-patch/remote/config/clean
// are deliberately NOT here — each can write history or touch a remote.
const READ_ALLOW = new Set(['status', 'log', 'diff', 'show', 'fetch', 'add', 'rm', 'mv', 'restore',
  'switch', 'checkout', 'branch', 'stash', 'rev-parse', 'ls-files', 'ls-remote', 'describe', 'blame',
  'shortlog', 'reflog', 'grep', 'apply', 'help', 'version']);

const { j, oversized } = readStdin();
const cmd = (j && j.tool_input && (j.tool_input.command || '')) || '';
const cwd = (j && j.cwd) || process.cwd();

// Whole-command lexer: a quoted span becomes ONE token carrying its raw
// content (a quoted refspec/message is seen, never deleted or split on).
// Bare words are cut wherever a shell metachar sits, even glued to a word
// edge ("push)" -> "push", ")"), so grouping/list operators are never
// hidden inside what looks like a single argument.
function tokenizeAll(command) {
  const toks = [];
  const STOP = ' \t\r\n;&|(){}"\'';
  let i = 0;
  const n = command.length;
  while (i < n) {
    const c = command[i];
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '\n') { toks.push({ text: ';', quoted: false }); i++; continue; }
    if (c === '"' || c === "'") {
      const q = c;
      let k = i + 1, buf = '';
      while (k < n && command[k] !== q) { buf += command[k]; k++; }
      toks.push({ text: buf, quoted: true });
      i = k + 1;
      continue;
    }
    if (command.startsWith('&&', i)) { toks.push({ text: '&&', quoted: false }); i += 2; continue; }
    if (command.startsWith('||', i)) { toks.push({ text: '||', quoted: false }); i += 2; continue; }
    if (';&|(){}'.includes(c)) { toks.push({ text: c, quoted: false }); i++; continue; }
    let k = i, buf = '';
    while (k < n && !STOP.includes(command[k])) { buf += command[k]; k++; }
    if (buf) toks.push({ text: buf, quoted: false });
    i = k;
  }
  return toks;
}

const SEP = new Set(['&&', '||', ';', '&', '|', '{', '}', '(', ')']);
const KEYWORD_SEP = new Set(['then', 'do', 'else', 'fi', 'done', 'if', 'for', 'while']);

// Segment = one shell "statement": split on pipes/lists/grouping/keywords
// so `{ cd ../victim && git push; }` sees both cd and push, while a quoted
// `;` inside a commit message never escalates ("wip; git push later" is
// message text, not a second command).
function toSegments(command) {
  const segs = [[]];
  for (const t of tokenizeAll(command)) {
    if (!t.quoted && (SEP.has(t.text) || KEYWORD_SEP.has(t.text))) { segs.push([]); continue; }
    segs[segs.length - 1].push(t);
  }
  return segs.filter(s => s.length);
}

const CD_RE = /^(cd|chdir|pushd|popd|sl|set-location|push-location)$/i;
// Match the invoked token's BASENAME, not the literal string "git" — a
// path-prefixed invocation (`/usr/bin/git`, `./git`, a quoted absolute
// .exe path) is still git and must not walk past every check below it.
const GIT_RE = /(^|[\\/])git(\.exe)?$/i;

function classify(command) {
  const res = { action: 0, denied: null, retarget: false, pushSegs: [], worktreeSegs: [] };
  const hasEnvRetarget = /GIT_DIR|GIT_WORK_TREE/.test(command);
  const segs = toSegments(command);
  // Retarget-token scan is command-wide, not per-segment: `{ cd ../victim
  // && git push; }` puts cd and push in different segments on purpose.
  const hasCd = segs.some(seg => seg.some(tok => !tok.quoted && CD_RE.test(tok.text)));
  for (const seg of segs) {
    const t = seg.map(x => x.text);
    const gi = t.findIndex(x => GIT_RE.test(x));
    if (gi < 0) continue;
    let sub = null, subIdx = -1, retargetFlag = false;
    for (let i = gi + 1; i < t.length; i++) {
      const x = t[i];
      if (x === '-c') { i++; continue; }
      if (x === '-C') { retargetFlag = true; i++; continue; }
      if (/^--?(git-dir|work-tree)(=|$)/.test(x)) { retargetFlag = true; continue; }
      if (x.startsWith('-')) continue;
      sub = x; subIdx = i; break;
    }
    if (sub === null) {
      // Bare `git`/flags-only errors by itself — EXCEPT when a retarget
      // flag was consumed and a keyword-named dir (`-C do`) severed the
      // subcommand into the next segment: skipping that silently would be
      // an unaudited retarget, so it denies instead.
      if (retargetFlag) res.denied = res.denied || 'git (retarget flags, no resolvable subcommand)';
      continue;
    }
    if (READ_ALLOW.has(sub)) continue; // -C/--git-dir on a read op is harmless
    if (retargetFlag) res.retarget = true;
    if (sub === 'commit') {
      const amend = seg.slice(subIdx + 1).some(tok => !tok.quoted && tok.text.startsWith('--am'));
      if (amend) res.denied = res.denied || 'git commit --amend'; // no amend-union path — operator only
      else res.action = Math.max(res.action, 1);
    } else if (sub === 'push') {
      res.action = Math.max(res.action, 2);
      res.pushSegs.push(t.slice(subIdx + 1)); // EVERY push segment, not just the last
    } else if (sub === 'worktree') {
      // Allowlisted only for the script's own detached test worktrees under
      // <common-dir>/orch/wt/ (spec §5) — resolved with repo context below.
      res.worktreeSegs.push(seg.slice(subIdx + 1).map(x => x.text));
    } else {
      // Unknown, aliased, or history-writing subcommand.
      res.denied = res.denied || `git ${sub}`;
    }
  }
  if ((res.action > 0 || res.denied) && (hasEnvRetarget || hasCd)) res.retarget = true;
  return res;
}

function worktreeOk(segs, cwdArg) {
  if (!segs.length) return true;
  const common = resolveRepoKey(cwdArg);
  if (!common) return false;
  const fold = p => (process.platform === 'win32' ? p.toLowerCase() : p);
  const under = (target, prefix) => fold(path.resolve(cwdArg, target)).startsWith(fold(prefix));
  const scriptWt = path.join(common, 'orch', 'wt') + path.sep;
  // Operator-granted lane roots (`workflow.worktreeRoots`, repo-relative,
  // merged through the lock like every other config key): a full
  // `add [-b <branch>|--detach] <path> [<ref>]` / `remove [--force] <path>`
  // is allowed when <path> resolves under one of them. Absent = script
  // worktrees only, as before.
  let laneRoots = [];
  try {
    const top = git(cwdArg, ['rev-parse', '--show-toplevel']).trim();
    const wf = loadConfig({ cwd: top }).workflow;
    const roots = wf && Array.isArray(wf.worktreeRoots) ? wf.worktreeRoots : [];
    laneRoots = roots.filter(r => typeof r === 'string' && r && !path.isAbsolute(r) && !r.split(/[\\/]/).includes('..'))
      .map(r => path.join(top, r) + path.sep);
  } catch {}
  const removeTarget = a => (a[0] === 'remove' && (a.length === 2 || (a.length === 3 && a[1] === '--force'))) ? a[a.length - 1] : null;
  const scriptTarget = a => (a[0] === 'add' && a[1] === '--detach' && a.length === 4) ? a[2] : removeTarget(a);
  const laneTarget = a => {
    if (a[0] !== 'add') return removeTarget(a);
    const rest = a.slice(1);
    let i = 0;
    if (rest[i] === '-b') i += 2; else if (rest[i] === '--detach') i += 1;
    const pathArg = rest[i];
    const tail = rest.length - i; // <path> or <path> <ref>
    return pathArg && !pathArg.startsWith('-') && (tail === 1 || tail === 2) && !(rest[i + 1] || '').startsWith('-') ? pathArg : null;
  };
  return segs.every(a => {
    const s = scriptTarget(a);
    if (s && under(s, scriptWt)) return true;
    const t = laneTarget(a);
    return !!t && laneRoots.some(r => under(t, r));
  });
}

function git(cwdArg, args) {
  // stdio pipes everywhere: a blocked command must print exactly ONE
  // message (ours) — a git subprocess's own stderr is captured, never
  // inherited onto the terminal.
  return execFileSync('git', ['-C', cwdArg, '-c', 'core.quotePath=false', ...args],
    { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).toString();
}

// Cheap corrupt-lock probe: needs no repo root, so this runs on EVERY
// Bash/PowerShell command without spawning git. The operator locked guards
// and the lock is unreadable — their authority is unrecoverable, so fail
// CLOSED rather than run ungated (spec §1).
if (loadLock().corrupt) {
  console.error('BLOCKED (shepr): ~/.claude/orch-lock.json is corrupt — locked guard authority unrecoverable. Fix the lock file.');
  process.exit(2);
}

// board-gh close-goal / done --goal --step — the §5 evidence lint. Judged on
// repo state at HEAD plus the locked contract: git only, no network. With
// no lock entry for this repo the lint is ADVISORY (audit line, no block —
// spec §6 last row); today's close-goal ledger check stays and runs first.
const CG = cmd.match(/board-gh(?:\.js)?\s+close-goal\s+(G\d+)\b/i);
const DN = !CG && cmd.match(/board-gh(?:\.js)?\s+done\b([^;&|]*)/i);
if (CG || DN) {
  let root0 = null;
  try { root0 = git(cwd, ['rev-parse', '--show-toplevel']).trim(); } catch {}
  const cfg0 = loadConfig({ cwd: root0 || cwd });
  const active = cfg0.contract && cfg0.contract.domains && Object.keys(cfg0.contract.domains).length;
  if (active && root0) {
    let verb, lane;
    if (CG) { lane = CG[1].toUpperCase(); verb = { kind: 'close', goal: Number(lane.slice(1)) }; }
    else {
      const rest = DN[1];
      const gm = /--goal\s+G(\d+)\b/i.exec(rest), sm = /--step\s+S(\d+)\b/i.exec(rest);
      const im = /(?:^|\s)(\d+)(?=\s|$)/.exec(rest.replace(/--goal\s+\S+|--step\s+\S+/gi, ' '));
      if (!gm || !sm || !im) {
        appendAudit(root0, { action: 'done', verdict: 'BLOCK', reason: 'done: --goal G<n> --step S<j> <item#> required', by: 'hook' });
        console.error('BLOCKED (shepr ship-gate): use `board-gh done --goal G<n> --step S<j> <item#>` — the hook cannot map an item number to ids offline (spec §5).');
        process.exit(2);
      }
      lane = `G${gm[1]}`; verb = { kind: 'done', goal: Number(gm[1]), step: Number(sm[1]), item: Number(im[1]) };
    }
    const action = CG ? 'close-goal' : 'done';
    const block = reason => { appendAudit(root0, { action, lane, verdict: 'BLOCK', reason, by: 'hook' }); console.error(`BLOCKED (shepr ship-gate): ${reason}`); process.exit(2); };
    if (CG) {
      let files = [];
      try { files = git(root0, ['ls-tree', '--name-only', 'HEAD', 'tmp/worklogs/']).split(/\r?\n/).filter(Boolean); } catch {}
      const wl = files.find(f => new RegExp(`^tmp/worklogs/${lane}-.*\\.md$`, 'i').test(f));
      if (!wl) block(`close-goal: worklog for ${lane} is not committed at HEAD`);
      let text = '';
      try { text = git(root0, ['show', `HEAD:${wl}`]); }
      catch { block(`close-goal: cannot read ${wl} at HEAD`); }
      if (!new RegExp(`^(iter|evidence:).*\\b${lane}\\b`, 'm').test(text)) block(`close-goal: no ledger line naming ${lane} in ${wl} at HEAD`);
    }
    let res;
    try { res = lint({ git: args => git(root0, args), contract: cfg0.contract, models: cfg0.models || {}, verb }); }
    catch (e) { res = { ok: false, miss: `lint error: ${String(e.message).split('\n')[0]}` }; }
    if (res.ok) appendAudit(root0, { action, lane, verdict: 'ALLOW', lint: 'PASS', target: res.target, by: 'hook' });
    else if (cfg0.__repoLocked) block(`${action}: evidence lint MISS ${res.miss}`);
    else appendAudit(root0, { action, lane, verdict: 'ALLOW', lint: 'ADVISORY', reason: res.miss, by: 'hook' });
  }
}

const cls = cmd ? classify(cmd) : { action: 0, denied: null, retarget: false, worktreeSegs: [] };
if (cls.worktreeSegs.length && !worktreeOk(cls.worktreeSegs, cwd)) cls.denied = cls.denied || 'git worktree (only `add --detach`/`remove` under <git-common-dir>/orch/wt/ — the review script\'s test worktrees)';
if (!oversized && cls.action === 0 && !cls.denied) process.exit(0);

// Only a gated action (or a denied one) reaches here — root resolution and
// the full config load are deferred until they're actually needed.
let root = null;
try { root = git(cwd, ['rev-parse', '--show-toplevel']).trim(); } catch {}

const cfg = loadConfig({ cwd: root || cwd });
const contract = cfg.contract;
const label = cls.denied ? `denied:${cls.denied}` : cls.action === 2 ? 'push' : 'commit';

// Attempted once, only if needed: a die() before root resolves (oversized,
// unresolvable repo) still tries process.cwd() so the audit trail survives
// a hook invoked with an unhelpful/missing cwd in the payload.
let rootFromCwd;
function auditRoot() {
  if (root) return root;
  if (rootFromCwd === undefined) {
    try { rootFromCwd = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim(); }
    catch { rootFromCwd = null; }
  }
  return rootFromCwd;
}

function die(reason, extra) {
  const r = auditRoot();
  if (r) {
    appendAudit(r, { action: (extra && extra.action) || label, ...(extra || {}), verdict: 'BLOCK', reason, by: 'hook' });
    console.error(`BLOCKED (shepr ship-gate): ${reason}`);
  } else {
    console.error(`BLOCKED (shepr ship-gate): ${reason} (unaudited: no repo root)`);
  }
  process.exit(2);
}

if (oversized) die('oversized hook payload — command unverifiable.', { action: 'invalid' });
if (cfg.__corrupt) die('.claude/orch.json is not valid JSON — the contract cannot be read; fix it first.', { action: 'invalid' });
// Spec §6 row 1: the gate reviewer never commits or pushes. Keyed on env,
// hence ADVISORY — but a typed commit/push inside a reviewer subagent is
// exactly the drift this catches. Its evidence commit is the script's own
// (child_process, unseen here). Holds with or without a contract.
if (process.env.ORCH_ROLE === 'reviewer') {
  die('ORCH_ROLE=reviewer — the gate reviewer never commits or pushes; `shepr review` commits docs/reviews/ itself (ADVISORY: keyed on the role).', { role: 'reviewer', label: 'ADVISORY' });
}
if (!contract) process.exit(0);
// Contract key present: validate the WHOLE shape before any inactive/no-op decision.
if (typeof contract !== 'object' || contract === null || Array.isArray(contract) ||
    typeof contract.domains !== 'object' || contract.domains === null || Array.isArray(contract.domains)) {
  die('contract present but malformed — fix .claude/orch.json', { action: 'invalid' });
}
for (const [name, d] of Object.entries(contract.domains)) {
  if (!d || typeof d !== 'object' ||
      !Object.prototype.hasOwnProperty.call(RANK, d.ship) ||
      !['ai', 'human'].includes(d.decide) ||
      !Array.isArray(d.paths) || !d.paths.every(p => typeof p === 'string')) {
    die(`contract invalid (domain "${name}") — fix .claude/orch.json`, { action: 'invalid' });
  }
}
if (!Object.keys(contract.domains).length) process.exit(0); // valid, deliberately inactive
if (!root) die('not inside a git repository yet a git ship action was issued — refusing to gate blind.', { action: 'invalid' });

if (cls.retarget) die('cd/pushd/-C/--git-dir/GIT_DIR retargeting alongside a gated git action — this gate covers one repo; the operator runs cross-repo commands.', { action: 'retarget' });
if (cls.denied) {
  // merge/pull/rebase only: a literal "# OWNER-APPROVED" marker in the
  // command lets it through, same escape hatch as the gh-pr-merge evidence
  // gate. The marker is OWNER-TYPED ONLY (`! git merge x # OWNER-APPROVED`
  // in the prompt) — an agent never appends, quotes, or pastes it (owner
  // ruling 2026-09-03). Every other denied verb stays hard-blocked.
  if (/^git (merge|pull|rebase)$/.test(cls.denied) && /#\s*OWNER-APPROVED\b/i.test(cmd)) {
    appendAudit(root, { action: cls.denied, verdict: 'ALLOW', by: 'owner-marker' });
    process.exit(0);
  }
  die(`${cls.denied} is not on the contract's git surface (read/local commands, commit, push). The operator runs it (for merge/pull/rebase: \`! git ... # OWNER-APPROVED\` typed by the operator — never appended by an agent), or an ADR grants a workflow that needs it.`);
}

function names(out) {
  return [...new Set(out.split(/\r?\n/).map(s => s.replace(/[\r\n]+$/, '')).filter(Boolean))];
}

if (cls.action === 2) {
  // Narrow push shape, checked on EVERY push segment in the command — a
  // single bad segment (e.g. a refspec push hiding behind a second, clean
  // `git push`) must not slip through because only the last one was checked.
  const ALLOWED_FLAGS = new Set(['-u', '--set-upstream', '-q', '--quiet', '-v', '--verbose']);
  let branch = null;
  try { branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(); } catch {}
  for (const pt of cls.pushSegs) {
    const flags = pt.filter(x => x.startsWith('-'));
    const pos = pt.filter(x => !x.startsWith('-'));
    if (flags.some(f => !ALLOWED_FLAGS.has(f)) || pt.some(x => x.includes(':')) ||
        pos.length > 2 || (pos.length === 2 && pos[1] !== branch && pos[1] !== 'HEAD')) {
      die('push arguments outside the narrow shape (plain / <remote> / -u <remote> <current-branch>) — the operator runs it.');
    }
  }
}

let files = [];
try {
  // STATE-based, always-union: strict superset of anything a commit/push
  // variant could land. No argument parsing exists to bypass.
  files.push(...names(git(root, ['diff', '--cached', '--name-only'])));
  files.push(...names(git(root, ['diff', '--name-only'])));
  if (cls.action === 2) {
    let base = null;
    for (const ref of ['@{push}', '@{u}']) {
      try { base = git(root, ['rev-parse', ref]).trim(); break; } catch {}
    }
    if (!base) {
      try {
        const def = git(root, ['symbolic-ref', 'refs/remotes/origin/HEAD']).trim();
        base = git(root, ['merge-base', 'HEAD', def]).trim();
      } catch {}
    }
    if (!base) die("push base unresolvable — no upstream and refs/remotes/origin/HEAD is not set locally; the operator runs `git remote set-head origin -a` once (a gate never talks to the remote).");
    files.push(...names(git(root, ['diff', `${base}..HEAD`, '--name-only'])));
  }
} catch (e) {
  die(`cannot resolve repo state (${String(e.message).split('\n')[0]}) — refusing to gate blind.`);
}
files = [...new Set(files)];
if (!files.length) {
  die("nothing resolvable to gate — empty/fileless mutations (--allow-empty, tag moves) are the operator's.");
}
// The hook's own evidence file must never deadlock its own gate.
const auditRel = AUDIT_REL.replace(/\\/g, '/');
files = files.filter(f => f.replace(/\\/g, '/') !== auditRel);
if (!files.length) {
  die('only the audit file is pending — nothing gateable — the operator decides.');
}

let overall = 2, governing = null, offenders = [];
for (const f of files) {
  const p = f.replace(/\\/g, '/');
  let grant = null, gDom = null;
  // Built-in evidence grant (spec §5): reviews, worklogs, ADRs carry a
  // `commit` floor before any domain is consulted; a domain may lift it.
  if (isEvidence(p)) { grant = RANK.commit; gDom = 'evidence'; }
  for (const [name, d] of Object.entries(contract.domains)) {
    if (!d.paths.some(pat => globToRe(pat).test(p))) continue;
    if (gDom === 'evidence') { if (RANK[d.ship] > grant) { grant = RANK[d.ship]; gDom = name; } }
    else if (grant === null || RANK[d.ship] < grant) { grant = RANK[d.ship]; gDom = name; }
  }
  if (grant === null) { grant = 0; gDom = 'unmatched'; }
  if (governing === null || grant < overall) { overall = grant; governing = gDom; }
  if (grant < cls.action) offenders.push(`${p} (${gDom})`);
}

if (cls.action > overall) {
  appendAudit(root, { action: label, files, domain: governing, verdict: 'BLOCK', by: 'hook' });
  const who = governing === 'unmatched'
    ? 'no domain matches — omission never grants; write a proposed ADR amendment instead'
    : `domain "${governing}" grants "${Object.keys(RANK).find(k => RANK[k] === overall)}" — the operator ships this`;
  console.error(`BLOCKED (shepr ship-gate): git ${label} exceeds contract. ${who}. Files: ${offenders.slice(0, 5).join(', ')}${offenders.length > 5 ? ` +${offenders.length - 5} more` : ''}`);
  process.exit(2);
}
appendAudit(root, { action: label, files, domain: governing, verdict: 'ALLOW', by: 'hook' });
process.exit(0);
