// session marker: lib, SessionStart hook, session-marker CLI. Fresh git
// repo per run so <git-common-dir> is real; fake HOME so no lock interferes.
'use strict';
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'hooks', 'session-start.js');
const CLI = path.join(__dirname, '..', 'scripts', 'session-marker.js');
const SCRATCH = path.join(__dirname, `scratch-session-${process.pid}`);
const FAKEHOME = path.join(SCRATCH, 'home');
const PROJ = path.join(SCRATCH, 'proj');
process.on('exit', () => { try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch {} });
fs.mkdirSync(path.join(FAKEHOME, '.claude'), { recursive: true });
fs.mkdirSync(PROJ, { recursive: true });
execFileSync('git', ['init', '-q', PROJ], { stdio: 'ignore' });

const { resolveRepoKey } = require('../hooks/lib/config');
const S = require('../hooks/lib/session');
const COMMON = resolveRepoKey(PROJ);
const ENVFILE = path.join(SCRATCH, 'env.sh');

let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
const baseEnv = { ...process.env, USERPROFILE: FAKEHOME, HOME: FAKEHOME, ORCH_ROLE: '', ORCH_IDS: '', ORCH_SESSION_ID: '', CLAUDE_ENV_FILE: '' };
function hook(session, env) {
  const r = spawnSync('node', [HOOK], { input: JSON.stringify({ session_id: session, cwd: PROJ }), env: { ...baseEnv, ...env }, encoding: 'utf8' });
  return { code: r.status, err: r.stderr || '' };
}
function cli(argv, env) {
  const r = spawnSync('node', [CLI, ...argv], { cwd: PROJ, env: { ...baseEnv, ...env }, encoding: 'utf8' });
  return { code: r.status, out: r.stdout || '' };
}
const marker = s => S.readMarker(COMMON, s);

// --- lib ---------------------------------------------------------------------
check('parseIds: full', JSON.stringify(S.parseIds('M53.G142.S2')) === '{"milestone":"M53","goal":"G142","step":"S2"}');
check('parseIds: milestone only / junk', S.parseIds('M53').goal === null && S.parseIds('G142').milestone === null && S.parseIds('').step === null);
check('markerPath sanitises the id', /session-a_b_c\.json$/.test(S.markerPath(COMMON, 'a/b:c')) && S.markerPath(COMMON, 'x').startsWith(path.join(COMMON, 'orch')));
check('ensureMarker without ORCH_ROLE = null, writes nothing', S.ensureMarker({ session_id: 'e0', cwd: PROJ }, {}).marker === null && marker('e0') === null);
const e1 = S.ensureMarker({ session_id: 'e1', cwd: PROJ }, { ORCH_ROLE: 'dev', ORCH_IDS: 'M53.G142.S2' }).marker;
check('ensureMarker materialises from env', e1.role === 'dev' && e1.milestone === 'M53' && e1.goal === 'G142' && e1.step === 'S2' && !Number.isNaN(Date.parse(e1.startedAt)) && marker('e1').role === 'dev');
check('ensureMarker returns the existing one, never rewrites startedAt', S.ensureMarker({ session_id: 'e1', cwd: PROJ }, { ORCH_ROLE: 'architect' }).marker.startedAt === e1.startedAt && marker('e1').role === 'dev');
check('ensureMarker with no session id = null', S.ensureMarker({ cwd: PROJ }, { ORCH_ROLE: 'dev' }).marker === null);

// --- SessionStart hook --------------------------------------------------------
check('hook without ORCH_ROLE: exit 0, no marker', hook('h0', {}).code === 0 && marker('h0') === null);
const h1 = hook('h1', { ORCH_ROLE: 'dev', ORCH_IDS: 'M53.G142.S2', CLAUDE_ENV_FILE: ENVFILE });
check('hook with role: exit 0, marker written', h1.code === 0 && marker('h1').step === 'S2');
check('hook exports ORCH_SESSION_ID into CLAUDE_ENV_FILE', fs.readFileSync(ENVFILE, 'utf8').includes('export ORCH_SESSION_ID="h1"'));
const started = marker('h1').startedAt;
check('second SessionStart keeps startedAt', hook('h1', { ORCH_ROLE: 'dev' }).code === 0 && marker('h1').startedAt === started);
check('hook with role but no ids: milestone/goal/step null', hook('h2', { ORCH_ROLE: 'coordinator' }).code === 0 && marker('h2').milestone === null && marker('h2').role === 'coordinator');
check('hook with unset CLAUDE_ENV_FILE is silent', hook('h3', { ORCH_ROLE: 'dev' }).code === 0 && hook('h3', { ORCH_ROLE: 'dev' }).err === '');

// --- CLI ----------------------------------------------------------------------
let r = cli(['set', '--goal', 'G143'], {});
check('set without a session id is refused', r.code === 1 && /ORCH_SESSION_ID/.test(r.out));
r = cli(['set', '--goal', 'G143'], { ORCH_SESSION_ID: 'h1' });
check('set --goal updates the marker, keeps startedAt, prints it', r.code === 0 && marker('h1').goal === 'G143' && marker('h1').startedAt === started && JSON.parse(r.out).goal === 'G143');
r = cli(['set', '--session', 'h2', '--ids', 'M60.G9'], {});
check('set --session --ids fills milestone and goal', r.code === 0 && marker('h2').milestone === 'M60' && marker('h2').goal === 'G9' && marker('h2').step === null);
r = cli(['set', '--session', 'h2', '--ids', 'M60.G9', '--step', 'S3'], {});
check('--step after --ids wins', r.code === 0 && marker('h2').step === 'S3');
r = cli(['set', '--session', 'h2', '--goal', 'nope'], {});
check('malformed id refused, marker unchanged', r.code === 1 && /goal must match/.test(r.out) && marker('h2').goal === 'G9');
r = cli(['set', '--session', 'h2', '--ids', 'G9'], {});
check('malformed --ids refused', r.code === 1 && /--ids must match/.test(r.out));
r = cli(['set', '--session', 'new1', '--goal', 'G1'], { ORCH_ROLE: 'coordinator' });
check('set on a missing marker creates one with the env role', r.code === 0 && marker('new1').role === 'coordinator' && marker('new1').goal === 'G1' && !Number.isNaN(Date.parse(marker('new1').startedAt)));
r = cli(['show', '--session', 'h1'], {});
check('show prints the marker', r.code === 0 && JSON.parse(r.out).role === 'dev');
r = cli(['show', '--session', 'absent'], {});
check('show on a missing marker exits 1', r.code === 1 && /no marker/.test(r.out));
r = cli(['frob'], {});
check('unknown verb prints usage', r.code === 1 && /usage: session-marker/.test(r.out));

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
