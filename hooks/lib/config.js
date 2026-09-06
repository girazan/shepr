// Shared config loader. Per-project config lives at <project>/.claude/orch.json
// (the hook payload's cwd is the project dir). Missing file = {} — every hook
// defines safe defaults and most config-dependent hooks no-op without config.
// A user-level lock file (~/.claude/orch-lock.json) deep-overrides project
// config: a per-repo orch.json can never switch off a guard the user locked.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

function tmpMark(prefix, ...parts) {
  // Stable per-session/per-key marker path in the OS tmpdir. Parts are
  // hashed so paths and session ids never leak into filenames.
  const key = crypto.createHash('md5').update(parts.join('|')).digest('hex');
  return path.join(os.tmpdir(), prefix + '-' + key);
}

function deepMerge(base, win) {
  // win overrides base; plain objects merge, everything else replaces.
  const out = { ...base };
  for (const k of Object.keys(win)) {
    const b = out[k], w = win[k];
    out[k] = (b && w && typeof b === 'object' && typeof w === 'object' &&
              !Array.isArray(b) && !Array.isArray(w)) ? deepMerge(b, w) : w;
  }
  return out;
}

function loadLock() {
  // Provenance matters (spec §1): a present-but-corrupt lock must be
  // distinguishable from no lock, so guards can fail CLOSED on corruption.
  const p = path.join(os.homedir(), '.claude', 'orch-lock.json');
  if (!fs.existsSync(p)) return { present: false, corrupt: false, value: null };
  try {
    return { present: true, corrupt: false, value: JSON.parse(fs.readFileSync(p, 'utf8')) };
  } catch {
    console.error(`orch: WARNING — ${p} is not valid JSON; blocking guards FAIL CLOSED until fixed.`);
    return { present: true, corrupt: true, value: null };
  }
}

function resolveRepoKey(cwd) {
  // The repo's git common dir, realpath'd — shared by the main checkout
  // and every linked worktree, unlike the toplevel working-tree path.
  try {
    const raw = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const abs = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
    return fs.realpathSync.native(abs);
  } catch {
    return null;
  }
}

function readStdin() {
  // Returns { j, oversized }. Callers decide fail-open vs fail-closed.
  let raw;
  try { raw = fs.readFileSync(0); } catch { return { j: null, oversized: false }; }
  if (raw.length >= 1_048_576) return { j: null, oversized: true };
  try { return { j: JSON.parse(raw.toString('utf8')), oversized: false }; }
  catch { return { j: null, oversized: false }; }
}

function loadConfig(j) {
  let cfg = {};
  let corrupt = false;
  const roots = [];
  if (j && j.cwd) roots.push(j.cwd);
  roots.push(process.cwd());
  // v0.9.3: a LINKED WORKTREE has no .claude/orch.json of its own (the file
  // is rarely tracked), and "no config" used to mean "no contract" — every
  // lane worktree ran ungated. The main checkout (parent of the git common
  // dir) is the config's home for every worktree of the repo.
  let found = false;
  const tryRoot = (r) => {
    const p = path.join(r, '.claude', 'orch.json');
    try {
      if (fs.existsSync(p)) { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); found = true; return true; }
    } catch {
      console.error(`orch: WARNING — ${p} is not valid JSON; configured guards are INACTIVE until fixed.`);
      corrupt = true; return true;
    }
    return false;
  };
  for (const r of roots) if (tryRoot(r)) break;
  if (!found && !corrupt) {
    const common = resolveRepoKey((j && j.cwd) || process.cwd());
    if (common) tryRoot(path.dirname(common));
  }
  const lock = loadLock();
  const lockVal = lock.value || {};
  // Guard toggles (destructiveGit, etc.) merge from the lock's top level,
  // unscoped. contract/models are repo-specific governance data and are
  // read ONLY from repos[<repoKey>] below — a legacy top-level contract/
  // models is inert until /shepr:setup migrates it (scripts/migrate-lock.js,
  // spec §1 "Legacy migration").
  const lockGuards = {};
  for (const k of Object.keys(lockVal)) {
    if (k !== 'repos' && k !== 'contract' && k !== 'models') lockGuards[k] = lockVal[k];
  }
  let out = deepMerge(cfg, lockGuards);
  const cwd = (j && j.cwd) || process.cwd();
  // Only spawn `git` to resolve the repo key when the lock actually has a
  // repos scope to look up — the common case (no repos key) skips it.
  const repoKey = lockVal.repos ? resolveRepoKey(cwd) : null;
  const repoEntry = (repoKey && lockVal.repos && lockVal.repos[repoKey]) || null;
  if (repoEntry && Object.prototype.hasOwnProperty.call(repoEntry, 'contract')) {
    out.contract = repoEntry.contract;
    out.models = repoEntry.models;
  }
  if (repoEntry) out.board = repoEntry.board;
  Object.defineProperty(out, '__repoLocked', { value: !!repoEntry });
  if (lockVal.contract !== undefined || lockVal.models !== undefined) {
    console.error('orch: WARNING — top-level contract/models in the lock file is inert; run scripts/migrate-lock.js to move it under repos[<key>].');
  }
  if (corrupt) Object.defineProperty(out, '__corrupt', { value: true });
  if (lock.corrupt) Object.defineProperty(out, '__lockCorrupt', { value: true });
  Object.defineProperty(out, '__lock', { value: { present: lock.present, corrupt: lock.corrupt } });
  return out;
}

const AUDIT_REL = path.join('.claude', 'orch-audit.jsonl');

function appendAudit(root, entry) {
  // Audit is best-effort evidence, never a point of failure for the hook.
  const p = path.resolve(root || process.cwd(), AUDIT_REL);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch (e) {
    console.error(`orch: WARNING — audit write failed (${p}): ${e.message}`);
  }
}

module.exports = { readStdin, loadConfig, loadLock, appendAudit, tmpMark, AUDIT_REL, resolveRepoKey };
