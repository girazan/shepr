// contract-ship-gate.js acceptance matrix. Fake HOME throughout; a
// real git repo + bare remote so push/base-resolution logic runs for real.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveRepoKey } = require('../hooks/lib/config');

const HOOK = path.join(__dirname, '..', 'hooks', 'contract-ship-gate.js');
const SCRATCH = path.join(__dirname, 'scratch-ship');
const FAKEHOME = path.join(SCRATCH, 'home');
const REMOTE = path.join(SCRATCH, 'remote.git');
const REPO = path.join(SCRATCH, 'repo');
const CFG = path.join(REPO, '.claude', 'orch.json');
const AUDIT = path.join(REPO, '.claude', 'orch-audit.jsonl');
const LOCK = path.join(FAKEHOME, '.claude', 'orch-lock.json');

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  // .git objects can be read-only on Windows; chmod before rm so teardown
  // (and re-runs) never fail on "permission denied".
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      try { fs.chmodSync(full, 0o777); } catch {}
      if (e.isDirectory()) walk(full);
    }
  };
  try { walk(p); } catch {}
  fs.rmSync(p, { recursive: true, force: true });
}

function g(...args) {
  return execFileSync('git', args, { cwd: REPO,
    env: { ...process.env, HOME: FAKEHOME, USERPROFILE: FAKEHOME }, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}
function gTry(...args) { try { return g(...args); } catch { return null; } }

function run(cmd, extraEnv = {}) {
  const payload = JSON.stringify({ session_id: 's', cwd: REPO, tool_input: { command: cmd } });
  try {
    execFileSync('node', [HOOK], { input: payload, cwd: REPO,
      env: { ...process.env, HOME: FAKEHOME, USERPROFILE: FAKEHOME, ORCH_ROLE: '', ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
    return { code: 0, stderr: '' };
  } catch (e) {
    return { code: e.status, stderr: (e.stderr || Buffer.alloc(0)).toString() };
  }
}

function writeFile(rel, content) {
  const full = path.join(REPO, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content == null ? 'x\n' : content);
}
function setCfg(obj) { fs.mkdirSync(path.dirname(CFG), { recursive: true }); fs.writeFileSync(CFG, JSON.stringify(obj)); }
function setCfgRaw(str) { fs.mkdirSync(path.dirname(CFG), { recursive: true }); fs.writeFileSync(CFG, str); }
function setLock(obj) { fs.mkdirSync(path.dirname(LOCK), { recursive: true }); fs.writeFileSync(LOCK, JSON.stringify(obj)); }
function rmLock() { try { fs.unlinkSync(LOCK); } catch {} }
function auditLines() {
  try { return fs.readFileSync(AUDIT, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); }
  catch { return []; }
}
function cleanTree() {
  gTry('reset', '--hard', 'HEAD');
  // -e .claude: the config + audit file live there, untracked by design —
  // a plain `clean -fd` would delete them along with test scratch files.
  gTry('clean', '-fd', '-e', '.claude');
}

let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}

// ---------------------------------------------------------------- bootstrap
rmrf(SCRATCH);
fs.mkdirSync(path.join(FAKEHOME, '.claude'), { recursive: true });
fs.mkdirSync(REMOTE, { recursive: true });
execFileSync('git', ['init', '--bare', REMOTE], { stdio: 'ignore' });
// Bare remote's HEAD symref -> main; the gate never asks the remote for it —
// the first-push test sets origin/HEAD locally with `git remote set-head`.
execFileSync('git', ['-C', REMOTE, 'symbolic-ref', 'HEAD', 'refs/heads/main'], { stdio: 'ignore' });
fs.mkdirSync(REPO, { recursive: true });
execFileSync('git', ['init', '-b', 'main', REPO], { stdio: 'ignore' });
g('config', 'user.email', 'test@example.com');
g('config', 'user.name', 'Test');
g('config', 'commit.gpgsign', 'false');
g('config', 'core.autocrlf', 'false');
writeFile('README.md', 'seed\n');
writeFile('src/core/seed.js', 'seed\n');
g('add', '.');
g('commit', '-m', 'seed');
g('remote', 'add', 'origin', REMOTE);
g('push', '-u', 'origin', 'main');
// Deliberately no `remote set-head` here — refs/remotes/origin/HEAD stays
// absent locally so the first-push refusal actually exercises that path.

const repoKey = resolveRepoKey(REPO);

const DOMAINS = {
  docs: { paths: ['docs/**', '**/*.md'], decide: 'ai', ship: 'push' },
  tests: { paths: ['tests/**'], decide: 'ai', ship: 'commit' },
  core: { paths: ['src/core/**'], decide: 'human', ship: 'none' },
  claude: { paths: ['.claude/**'], decide: 'ai', ship: 'push' },
};
const BASE_CONTRACT = { contract: { domains: DOMAINS } };
// Wrap BASE_CONTRACT in repo-scoped format for lock writes
const BASE_CONTRACT_SCOPED = { repos: { [repoKey]: BASE_CONTRACT } };

// ===================================================== INACTIVE / INVALID
setCfg({});
check('1. no contract key -> 0', run('git commit -m x').code === 0);

setCfg({ contract: { domains: {} } });
check('2. valid empty domains -> 0', run('git commit -m x').code === 0);

setCfg({ contract: {} });
check('3. contract with no domains -> 2', run('git commit -m x').code === 2);

setCfg({ contract: { domains: null } });
check('4. domains:null -> 2', run('git commit -m x').code === 2);

setCfg({ contract: { domains: { x: null } } });
check('5. domain entry null -> 2 (no throw)', run('git commit -m x').code === 2);

setCfg({ contract: { domains: { x: { ship: 'toString', decide: 'ai', paths: [] } } } });
check('6. ship:"toString" -> 2', run('git commit -m x').code === 2);

setCfg({ contract: { domains: { x: { ship: 'yeet', decide: 'ai', paths: [] } } } });
check('7. ship:"yeet" -> 2', run('git commit -m x').code === 2);

setCfg({ contract: { domains: { x: { ship: 'commit', decide: 'ai', paths: 'nope' } } } });
check('8. non-array paths -> 2', run('git commit -m x').code === 2);

setCfgRaw('{ nope');
check('9. corrupt config file -> 2 for commit', run('git commit -m x').code === 2);
check('10. corrupt config + non-git command -> 0', run('ls -la').code === 0);

// ===================================================== BASIC GRANTS
setCfg(BASE_CONTRACT);

writeFile('tests/t11.js');
g('add', 'tests/t11.js');
check('11. staged tests file, commit -> 0', run('git commit -m x').code === 0);
g('commit', '-m', 't11'); g('push');

writeFile('tests/t12.js');
g('add', 'tests/t12.js'); g('commit', '-m', 't12'); // unpushed
check('12. unpushed tests commit, push -> 2 (commit grant stops at push)', run('git push').code === 2);
g('push'); // land it for hygiene — real push via harness, not hook

writeFile('docs/d13.md');
g('add', 'docs/d13.md');
check('13. staged docs file, commit -> 0', run('git commit -m x').code === 0);
g('commit', '-m', 'd13');
check('14. its push -> 0 (push grant)', run('git push').code === 0);
g('push');

// ===================================================== REVIEWER (spec §6 row 1, ADVISORY)
writeFile('docs/d14r.md');
g('add', 'docs/d14r.md');
{ const r = run('git commit -m x', { ORCH_ROLE: 'reviewer' });
  check('14r-a. commit under ORCH_ROLE=reviewer -> 2, names the role and ADVISORY', r.code === 2 && /reviewer/.test(r.stderr) && /ADVISORY/.test(r.stderr)); }
check('14r-b. audit line carries role:reviewer + label:ADVISORY', auditLines().some(a => a.role === 'reviewer' && a.label === 'ADVISORY' && a.verdict === 'BLOCK'));
check('14r-c. push under reviewer -> 2', run('git push', { ORCH_ROLE: 'reviewer' }).code === 2);
check('14r-d. read op under reviewer -> 0', run('git status', { ORCH_ROLE: 'reviewer' }).code === 0);
check('14r-e. other role, same commit -> 0', run('git commit -m x', { ORCH_ROLE: 'dev' }).code === 0);
setCfg({});
check('14r-f. no contract at all, reviewer commit still -> 2', run('git commit -m x', { ORCH_ROLE: 'reviewer' }).code === 2);
setCfg(BASE_CONTRACT);
g('commit', '-m', 'd14r'); g('push');

writeFile('src/core/c15.js');
g('add', 'src/core/c15.js');
{ const r = run('git commit -m x'); check('15. staged core file, commit -> 2, names core', r.code === 2 && r.stderr.includes('core')); }
cleanTree();

writeFile('docs/d16.md'); writeFile('src/core/c16.js');
g('add', 'docs/d16.md', 'src/core/c16.js');
check('16. staged docs+core together -> 2 (strictest)', run('git commit -m x').code === 2);
cleanTree();

writeFile('mystery/z.bin');
g('add', 'mystery/z.bin');
{ const r = run('git commit -m x'); check('17. staged unmatched file -> 2, mentions ADR/amendment', r.code === 2 && /ADR|amendment/i.test(r.stderr)); }
cleanTree();

writeFile('deep/nest/notes.md');
g('add', 'deep/nest/notes.md');
check('18. staged deep/nest/notes.md -> 0 (**/*.md nested)', run('git commit -m x').code === 0);
g('commit', '-m', 'notes'); g('push');

writeFile('docs2/evil.bin');
g('add', 'docs2/evil.bin');
check('19. staged docs2/evil.bin -> 2 (anchoring)', run('git commit -m x').code === 2);
cleanTree();

// ===================================================== ALWAYS-UNION TRADE-OFF
writeFile('src/core/seed.js', 'dirty\n'); // tracked file, made dirty, NOT staged
writeFile('docs/d20.md');
g('add', 'docs/d20.md');
check('20. dirty core file + staged docs -> 2 (state-based price)', run('git commit -m x').code === 2);
gTry('checkout', '--', 'src/core/seed.js');
cleanTree();

// ===================================================== SEGMENTS / DENY-BY-DEFAULT
writeFile('tests/t21.js');
g('add', 'tests/t21.js');
check('21. commit&&push, commit-grant only -> 2', run('git commit -m x && git push').code === 2);
check('22. push&&commit, order independent -> 2', run('git push && git commit -m x').code === 2);
cleanTree();

check('23. git ci -m x (alias) -> 2', run('git ci -m x').code === 2);
check("24. git p'u'sh (quoted) -> 2", run("git p'u'sh").code === 2);
check('25. C=push; git $C -> 2', run('C=push; git $C').code === 2);
check('26. git pull -> 2', run('git pull').code === 2);
check('27. git tag v1 -> 2', run('git tag v1').code === 2);
check('28. git merge feat -> 2', run('git merge feat').code === 2);
check('29. git merge --continue -> 2', run('git merge --continue').code === 2);
check('30. git rebase main -> 2', run('git rebase main').code === 2);
check('31. git cherry-pick abc -> 2', run('git cherry-pick abc').code === 2);
check('32. git revert HEAD -> 2', run('git revert HEAD').code === 2);
check('33. git am patch -> 2', run('git am patch').code === 2);
// Pruned-from-READ_ALLOW subcommands (delta #3) — lock the denial in.
check('git worktree list -> 2 (denied)', run('git worktree list').code === 2);
check('git clone x -> 2 (denied)', run('git clone x').code === 2);
check('git init -> 2 (denied)', run('git init').code === 2);
check('git archive HEAD -> 2 (denied)', run('git archive HEAD').code === 2);
check('git format-patch -1 -> 2 (denied)', run('git format-patch -1').code === 2);
check('git clean -n -> 2 (denied)', run('git clean -n').code === 2);

// Worktree allowlist (spec §5): only add --detach / remove under <common-dir>/orch/wt/.
const WT = path.join(repoKey, 'orch', 'wt', 'M53.G142.S1.R1');
check('git worktree add --detach <common>/orch/wt/<id> HEAD -> 0', run(`git worktree add --detach "${WT}" HEAD`).code === 0);
check('git worktree remove <common>/orch/wt/<id> -> 0', run(`git worktree remove "${WT}"`).code === 0);
check('git worktree remove --force <common>/orch/wt/<id> -> 0', run(`git worktree remove --force "${WT}"`).code === 0);
check('git worktree add --detach elsewhere -> 2', run(`git worktree add --detach "${path.join(SCRATCH, 'elsewhere')}" HEAD`).code === 2);
check('git worktree add (no --detach) under the prefix -> 2', run(`git worktree add "${WT}" HEAD`).code === 2);
check('git worktree prune -> 2', run('git worktree prune').code === 2);
check('git worktree remove ../escape -> 2', run(`git worktree remove "${path.join(repoKey, 'orch', 'wt', '..', '..', 'x')}"`).code === 2);

// Lane worktree roots (workflow.worktreeRoots): full add/remove under a granted repo-relative root only.
{
  const saved = fs.readFileSync(CFG, 'utf8');
  const LANE = path.join(REPO, '.worktrees', 'lane-x');
  check('worktreeRoots absent: add -b under .worktrees -> 2', run(`git worktree add ".worktrees/lane-x" -b lane/x HEAD`).code === 2);
  setCfg({ ...JSON.parse(saved), workflow: { worktreeRoots: ['.worktrees'] } });
  check('worktreeRoots: relative <path> under root -> 0', run(`git worktree add -b lane/x ".worktrees/lane-x" HEAD`).code === 0);
  check('worktreeRoots: add -b <br> <path> <ref> under root -> 0', run(`git worktree add -b lane/x ".worktrees/lane-x" HEAD`).code === 0);
  check('worktreeRoots: add --detach <path> <ref> under root -> 0', run(`git worktree add --detach "${LANE}" HEAD`).code === 0);
  check('worktreeRoots: add <path> under root -> 0', run(`git worktree add "${LANE}"`).code === 0);
  check('worktreeRoots: remove --force <path> under root -> 0', run(`git worktree remove --force "${LANE}"`).code === 0);
  check('worktreeRoots: add outside root -> 2', run(`git worktree add -b lane/x "${path.join(SCRATCH, 'elsewhere')}" HEAD`).code === 2);
  check('worktreeRoots: add ../escape via root -> 2', run(`git worktree add -b lane/x "${path.join(REPO, '.worktrees', '..', '..', 'x')}" HEAD`).code === 2);
  check('worktreeRoots: add with extra flag -> 2', run(`git worktree add -b lane/x --force "${LANE}" HEAD`).code === 2);
  check('worktreeRoots: prune still -> 2', run('git worktree prune').code === 2);
  setCfg({ ...JSON.parse(saved), workflow: { worktreeRoots: ['..', 'D:/abs'] } });
  check('worktreeRoots: absolute/.. roots ignored -> 2', run(`git worktree add -b lane/x "${LANE}" HEAD`).code === 2);
  setCfgRaw(saved);
}

writeFile('docs/d34.md');
g('add', 'docs/d34.md');
check('34. blocked word inside commit MESSAGE is fine -> 0', run('git commit -m "revert the parser fix"').code === 0);
g('commit', '-m', 'd34'); g('push');

check('35a. git status -> 0', run('git status').code === 0);
check('35b. git log -> 0', run('git log').code === 0);
check('35c. git checkout -b x -> 0 (allowlist, never actually runs)', run('git checkout -b x').code === 0);

// ===================================================== RETARGET
check('36. git -C ../other push -> 2', run('git -C ../other push').code === 2);
check('37. git --git-dir=x push -> 2', run('git --git-dir=x push').code === 2);
check('38. GIT_DIR=/x git push -> 2', run('GIT_DIR=/x git push').code === 2);
check('39. cd ../victim && git commit -m x -> 2', run('cd ../victim && git commit -m x').code === 2);
check('40. cd sub && git status -> 0 (cd + read op benign)', run('cd sub && git status').code === 0);

// ===================================================== PUSH SHAPE
check('45. push origin feature:main -> 2', run('git push origin feature:main').code === 2);
check('46. push origin "feature:main" quoted refspec seen -> 2', run('git push origin "feature:main"').code === 2);
check('47. push --all -> 2', run('git push --all').code === 2);
check('48. push --mirror -> 2', run('git push --mirror').code === 2);
check('49. push --tags -> 2', run('git push --tags').code === 2);
check('50. push --delete br -> 2', run('git push --delete br').code === 2);
check('51. push --force -> 2', run('git push --force').code === 2);
check('52. push --follow-tags (unknown flag) -> 2', run('git push --follow-tags').code === 2);

// CRITICAL-1 regression: every push segment must be shape-checked, not just
// the last one — a bad refspec push followed by a clean plain push must
// still die (previously the clean segment's slot overwrote the bad one's).
check('git push origin a:b && git push -> 2 (every push segment checked)', run('git push origin a:b && git push').code === 2);

// IMPORTANT-1 regression: path-prefixed git invocations must not bypass the
// gate — match on the token's basename, not the literal string "git".
writeFile('src/core/pathgit.js');
g('add', 'src/core/pathgit.js'); // core domain: ship:none — any push must be blocked
check('/usr/bin/git push -> 2 (path-prefixed git not a bypass)', run('/usr/bin/git push').code === 2);
cleanTree();

writeFile('docs/d53.md');
g('add', 'docs/d53.md'); g('commit', '-m', 'd53'); // unpushed, docs domain (push grant)
check('53. push -u origin <current-branch> -> 0', run('git push -u origin main').code === 0);
g('push');

// Built-in evidence commit grant (spec §5): worklogs, reviews, ADRs are committable by any role,
// matched before domains; a domain may lift it to push, never lower it.
setCfg({ contract: { domains: { docs: { paths: ['docs/**'], decide: 'ai', ship: 'none' }, src: { paths: ['src/**'], decide: 'ai', ship: 'commit' } } } });
writeFile('docs/reviews/M1.G1.S1.R1.md', 'review: M1.G1.S1.R1\n');
g('add', 'docs/reviews/M1.G1.S1.R1.md');
check('evidence under a ship:none domain -> commit 0 (built-in grant wins)', run('git commit -m manifest').code === 0);
check('evidence under a ship:none domain -> push 2 (floor is commit; none does not lift)', run('git push').code === 2);
{ const last = auditLines().filter(e => e.verdict === 'ALLOW').pop(); check('audit names the evidence grant', !!last && last.domain === 'evidence'); }
g('commit', '-m', 'manifest'); g('push');
writeFile('tmp/worklogs/G1-x.md', 'BRIEF\n');
g('add', '-f', 'tmp/worklogs/G1-x.md');
check('unmatched worklog path -> commit 0 (evidence grant before "unmatched")', run('git commit -m wl').code === 0);
g('commit', '-m', 'wl'); g('push');
setCfg(BASE_CONTRACT); // docs: push — lifts the evidence floor
writeFile('docs/adr/0001-x.md', 'x\n');
g('add', 'docs/adr/0001-x.md'); g('commit', '-m', 'adr');
check('evidence under a ship:push domain -> push 0 (domain lifts the floor)', run('git push').code === 0);
g('push');
writeFile('docs/plain.md', 'x\n');
g('add', 'docs/plain.md');
setCfg({ contract: { domains: { docs: { paths: ['docs/**'], decide: 'ai', ship: 'none' } } } });
check('a non-evidence docs file under ship:none -> commit 2 (the grant is path-specific)', run('git commit -m plain').code === 2);
cleanTree(); setCfg(BASE_CONTRACT);

check('54. commit --allow-empty on clean tree -> 2 (empty set)', run('git commit --allow-empty -m x').code === 2);

check('55. commit --amend -> 2, denied (no amend-union path)', run('git commit --amend -m x').code === 2);
check('commit --am -m x -> 2, denied (unambiguous abbreviation)', run('git commit --am -m x').code === 2);
check('commit --ame -m x -> 2, denied (unambiguous abbreviation)', run('git commit --ame -m x').code === 2);
check('commit --amen -m x -> 2, denied (unambiguous abbreviation)', run('git commit --amen -m x').code === 2);

// ===================================================== MERGE-COMMIT PUSH (diff-not-log)
g('checkout', '-b', 'feature-merge');
writeFile('docs/merged.md');
g('add', 'docs/merged.md'); g('commit', '-m', 'feature docs');
g('checkout', 'main');
g('merge', '--no-ff', 'feature-merge', '-m', 'merge feature-merge');
g('branch', '--unset-upstream'); // force base fallback (local origin/HEAD symref) instead of @{u}
gTry('remote', 'set-head', 'origin', '-a'); // the gate never calls the remote — origin/HEAD must already be set locally
{
  const r = run('git push');
  check('56a. merge-commit push, base fallback -> 0', r.code === 0);
  const last = auditLines().filter(e => e.verdict === 'ALLOW').pop();
  check('56b. audit files include merged docs file (diff, not log)', !!last && last.files.includes('docs/merged.md'));
}
gTry('symbolic-ref', '--delete', 'refs/remotes/origin/HEAD'); // restore: origin/HEAD unset locally for the first-push test below
g('push', '-u', 'origin', 'main');
gTry('branch', '-d', 'feature-merge');

// ===================================================== FIRST PUSH OF A NEW BRANCH (no remote call — spec §5 / v2 "a gate never talks to the remote")
g('checkout', '-b', 'feat-new');
writeFile('docs/newbranch.md');
g('add', 'docs/newbranch.md'); g('commit', '-m', 'new branch docs'); // no upstream yet, origin/HEAD unset locally
{
  const r = run('git push -u origin feat-new');
  check('first push with origin/HEAD unset -> 2, names remote set-head', r.code === 2 && /git remote set-head origin -a/.test(r.stderr));
}
g('remote', 'set-head', 'origin', '-a'); // the operator's one-time step
check('first push after set-head -> 0 (merge-base against origin/HEAD, local only)', run('git push -u origin feat-new').code === 0);
g('push', '-u', 'origin', 'feat-new');
g('checkout', 'main');

// ===================================================== NO-REMOTE PUSH
{
  const url = g('remote', 'get-url', 'origin').trim();
  g('remote', 'remove', 'origin');
  check('no-remote push -> 2 (unresolvable base)', run('git push').code === 2);
  g('remote', 'add', 'origin', url);
  g('push', '-u', 'origin', 'main'); // restore tracking refs for later checks
}

// ===================================================== LOCK REPLACEMENT
setCfg({ contract: { domains: { ...DOMAINS, free: { paths: ['free/**'], decide: 'ai', ship: 'push' } } } });
setLock(BASE_CONTRACT_SCOPED);
writeFile('free/x.txt');
g('add', 'free/x.txt');
check('57. project-added domain dead under lock -> 2', run('git commit -m x').code === 2);
cleanTree();
rmLock();
setCfg(BASE_CONTRACT);

// ===================================================== SEGMENT/RETARGET ADDITIONS (REV-4 delta)
check("git submodule foreach 'git push' -> 2 (denied)", run("git submodule foreach 'git push'").code === 2);
check('git remote set-url origin ../x -> 2 (denied)', run('git remote set-url origin ../x').code === 2);
check("git config alias.x '!git push' -> 2 (denied)", run("git config alias.x '!git push'").code === 2);
check('Push-Location ../victim; git push -> 2 (retarget)', run('Push-Location ../victim; git push').code === 2);
check('sl ../victim; git push -> 2 (retarget)', run('sl ../victim; git push').code === 2);
check('git -C do push -> 2 (keyword-severed retarget denies, not skips)', run('git -C do push').code === 2);
check('{ cd ../victim && git push; } -> 2 (grouping split)', run('{ cd ../victim && git push; }').code === 2);

writeFile('tests/msgsafe.js');
g('add', 'tests/msgsafe.js');
check('git commit -m "wip; git push later" -> 0 (message text safe)', run('git commit -m "wip; git push later"').code === 0);
g('commit', '-m', 'msgsafe'); g('push');

// ===================================================== AUDIT
{
  const lines = auditLines();
  check('58. audit has ALLOW lines with domain', lines.some(e => e.verdict === 'ALLOW' && e.domain));
  check('59. audit has BLOCK lines', lines.some(e => e.verdict === 'BLOCK'));
  check('60. audit has real denied label (git merge)', lines.some(e => e.action === 'denied:git merge'));
  check('61. audit has a reason line from a die path', lines.some(e => typeof e.reason === 'string' && e.reason.length > 0));
}
{
  const before = auditLines().length;
  const bigCmd = 'git status ' + 'x'.repeat(1_100_000);
  const r = run(bigCmd);
  const after = auditLines();
  check('62. oversized payload -> 2', r.code === 2);
  check('62b. oversized die still audited (cwd=REPO fallback)', after.length > before && after[after.length - 1].action === 'invalid');
}

// 63 (delta): exemption proven WITHOUT a .claude/** domain granting it.
setCfg({ contract: { domains: { docs: DOMAINS.docs, tests: DOMAINS.tests, core: DOMAINS.core } } });
writeFile('docs/d63.md');
g('add', '-f', '.claude/orch-audit.jsonl');
g('add', 'docs/d63.md');
{
  const r = run('git commit -m x');
  check('63a. audit file + docs file, no claude domain -> 0 (self-exemption)', r.code === 0);
  const last = auditLines().filter(e => e.verdict === 'ALLOW').pop();
  const auditRel = 'docs/d63.md'; // sanity: expected content member
  check('63b. logged files never include the audit path itself', !!last && last.files.includes(auditRel) && !last.files.some(f => f.replace(/\\/g, '/').endsWith('.claude/orch-audit.jsonl')));
}
gTry('reset');
try { fs.unlinkSync(path.join(REPO, 'docs', 'd63.md')); } catch {}
setCfg(BASE_CONTRACT);

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
