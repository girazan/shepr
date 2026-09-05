// scripts/tools.js — stage → skill routing (spec §9). Fake home with the three
// places a skill can live; fake project with orch.json and the tracker doc.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SCRATCH = path.join(__dirname, 'scratch-tools');
const HOME = path.join(SCRATCH, 'home');
const CWD = path.join(SCRATCH, 'proj');
const ORCH = path.join(CWD, '.claude', 'orch.json');
const TRACKER = path.join(CWD, 'docs', 'agents', 'issue-tracker.md');
fs.rmSync(SCRATCH, { recursive: true, force: true });

function skill(dir, name, body) { const p = path.join(dir, name); fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, 'SKILL.md'), body); return path.join(p, 'SKILL.md'); }
const TDD = skill(path.join(HOME, '.claude', 'skills'), 'tdd', '---\nname: tdd\ndescription: x\n---\n\n# TDD\n');
skill(path.join(HOME, '.agents', 'skills'), 'safe-refactor', '---\nname: safe-refactor\ndescription: x\n---\n\nbody\n');
const PLUG = path.join(HOME, '.claude', 'plugins', 'cache', 'm', 'pocock', '2.1.0');
skill(path.join(PLUG, 'skills'), 'to-spec', '---\nname: to-spec\ndescription: x\ndisable-model-invocation: true\n---\n\nbody\n');
fs.writeFileSync(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'pocock@m': [{ scope: 'user', installPath: PLUG, version: '2.1.0' }] } }));
fs.mkdirSync(path.dirname(ORCH), { recursive: true });
fs.writeFileSync(ORCH, JSON.stringify({ contract: { version: 1, domains: {} } }));

const { main, STAGES, TRACKER_PUBLISHING } = require('../scripts/tools');
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f, 'utf8')).digest('hex').slice(0, 12);
function run(argv) { let out = ''; const code = main([...argv, '--home', HOME, '--cwd', CWD], { stdout: s => { out += s; } }); return { code, out }; }
const cfg = () => JSON.parse(fs.readFileSync(ORCH, 'utf8'));

let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}

// --- the table ------------------------------------------------------------------
check('STAGES is the §9 table: 17 keys in order, unique', STAGES.map(s => s[0]).join() === 'define-milestone,grill,spec,split,fog,domain-model,tdd,debug,debug-echo,iterate,cleanup,fast,research,merge-conflicts,gate-rubric,merge-proof,handoff' && new Set(STAGES.map(s => s[0])).size === 17);
check('every row has role and native fallback; iterate and merge-conflicts have no chosen skill', STAGES.every(s => s[1] && s[3]) && STAGES.find(s => s[0] === 'iterate')[2] === null && STAGES.find(s => s[0] === 'merge-conflicts')[2] === null);
check('tracker-publishing skills are exactly the three the table chooses', TRACKER_PUBLISHING.join() === 'to-spec,to-tickets,wayfinder' && TRACKER_PUBLISHING.every(x => STAGES.some(s => s[2] === x)));

// --- list / check with no tools -----------------------------------------------
let r = run(['list']);
check('list names every stage with role, native, chosen and install state', r.code === 0 && r.out.includes(`tdd · Dev · native: ladder step 1 · chosen: tdd (installed ${sha(TDD)})`) && r.out.includes('spec · Architect · native: plan section · chosen: to-spec (installed 2.1.0)') && r.out.includes('iterate · Dev · native: hypothesis → change → measure · chosen: —') && r.out.includes('fast · Dev · native: implement → test · chosen: implement (not installed)'));
r = run(['check']);
check('check with no tools: every stage native, exit 0', r.code === 0 && r.out.trim().split('\n').length === 17 && r.out.trim().split('\n').every(l => /: native \(.+\)$/.test(l)));
fs.rmSync(ORCH);
r = run(['check']);
check('check without orch.json: all native, exit 0', r.code === 0 && /^define-milestone: native \(three questions\)$/m.test(r.out));
fs.writeFileSync(ORCH, JSON.stringify({ contract: { version: 1, domains: {} } }));

// --- pin ----------------------------------------------------------------------------
r = run(['pin', 'tdd=tdd']);
check('pin resolves a user-dir skill to name@sha12', r.code === 0 && JSON.parse(r.out).tdd === `tdd@${sha(TDD)}`);
r = run(['pin', 'cleanup=safe-refactor']);
check('pin finds a skill in ~/.agents/skills', r.code === 0 && /^safe-refactor@[0-9a-f]{12}$/.test(JSON.parse(r.out).cleanup));
r = run(['pin', 'tdd=native']);
check('pin <stage>=native writes null', r.code === 0 && JSON.parse(r.out).tdd === null);
r = run(['pin', 'fast=implement']);
check('pin refuses a skill that is not installed', r.code === 1 && /fast: "implement" is not installed/.test(r.out));
r = run(['pin', 'nope=tdd']);
check('pin refuses an unknown stage', r.code === 1 && /unknown stage "nope"/.test(r.out));
r = run(['pin', 'tdd']);
check('pin refuses a malformed argument', r.code === 1 && /use <stage>=<skill> or <stage>=native/.test(r.out));
r = run(['pin', 'spec=to-spec']);
check('pin refuses a tracker-publishing skill when the tracker doc is absent', r.code === 1 && /to-spec: publish to a tracker/.test(r.out) && /Local Markdown/.test(r.out) && /setup-matt-pocock-skills/.test(r.out));
fs.mkdirSync(path.dirname(TRACKER), { recursive: true });
fs.writeFileSync(TRACKER, '# Issue tracker: GitHub\n\nIssues live as GitHub issues.\n');
r = run(['pin', 'spec=to-spec']);
check('pin refuses a tracker-publishing skill when the tracker is GitHub', r.code === 1 && /Local Markdown/.test(r.out));
fs.writeFileSync(TRACKER, '# Issue tracker: Local Markdown\n\nIssues and specs for this repo live as markdown files in `.scratch/`.\n');
r = run(['pin', 'spec=to-spec']);
check('pin accepts it on the local-markdown tracker, version from the plugin', r.code === 0 && JSON.parse(r.out).spec === 'to-spec@2.1.0');
r = run(['pin', 'tdd=tdd', 'spec=to-spec', '--write']);
check('pin --write merges into workflow.tools and keeps the contract', r.code === 0 && /wrote 2 stage\(s\)/.test(r.out) && cfg().workflow.tools.tdd === `tdd@${sha(TDD)}` && cfg().workflow.tools.spec === 'to-spec@2.1.0' && cfg().contract.version === 1);
r = run(['pin', 'cleanup=safe-refactor', '--write']);
check('a second --write keeps earlier pins', r.code === 0 && cfg().workflow.tools.tdd && cfg().workflow.tools.cleanup);

// --- check against pins -------------------------------------------------------
r = run(['check']);
check('check: pinned and installed → ok with invoke mode and path', r.code === 0 && new RegExp(`^tdd: tdd@${sha(TDD)} ok · invoke: skill · .*SKILL\\.md$`, 'm').test(r.out) && /^spec: to-spec@2\.1\.0 ok · invoke: read · /m.test(r.out));
fs.appendFileSync(TDD, '\nedited\n');
r = run(['check']);
check('check: an edited skill is a version mismatch → native, says so', r.code === 0 && new RegExp(`^tdd: tdd@[0-9a-f]{12} mismatch \\(installed ${sha(TDD)}\\) → native \\(ladder step 1\\)`, 'm').test(r.out));
const j = JSON.parse(run(['check', '--json']).out);
check('check --json carries status/use per stage', j.stages.find(s => s.stage === 'tdd').status === 'mismatch' && j.stages.find(s => s.stage === 'tdd').use === 'native' && j.stages.find(s => s.stage === 'spec').use === 'to-spec' && j.stages.find(s => s.stage === 'fog').status === 'native');
const c = cfg(); c.workflow.tools.fast = 'implement@abc123abc123'; c.workflow.tools.bogus = 'x@y'; fs.writeFileSync(ORCH, JSON.stringify(c));
r = run(['check']);
check('check: a pinned skill that is not installed → missing → native', /^fast: implement@abc123abc123 missing → native \(implement → test\)$/m.test(r.out));
check('check: a key outside the table is reported as an unknown stage', /^bogus: unknown stage/m.test(r.out));
c.workflow.tools.cleanup = 'safe-refactor'; fs.writeFileSync(ORCH, JSON.stringify(c));
r = run(['check']);
check('check: a bare skill name (no @) resolves to the installed version and is ok', /^cleanup: safe-refactor@[0-9a-f]{12} ok/m.test(r.out));

// --- argv hygiene ------------------------------------------------------------------
let out = ''; let code = main(['check', '--home'], { stdout: s => { out += s; } });
check('bare --home is refused', code === 1 && /--home requires a value/.test(out));
out = ''; code = main([], { stdout: s => { out += s; } });
check('no verb prints usage, exit 1', code === 1 && /usage: tools <list\|check/.test(out));

fs.rmSync(SCRATCH, { recursive: true, force: true });
console.log(`\n${pass}/${n} pass`);
process.exit(fail ? 1 : 0);
