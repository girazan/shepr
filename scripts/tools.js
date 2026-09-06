#!/usr/bin/env node
// Skill routing (spec §9, d.32): workflow.tools maps a stage to ONE chosen
// skill, pinned to the version installed when /shepr:setup wrote it. This is
// data — no hook reads it. Skills call `check` (go, goal, board), setup
// calls `list` and `pin`. Orch ships only the native column.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The §9 table: key · role · chosen skill (Pocock-first; null = none) · native fallback.
// The spec's `debug` row names two skills, one per moment, hence two keys.
const STAGES = [
  ['define-milestone', 'Director', 'grilling', 'three questions'],
  ['grill', 'Architect', 'grill-with-docs', 'three questions'],
  ['spec', 'Architect', 'to-spec', 'plan section'],
  ['split', 'Architect', 'to-tickets', 'plan section'],
  ['fog', 'Architect', 'wayfinder', 'fog list in the plan section'],
  ['domain-model', 'Architect', 'domain-modeling', 'ADR'],
  ['tdd', 'Dev', 'tdd', 'ladder step 1'],
  ['debug', 'Dev', 'diagnosing-bugs', 'ladder step 1'],
  ['debug-echo', 'Dev', 'bug-echo', 'ladder step 1'],
  ['iterate', 'Dev', null, 'hypothesis → change → measure'],
  ['cleanup', 'Dev', 'safe-refactor', 'de-sloppify prompt'],
  ['fast', 'Dev', 'implement', 'implement → test'],
  ['research', 'Architect, Dev', 'research', 'web search → grade sources'],
  ['merge-conflicts', 'Dev', null, 'stop, park for owner'],
  ['gate-rubric', 'Gate', 'code-review', 'review-goal.md'],
  ['merge-proof', 'Dev', 'verify-and-stop', 'full-suite verdict line'],
  ['handoff', 'every role', 'handoff', 'four-line handoff'],
];
// These publish to an issue tracker. board-gh is the only board writer, so
// they may only run on the local-markdown tracker (.scratch/, gitignored).
const TRACKER_PUBLISHING = ['to-spec', 'to-tickets', 'wayfinder'];
const stageOf = key => STAGES.find(s => s[0] === key);

function installed(name, home) {
  // Lookup order: user skills → agents skills → every installed plugin's skills/.
  const places = [[path.join(home, '.claude', 'skills', name, 'SKILL.md'), null],
    [path.join(home, '.agents', 'skills', name, 'SKILL.md'), null]];
  const ip = path.join(home, '.claude', 'plugins', 'installed_plugins.json');
  if (fs.existsSync(ip)) {
    let j = {};
    try { j = JSON.parse(fs.readFileSync(ip, 'utf8')); } catch { /* unreadable → no plugin skills */ }
    for (const entries of Object.values(j.plugins || {})) {
      for (const e of entries || []) if (e && e.installPath) places.push([path.join(e.installPath, 'skills', name, 'SKILL.md'), e.version || null]);
    }
  }
  for (const [p, pluginVersion] of places) {
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    // A plugin has a version; a copied skill has only its content — pin the bytes.
    const version = pluginVersion || crypto.createHash('sha256').update(text).digest('hex').slice(0, 12);
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    const invoke = fm && /^disable-model-invocation:\s*true\s*$/m.test(fm[1]) ? 'read' : 'skill';
    return { path: p, version, invoke };
  }
  return null;
}

function resolve(tools, home) {
  return STAGES.map(([stage, role, chosen, native]) => {
    const raw = tools && typeof tools[stage] === 'string' ? tools[stage] : null;
    if (!raw) return { stage, role, native, status: 'native', use: 'native' };
    const at = raw.lastIndexOf('@');
    const skill = at > 0 ? raw.slice(0, at) : raw;
    const want = at > 0 ? raw.slice(at + 1) : null;
    const inst = installed(skill, home);
    if (!inst) return { stage, role, native, skill, pin: want, status: 'missing', use: 'native' };
    if (want && want !== inst.version) return { stage, role, native, skill, pin: want, installed: inst.version, status: 'mismatch', use: 'native' };
    return { stage, role, native, skill, pin: inst.version, status: 'ok', use: skill, invoke: inst.invoke, path: inst.path };
  });
}

function localTracker(cwd) {
  const p = path.join(cwd, 'docs', 'agents', 'issue-tracker.md');
  return fs.existsSync(p) && /^# Issue tracker: Local Markdown\s*$/m.test(fs.readFileSync(p, 'utf8'));
}

function pin(args, home, cwd) {
  const tools = {}; const errors = [];
  for (const a of args) {
    const m = /^([a-z-]+)=(.*)$/.exec(a);
    if (!m) { errors.push(`bad argument "${a}" — use <stage>=<skill> or <stage>=native`); continue; }
    const [, stage, name] = m;
    if (!stageOf(stage)) { errors.push(`unknown stage "${stage}" — keys: ${STAGES.map(s => s[0]).join(' ')}`); continue; }
    if (name === 'native' || name === '') { tools[stage] = null; continue; }
    const inst = installed(name, home);
    if (!inst) { errors.push(`${stage}: "${name}" is not installed (looked in ~/.claude/skills, ~/.agents/skills, installed plugins)`); continue; }
    tools[stage] = `${name}@${inst.version}`;
  }
  const publishing = Object.values(tools).filter(Boolean).map(v => v.slice(0, v.lastIndexOf('@'))).filter(x => TRACKER_PUBLISHING.includes(x));
  if (publishing.length && !localTracker(cwd)) {
    errors.push(`${publishing.join(', ')}: publish to a tracker — docs/agents/issue-tracker.md must say "# Issue tracker: Local Markdown" (run /setup-matt-pocock-skills and choose local markdown under .scratch/); board-gh stays the only board writer`);
  }
  return { tools, errors };
}

function line(r) {
  if (r.status === 'native') return `${r.stage}: native (${r.native})`;
  if (r.status === 'ok') return `${r.stage}: ${r.skill}@${r.pin} ok · invoke: ${r.invoke} · ${r.path}`;
  if (r.status === 'missing') return `${r.stage}: ${r.skill}@${r.pin} missing → native (${r.native})`;
  return `${r.stage}: ${r.skill}@${r.pin} mismatch (installed ${r.installed}) → native (${r.native}) — re-pin via /shepr:setup`;
}

function parseArgs(argv) {
  const opt = { pos: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--home' || a === '--cwd') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${a} requires a value`);
      opt[a.slice(2)] = argv[++i];
    } else if (a === '--json' || a === '--write') opt[a.slice(2)] = true;
    else opt.pos.push(a);
  }
  return opt;
}

function main(argv, deps = {}) {
  const say = deps.stdout || (s => process.stdout.write(s));
  let opt;
  try { opt = parseArgs(argv); } catch (e) { say(`tools: ${e.message}\n`); return 1; }
  const home = opt.home || deps.home || os.homedir();
  const cwd = opt.cwd || deps.cwd || process.cwd();
  const orchPath = path.join(cwd, '.claude', 'orch.json');
  const [verb, ...rest] = opt.pos;
  if (verb === 'list') {
    for (const [stage, role, chosen, native] of STAGES) {
      const inst = chosen ? installed(chosen, home) : null;
      say(`${stage} · ${role} · native: ${native} · chosen: ${chosen ? `${chosen} (${inst ? `installed ${inst.version}` : 'not installed'})` : '—'}\n`);
    }
    return 0;
  }
  if (verb === 'check') {
    let tools = {};
    try { if (fs.existsSync(orchPath)) tools = (JSON.parse(fs.readFileSync(orchPath, 'utf8')).workflow || {}).tools || {}; }
    catch (e) { say(`tools: .claude/orch.json is not valid JSON (${e.message})\n`); return 1; }
    const stages = resolve(tools, home);
    const unknown = Object.keys(tools).filter(k => !stageOf(k));
    if (opt.json) { say(JSON.stringify({ stages, unknown }) + '\n'); return 0; }
    for (const r of stages) say(line(r) + '\n');
    for (const k of unknown) say(`${k}: unknown stage — not in the §9 table; remove it from workflow.tools\n`);
    return 0;
  }
  if (verb === 'pin') {
    const { tools, errors } = pin(rest, home, cwd);
    for (const e of errors) say(`tools: ${e}\n`);
    if (errors.length) return 1;
    if (opt.write) {
      const j = fs.existsSync(orchPath) ? JSON.parse(fs.readFileSync(orchPath, 'utf8')) : {};
      j.workflow = j.workflow || {};
      j.workflow.tools = { ...(j.workflow.tools || {}), ...tools };
      fs.mkdirSync(path.dirname(orchPath), { recursive: true });
      fs.writeFileSync(orchPath, JSON.stringify(j, null, 2) + '\n');
      say(`wrote ${Object.keys(tools).length} stage(s) to .claude/orch.json → workflow.tools\n`);
      return 0;
    }
    say(JSON.stringify(tools, null, 2) + '\n');
    return 0;
  }
  say('usage: tools <list|check [--json]|pin <stage>=<skill|native> … [--write]> [--home <dir>] [--cwd <dir>]\n');
  return 1;
}

module.exports = { main, STAGES, TRACKER_PUBLISHING, installed, resolve, localTracker, pin };
if (require.main === module) process.exit(main(process.argv.slice(2)));
