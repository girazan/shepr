#!/usr/bin/env node
// owner-queue.js — THE place for parked rulings, every session (owner-
// confirmed design 2026-09-06). Store: .orch/owner-queue.json; rendered
// view: tmp/OWNER-QUEUE.md. Policy by the board item's Feature (the Project
// is the source of truth): `rulings.never` features and items without a
// Feature never auto-resolve; everything else resolves to the parked
// recommendation after `rulings.autoResolveHours` (default 4), with a
// warning one hour before.
//
//   park   --item <#> --q "<question>" --opt a="<text>" --opt b="<text>" [--rec a] [--evidence <ptr>] [--goal G<n>]
//   decide R<n> <opt> [--by owner|auto|telegram]
//   list | render | tick [--now <iso>]
//
// tick prints one line per event (WARN R<n> ... | AUTO R<n> ... ) and, on an
// auto-resolve, appends `Ruling: R<n> ...` to the goal's worklog and an audit
// line. Exit 0 always except usage errors.
'use strict';
const fs = require('fs');
const path = require('path');

function args(argv) {
  const o = { _: [], opt: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--opt') { const m = /^([a-z])=(.*)$/s.exec(argv[++i] || ''); if (m) o.opt[m[1]] = m[2]; }
    else if (a.startsWith('--')) { o[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
    else o._.push(a);
  }
  return o;
}

function main(argv, deps = {}) {
  const root = deps.root || process.cwd();
  const say = deps.stdout || (s => process.stdout.write(s + '\n'));
  const now = deps.now ? new Date(deps.now) : new Date();
  const cfg = deps.cfg || require('../hooks/lib/config').loadConfig({ cwd: root });
  const rl = cfg.rulings || {};
  const hours = Number(rl.autoResolveHours) > 0 ? Number(rl.autoResolveHours) : 4;
  // v0.11: an explicit 0 / null / false means NEVER auto-resolve. A deadline is not a
  // decision: a timer answering a physics call is the failure mode this switch removes.
  const autoDisabled = rl.autoResolveHours === 0 || rl.autoResolveHours === null || rl.autoResolveHours === false;
  const never = new Set((rl.never || []).map(s => String(s).toLowerCase()));
  const storeP = path.join(root, '.orch', 'owner-queue.json');
  const mdP = path.join(root, 'tmp', 'OWNER-QUEUE.md');
  let store = { next: 1, rulings: [] };
  try { store = JSON.parse(fs.readFileSync(storeP, 'utf8')); } catch {}
  const save = () => { fs.mkdirSync(path.dirname(storeP), { recursive: true }); fs.writeFileSync(storeP, JSON.stringify(store, null, 2) + '\n'); render(); };
  const render = () => {
    const open = store.rulings.filter(r => !r.decided), done = store.rulings.filter(r => r.decided).slice(-20);
    const line = r => `- **${r.id}** #${r.item}${r.goal ? ` (${r.goal})` : ''} · feature: ${r.feature || '(none)'} · ${r.deadline ? `auto ${r.deadline} → ${r.rec}` : 'NEVER auto-resolves'}\n  ${r.q}\n` +
      Object.entries(r.opt).map(([k, v]) => `  (${k}) ${v}${k === r.rec ? '  ← recommended' : ''}`).join('\n') + (r.evidence ? `\n  evidence: ${r.evidence}` : '') +
      (r.decided ? `\n  DECIDED ${r.decided.at} by ${r.decided.by}: (${r.decided.opt})` : '');
    fs.mkdirSync(path.dirname(mdP), { recursive: true });
    fs.writeFileSync(mdP, `# OWNER QUEUE — rulings parked for the operator (rendered by owner-queue.js, edit via the script)\n\n## Open (${open.length})\n\n${open.map(line).join('\n\n') || '(none)'}\n\n## Decided (last ${done.length})\n\n${done.map(line).join('\n\n') || '(none)'}\n`);
  };
  const o = args(argv);
  const verb = o._[0];

  if (verb === 'park') {
    if (!o.item || !o.q || !Object.keys(o.opt).length) { say('usage: owner-queue park --item <#> --q "<question>" --opt a="..." [--opt b="..."] [--rec a] [--evidence <ptr>] [--goal G<n>]'); return 64; }
    const itemNo = Number(o.item);
    let feature = o.feature || null, goal = o.goal || null;
    if (!feature || !goal) {
      try {
        const bg = deps.board || require('./board-gh');
        const bcfg = bg.loadCfg(root);
        const board = bcfg ? bg.readBoard(deps.gh || require('./lib/gh').makeGh(), bcfg) : { goals: [] };
        for (const g of board.goals) { const it = g.items.find(i => i.issue === itemNo); if (it) { feature = feature || it.feature || g.feature || null; goal = goal || g.lane; break; } }
      } catch {}
    }
    const rec = o.rec && o.opt[o.rec] ? o.rec : Object.keys(o.opt)[0];
    const auto = !autoDisabled && !!feature && !never.has(String(feature).toLowerCase());
    const r = { id: `R${store.next++}`, item: itemNo, goal, feature, q: o.q, opt: o.opt, rec, evidence: o.evidence || null,
      parkedAt: now.toISOString(), deadline: auto ? new Date(now.getTime() + hours * 3600000).toISOString() : null, warned: false, decided: null };
    store.rulings.push(r); save();
    say(`${r.id} parked #${r.item} feature=${r.feature || '(none)'} ${r.deadline ? `auto-resolve at ${r.deadline} → (${r.rec})` : 'never auto-resolves' + (!feature ? ' — set the Feature on the board item' : '')}`);
    return 0;
  }
  if (verb === 'decide') {
    const r = store.rulings.find(x => x.id === o._[1]);
    if (!r || !o._[2] || !r.opt[o._[2]]) { say('usage: owner-queue decide R<n> <opt> [--by owner|auto|telegram]'); return 64; }
    if (r.decided) { say(`${r.id} already decided (${r.decided.opt}) by ${r.decided.by}`); return 0; }
    r.decided = { opt: o._[2], by: o.by || 'owner', at: now.toISOString() }; save();
    say(`${r.id} decided (${o._[2]}) by ${r.decided.by}`);
    // rulings.onDecision: a shell template that WAKES the coordinator (e.g.
    // `herdr agent prompt coordinator "RULING {id} DECIDED ({opt}) …"`) — a
    // decision nobody reads is a decision not made. Fire-and-forget, 15 s cap.
    const tpl = rl.onDecision;
    if (typeof tpl === 'string' && tpl.trim()) {
      const cmd = tpl.replace(/\{(id|opt|by|item|goal)\}/g, (_, k) => String(k === 'opt' ? r.decided.opt : k === 'by' ? r.decided.by : r[k] == null ? '' : r[k]));
      try { (deps.exec || require('child_process').execSync)(cmd, { stdio: 'ignore', timeout: 15000 }); say(`onDecision ran`); }
      catch (e) { say(`onDecision failed: ${String(e.message || e).split('\n')[0].slice(0, 100)}`); }
    }
    return 0;
  }
  if (verb === 'tick') {
    for (const r of store.rulings.filter(x => !x.decided && x.deadline)) {
      const dl = new Date(r.deadline).getTime();
      if (now.getTime() >= dl) {
        r.decided = { opt: r.rec, by: 'auto', at: now.toISOString() };
        const ruling = `Ruling: ${r.id} #${r.item} auto-resolved (${r.rec}) after ${hours} h — ${r.q} — evidence ${r.evidence || '-'} · reversible by the operator · ${now.toISOString()}`;
        say(`AUTO ${ruling}`);
        try {
          if (r.goal) {
            const wl = fs.readdirSync(path.join(root, 'tmp', 'worklogs')).find(f => f.startsWith(`${r.goal}-`));
            if (wl) fs.appendFileSync(path.join(root, 'tmp', 'worklogs', wl), `- ${ruling}\n`);
          }
          require('../hooks/lib/config').appendAudit(root, { ts: now.toISOString(), decision: r.id, scope: `#${r.item}`, domain: r.feature, verdict: r.rec, evidence: r.evidence || '-', by: 'ruling' });
        } catch {}
      } else if (!r.warned && now.getTime() >= dl - 3600000) {
        r.warned = true;
        say(`WARN ${r.id} #${r.item} auto-resolves at ${r.deadline} → (${r.rec}) unless decided: ${r.q}`);
      }
    }
    save(); return 0;
  }
  if (verb === 'digest') {
    // ONE message for the whole queue (firstmate's away-mode digest) instead of a ping
    // per ruling: the operator reads once and answers in a batch.
    const open = store.rulings.filter(x => !x.decided);
    if (!open.length) { say('no open rulings'); return 0; }
    const out = [`${open.length} ruling${open.length > 1 ? 's' : ''} waiting · press a button below, or reply "R<n> <letter>"`, ''];
    for (const r of open) {
      const age = Math.round((now.getTime() - new Date(r.parkedAt).getTime()) / 36e5);
      out.push(`${r.id} · #${r.item}${r.goal ? ` · ${r.goal}` : ''} · ${r.feature || 'no feature'} · parked ${age}h · ${r.deadline ? `auto ${r.deadline.slice(0, 16)} -> (${r.rec})` : 'never auto-resolves'}`);
      out.push(`  ${r.q}`);
      for (const [k, v] of Object.entries(r.opt)) out.push(`  (${k}) ${v}${k === r.rec ? '  <- recommended' : ''}`);
      if (r.evidence) out.push(`  evidence: ${r.evidence}`);
      out.push('');
    }
    say(out.join('\n').trimEnd()); return 0;
  }
  if (verb === 'list') { for (const r of store.rulings.filter(x => !x.decided)) say(`${r.id} #${r.item} ${r.feature || '(no feature)'} ${r.deadline ? `auto ${r.deadline} → (${r.rec})` : 'never'} — ${r.q}`); return 0; }
  if (verb === 'render') { render(); say(mdP); return 0; }
  say('usage: owner-queue <park|decide|list|digest|render|tick> ...'); return 64;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main };
