// destructive-git guard smoke incl. the round-3 gh rules. Fake HOME.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'hooks', 'block-destructive-git.js');
const SCRATCH = path.join(__dirname, 'scratch-destr');
const FAKEHOME = path.join(SCRATCH, 'home');
const PROJ = path.join(SCRATCH, 'proj');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(path.join(FAKEHOME, '.claude'), { recursive: true });
fs.mkdirSync(PROJ, { recursive: true });

function run(cmd) {
  const payload = JSON.stringify({ session_id: 's', cwd: PROJ, tool_input: { command: cmd } });
  try {
    execFileSync('node', [HOOK], { input: payload,
      env: { ...process.env, USERPROFILE: FAKEHOME, HOME: FAKEHOME }, stdio: ['pipe', 'pipe', 'pipe'] });
    return 0;
  } catch (e) { return e.status; }
}
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
check('push --force blocked', run('git push --force') === 2);
check('reset --hard blocked', run('git reset --hard') === 2);
check('git.exe -C variant blocked', run('git.exe -C x reset --hard') === 2);
check('stash pop blocked', run('git stash pop') === 2);
check('status allowed', run('git status') === 0);
check('plain push allowed', run('git push') === 0);
check('gh pr merge blocked', run('gh pr merge 5') === 2);
check('gh api PUT blocked', run('gh api -X PUT repos/o/r/contents/x') === 2);
check('gh api --method post blocked', run('gh api --method POST repos/o/r/issues') === 2);
check('gh api GET allowed', run('gh api repos/o/r/pulls') === 0);
check('gh pr view allowed', run('gh pr view 5') === 0);

// destructiveGit.mergeBases: gh pr merge allowed only onto a listed non-default base (fake gh on PATH).
{
  const BIN = path.join(SCRATCH, 'bin');
  fs.mkdirSync(BIN, { recursive: true });
  // pr view -> $FAKE_BASE ; repo view -> main ; anything else -> exit 1
  fs.writeFileSync(path.join(BIN, 'gh'), '#!/bin/sh\ncase "$1 $2" in "pr view") echo "$FAKE_BASE";; "repo view") echo main;; *) exit 1;; esac\n');
  try { fs.chmodSync(path.join(BIN, 'gh'), 0o755); } catch {}
  fs.writeFileSync(path.join(BIN, 'gh.cmd'), '@echo off\r\nif "%1 %2"=="pr view" (echo %FAKE_BASE%& exit /b 0)\r\nif "%1 %2"=="repo view" (echo main& exit /b 0)\r\nexit /b 1\r\n');
  const CFG = path.join(PROJ, '.claude', 'orch.json');
  fs.mkdirSync(path.dirname(CFG), { recursive: true });
  const runGh = (cmd, base, cfgObj) => {
    fs.writeFileSync(CFG, JSON.stringify(cfgObj));
    const payload = JSON.stringify({ session_id: 's', cwd: PROJ, tool_input: { command: cmd } });
    const sep = process.platform === 'win32' ? ';' : ':';
    try {
      execFileSync('node', [HOOK], { input: payload, env: { ...process.env, USERPROFILE: FAKEHOME, HOME: FAKEHOME,
        PATH: BIN + sep + process.env.PATH, FAKE_BASE: base }, stdio: ['pipe', 'pipe', 'pipe'] });
      return 0;
    } catch (e) { return e.status; }
  };
  const AP = { destructiveGit: { mergeBases: ['autopilot/*'] } };
  check('mergeBases: merge onto autopilot/x allowed', runGh('gh pr merge 7 --squash', 'autopilot/2026-09-06', AP) === 0);
  check('mergeBases: merge onto main blocked', runGh('gh pr merge 7 --squash', 'main', AP) === 2);
  check('mergeBases: merge onto other branch blocked', runGh('gh pr merge 7', 'feature/x', AP) === 2);
  check('mergeBases: no PR number blocked', runGh('gh pr merge --squash', 'autopilot/x', AP) === 2);
  check('mergeBases: gh error blocked', runGh('gh pr merge 7', '', AP) === 2);
  check('mergeBases absent: still blocked', runGh('gh pr merge 7', 'autopilot/x', {}) === 2);
  fs.rmSync(CFG, { force: true });
}

// v0.9.4 laneRebase: --force-with-lease of the lane's own branch from a granted worktree only.
{
  const R2 = path.join(SCRATCH, 'repo2');
  fs.mkdirSync(R2, { recursive: true });
  const gi = (cwd, ...a) => execFileSync('git', a, { cwd, env: { ...process.env, HOME: FAKEHOME, USERPROFILE: FAKEHOME, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  gi(R2, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(R2, 'a.txt'), 'a\n'); gi(R2, 'add', 'a.txt'); gi(R2, 'commit', '-q', '-m', 'seed');
  const WT = path.join(R2, '.worktrees', 'l'); gi(R2, 'worktree', 'add', '-q', '-b', 'lane/l', WT, 'HEAD');
  fs.mkdirSync(path.join(R2, '.claude'), { recursive: true });
  const runIn = (cmd, cwd) => { const payload = JSON.stringify({ session_id: 's', cwd, tool_input: { command: cmd } }); try { execFileSync('node', [HOOK], { input: payload, env: { ...process.env, USERPROFILE: FAKEHOME, HOME: FAKEHOME }, stdio: ['pipe', 'pipe', 'pipe'] }); return 0; } catch (e) { return e.status; } };
  fs.writeFileSync(path.join(R2, '.claude', 'orch.json'), JSON.stringify({ workflow: { worktreeRoots: ['.worktrees'], laneRebase: true } }));
  check('laneRebase: --force-with-lease of lane/l from its worktree allowed', runIn('git push --force-with-lease origin lane/l', WT) === 0);
  check('laneRebase: --force-with-lease with no branch arg allowed', runIn('git push --force-with-lease', WT) === 0);
  check('laneRebase: bare --force still blocked', runIn('git push --force origin lane/l', WT) === 2);
  check('laneRebase: -f still blocked', runIn('git push -f', WT) === 2);
  check('laneRebase: --force-with-lease of another branch blocked', runIn('git push --force-with-lease origin main', WT) === 2);
  check('laneRebase: --force-with-lease from the main checkout blocked', runIn('git push --force-with-lease', R2) === 2);
  fs.writeFileSync(path.join(R2, '.claude', 'orch.json'), JSON.stringify({ workflow: { worktreeRoots: ['.worktrees'] } }));
  check('laneRebase off: --force-with-lease blocked', runIn('git push --force-with-lease origin lane/l', WT) === 2);
}

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
