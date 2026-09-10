// v0.2.0 lock semantics regression. Fake HOME throughout.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'hooks', 'block-destructive-git.js');
const SCRATCH = path.join(__dirname, 'scratch-lock');
const FAKEHOME = path.join(SCRATCH, 'home');
const PROJ = path.join(SCRATCH, 'proj');
const LOCK = path.join(FAKEHOME, '.claude', 'orch-lock.json');
const PROJCFG = path.join(PROJ, '.claude', 'orch.json');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(path.dirname(LOCK), { recursive: true });
fs.mkdirSync(path.dirname(PROJCFG), { recursive: true });

function run(cmd, sid) {
  const payload = JSON.stringify({ session_id: sid, cwd: PROJ, tool_input: { command: cmd } });
  try {
    execFileSync('node', [HOOK], { input: payload,
      env: { ...process.env, USERPROFILE: FAKEHOME, HOME: FAKEHOME }, stdio: ['pipe', 'pipe', 'pipe'] });
    return 0;
  } catch (e) { return e.status; }
}
function rmIf(p) { try { fs.unlinkSync(p); } catch {} }
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
const CMD = 'git reset --hard HEAD~1';

rmIf(PROJCFG); rmIf(LOCK);
check('default blocks reset --hard', run(CMD, 't1') === 2);
fs.writeFileSync(PROJCFG, JSON.stringify({ destructiveGit: { enabled: false } }));
check('project enabled:false disables guard', run(CMD, 't2') === 0);
fs.writeFileSync(LOCK, JSON.stringify({ destructiveGit: { enabled: true } }));
check('lock overrides project disable', run(CMD, 't3') === 2);
fs.writeFileSync(LOCK, '{ not json');
check('corrupt lock FAILS CLOSED (v0.7.0 breaking change)', run(CMD, 't4') === 2);
check('corrupt lock blocks even benign git while unrecoverable', run('git status', 't4b') === 2);
fs.writeFileSync(PROJCFG, JSON.stringify({
  destructiveGit: { enabled: true, extraPatterns: [{ pattern: 'taskkill\\s+/f', name: 'mass kill' }] } }));
fs.writeFileSync(LOCK, JSON.stringify({ destructiveGit: { enabled: true } }));
check('deep merge keeps project extraPatterns', run('taskkill /f /im dotnet.exe', 't5') === 2);
rmIf(PROJCFG);
fs.writeFileSync(LOCK, JSON.stringify({ destructiveGit: { extraPatterns: [{ pattern: 'rm\\s+-rf\\s+/', name: 'rm -rf root' }] } }));
check('lock-only extraPatterns active', run('rm -rf /etc', 't6') === 2);
rmIf(LOCK);
check('benign command passes with no lock', run('git status', 't7') === 0);

// board must come from the lock ONLY when the repo is locked — a locked
// repo entry lacking `board` must yield undefined, never the project file's
// value (a lock without a board opinion is not the same as "no lock").
rmIf(LOCK);
const g = a => execFileSync('git', ['-C', PROJ, ...a], { stdio: ['ignore', 'pipe', 'pipe'] });
try { g(['init', '-q']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']); } catch {}
fs.writeFileSync(PROJCFG, JSON.stringify({ board: { github: true } }));
try { g(['add', '.']); g(['commit', '-qm', 'init']); } catch {}
const { loadConfig, resolveRepoKey } = require('../hooks/lib/config');
process.env.USERPROFILE = FAKEHOME; process.env.HOME = FAKEHOME;
const repoKey = resolveRepoKey(PROJ);
fs.writeFileSync(LOCK, JSON.stringify({ repos: { [repoKey]: { contract: { domains: {} } } } }));
const locked = loadConfig({ cwd: PROJ });
check('locked repo entry without board → board undefined', locked.board === undefined);
check('locked repo entry without board → __repoLocked true', locked.__repoLocked === true);
rmIf(LOCK);
const unlocked = loadConfig({ cwd: PROJ });
check('no lock → board falls back to project file', unlocked.board && unlocked.board.github === true);
rmIf(PROJCFG);

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
