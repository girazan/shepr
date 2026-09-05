// Contract v2 schema + lock-bundle semantics (spec §1). Unit-style: requires
// lib directly with a fake HOME so loadLock reads our scratch lock file.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRATCH = path.join(__dirname, 'scratch-contract');
const FAKEHOME = path.join(SCRATCH, 'home');
const PROJ = path.join(SCRATCH, 'proj');
const LOCK = path.join(FAKEHOME, '.claude', 'orch-lock.json');
const PROJCFG = path.join(PROJ, '.claude', 'orch.json');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(path.dirname(LOCK), { recursive: true });
fs.mkdirSync(path.dirname(PROJCFG), { recursive: true });
process.env.USERPROFILE = FAKEHOME;
process.env.HOME = FAKEHOME;
// os.homedir() reads env at call time on win32 (USERPROFILE) — require after env set.
const { loadConfig } = require('../hooks/lib/config');

let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
function rmIf(p) { try { fs.unlinkSync(p); } catch {} }
const J = { cwd: PROJ };

// -- lock provenance --
rmIf(LOCK); rmIf(PROJCFG);
check('no lock: __lock.present false', loadConfig(J).__lock.present === false);
fs.writeFileSync(LOCK, '{ not json');
const corrupt = loadConfig(J);
check('corrupt lock: present+corrupt', corrupt.__lock.present === true && corrupt.__lock.corrupt === true);
check('corrupt lock: __lockCorrupt flag', corrupt.__lockCorrupt === true);

// -- bundle replacement (repo-scoped, v0.7.0 extension) --
execFileSync('git', ['init', '-q'], { cwd: PROJ });
execFileSync('git', ['-C', PROJ, 'config', 'user.email', 't@t.com']);
execFileSync('git', ['-C', PROJ, 'config', 'user.name', 't']);
const { resolveRepoKey } = require('../hooks/lib/config');
const repoKey = resolveRepoKey(PROJ);

fs.writeFileSync(PROJCFG, JSON.stringify({
  contract: { schemaVersion: 2, domains: { web: { paths: ['web/**'], decide: 'ai', ship: 'commit' } } },
  models: { low: 'haiku', mid: 'sonnet', high: 'opus', frontier: 'opus' } }));
fs.writeFileSync(LOCK, JSON.stringify({
  repos: { [repoKey]: { contract: { schemaVersion: 2, domains: { core: { paths: ['src/**'], decide: 'human', ship: 'none',
    tiers: { work: 'mid', review: 'high' } } } } } } }));
const bundled = loadConfig(J);
check('locked contract replaces project contract', !!bundled.contract.domains.core && !bundled.contract.domains.web);
check('lock without models REPLACES models with undefined (bundle is atomic)', bundled.models === undefined);
fs.writeFileSync(LOCK, JSON.stringify({
  repos: { [repoKey]: { contract: { schemaVersion: 2, domains: {} },
    models: { low: 'haiku', mid: 'sonnet', high: 'opus', frontier: 'opus' } } } }));
check('locked models carried when lock owns contract', loadConfig(J).models.low === 'haiku');
fs.writeFileSync(LOCK, JSON.stringify({ destructiveGit: { enabled: true } }));
check('lock without contract leaves project contract+models alone',
  loadConfig(J).contract.domains.web && loadConfig(J).models.mid === 'sonnet');

// -- repo scoping isolation --
fs.writeFileSync(LOCK, JSON.stringify({ contract: { schemaVersion: 2, domains: { legacy: {} } } })); // legacy top-level, unmigrated
check('legacy top-level contract is inert (not adopted)', loadConfig(J).contract.domains.web && !loadConfig(J).contract.domains.legacy);
const OTHER = path.join(SCRATCH, 'other-repo');
fs.mkdirSync(OTHER, { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: OTHER });
fs.writeFileSync(LOCK, JSON.stringify({
  destructiveGit: { enabled: true },
  repos: { [repoKey]: { contract: { schemaVersion: 2, domains: { core: {} } } } } }));
check('destructiveGit guard toggle applies globally (still top-level, not repo-scoped)', loadConfig({ cwd: OTHER }).destructiveGit.enabled === true);
const otherCfg = loadConfig({ cwd: OTHER });
check("other repo's config does not see PROJ's repo-scoped contract", !otherCfg.contract || !otherCfg.contract.domains || !otherCfg.contract.domains.core);
const nonRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-non-repo-'));
check('resolveRepoKey returns null for a cwd outside any git repository', resolveRepoKey(nonRepoDir) === null);
fs.rmSync(nonRepoDir, { recursive: true, force: true });

// -- linked worktree shares the main checkout's repo key --
const WT_MAIN = path.join(SCRATCH, 'wt-main');
const WT_LINKED = path.join(SCRATCH, 'wt-linked');
fs.mkdirSync(WT_MAIN, { recursive: true });
execFileSync('git', ['init', '-q'], { cwd: WT_MAIN });
execFileSync('git', ['-C', WT_MAIN, 'config', 'user.email', 't@t.com']);
execFileSync('git', ['-C', WT_MAIN, 'config', 'user.name', 't']);
fs.writeFileSync(path.join(WT_MAIN, 'f.txt'), 'x');
execFileSync('git', ['-C', WT_MAIN, 'add', 'f.txt']);
execFileSync('git', ['-C', WT_MAIN, 'commit', '-q', '-m', 'init']);
execFileSync('git', ['-C', WT_MAIN, 'worktree', 'add', WT_LINKED, '-b', 'wt-branch']);
check('resolveRepoKey: linked worktree shares main checkout\'s repo key',
  resolveRepoKey(WT_MAIN) === resolveRepoKey(WT_LINKED) && resolveRepoKey(WT_MAIN) !== null);

// -- lib/contract.js (schema helpers, spec §1) --
const C = require('../hooks/lib/contract');
const MODELS = { low: 'haiku', mid: 'sonnet', high: 'opus', frontier: 'opus' };
check('rankIndex orders low<mid<high<frontier',
  C.rankIndex('low') < C.rankIndex('mid') && C.rankIndex('mid') < C.rankIndex('high') &&
  C.rankIndex('high') < C.rankIndex('frontier'));
check('rankIndex unknown role is -1', C.rankIndex('turbo') === -1);
check('modelRank resolves duplicate to HIGHEST rank (fail-strict)',
  C.modelRank(MODELS, 'opus') === C.rankIndex('frontier'));
check('modelRank unmapped model is -1', C.modelRank(MODELS, 'gpt-5') === -1);
check('validateModels: complete map valid', C.validateModels(MODELS).length === 0);
check('validateModels: missing role reported', C.validateModels({ low: 'haiku' }).length > 0);
check('validateModels: non-string value reported', C.validateModels({ ...MODELS, mid: 7 }).length > 0);
const CONTRACT = { schemaVersion: 2, domains: {
  web: { paths: ['web/**'], decide: 'ai', ship: 'commit' },
  numerics: { paths: ['src/**'], decide: 'ai', ship: 'commit', tiers: { work: 'mid', review: 'high' } },
  safety: { paths: ['sis/**'], decide: 'human', ship: 'none', tiers: { work: 'high', review: 'frontier' } } } };
const f1 = C.floorsFor(CONTRACT, ['numerics', 'safety']);
check('floorsFor takes the HIGHEST floor across domains (strictest wins)',
  f1.work === C.rankIndex('high') && f1.review === C.rankIndex('frontier'));
check('floorsFor ignores tier-less domains but keeps tiered ones',
  C.floorsFor(CONTRACT, ['web', 'numerics']).work === C.rankIndex('mid'));
check('floorsFor null when no named domain has tiers', C.floorsFor(CONTRACT, ['web']) === null);
check('floorsFor null for unknown domains', C.floorsFor(CONTRACT, ['nope']) === null);
check('schemaVersion 2 detected', C.schemaVersion(CONTRACT) === 2);
check('schemaVersion absent = 1, regardless of edit revision', C.schemaVersion({ version: 9, domains: {} }) === 1);
check('schemaVersion string "2" coerces to 2', C.schemaVersion({ schemaVersion: '2', domains: {} }) === 2);

check('validateTiers: valid contract is []', C.validateTiers(CONTRACT).length === 0);
check('validateTiers: misspelled role names the domain+key', C.validateTiers({ schemaVersion: 2, domains: {
  numerics: { paths: ['src/**'], decide: 'ai', ship: 'commit', tiers: { work: 'medium', review: 'high' } } } })
  .some(p => p.includes('numerics') && p.includes('work')));
check('validateTiers: unknown tiers key reported', C.validateTiers({ schemaVersion: 2, domains: {
  numerics: { paths: ['src/**'], decide: 'ai', ship: 'commit', tiers: { work: 'mid', approve: 'high' } } } })
  .some(p => p.includes('approve')));
check('validateTiers: domain without tiers is ignored', C.validateTiers({ schemaVersion: 2, domains: {
  web: { paths: ['web/**'], decide: 'ai', ship: 'commit' } } }).length === 0);

check('globToRe: ** spans directories, * stays in one, **/ is optional',
  C.globToRe('src/**').test('src/a/b.js') && !C.globToRe('src/*').test('src/a/b.js') && C.globToRe('**/*.md').test('x.md') && C.globToRe('**/*.md').test('deep/nest/x.md') && !C.globToRe('docs/**').test('docs2/evil.bin'));

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
