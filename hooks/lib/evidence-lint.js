// Evidence lint — spec §5, one algorithm: FROZEN / CHAIN / TARGET / legs
// (a)–(f) / CLOSE TAIL. Git and the locked contract only; no network, no
// GitHub, nothing read from the working tree. Both `shepr review` (the
// writer) and the ship gate (the verifier) compute base/paths/slots/tier
// through these functions, so the two agree by construction.
'use strict';
const crypto = require('crypto');
const { RANKS, rankIndex, floorsFor, globToRe } = require('./contract');

const EVIDENCE = ['docs/reviews/**', 'tmp/worklogs/**', 'docs/adr/**'];
const norm = p => String(p).replace(/\\/g, '/');
const isEvidence = p => EVIDENCE.some(g => globToRe(g).test(norm(p)));
const sha256 = s => crypto.createHash('sha256').update(String(s).replace(/\r\n/g, '\n')).digest('hex');

function goalPaths(contract, domains) {
  const out = new Set();
  for (const d of domains) for (const p of ((contract.domains[d] || {}).paths || [])) if (!EVIDENCE.includes(p)) out.add(p);
  return [...out].sort();
}
const matchesGoal = (paths, f) => !isEvidence(f) && paths.some(g => globToRe(g).test(norm(f)));
const slotsFor = (contract, domains) => (domains.some(d => contract.domains[d] && contract.domains[d].review === 'dual') ? 2 : 1);
function reviewTier(contract, domains) {
  const fl = floorsFor(contract, domains);
  return RANKS[Math.max(rankIndex('high'), fl ? fl.review : -1)];
}
const aggregate = vs => (vs.some(v => v === 'fail') ? 'fail' : vs.length && vs.every(v => v === 'pass') ? 'pass' : 'inconclusive');

const field = (text, name) => { const m = new RegExp(`^${name}:[ \\t]*(.*?)[ \\t]*$`, 'm').exec(text); return m ? m[1] : null; };
function parseManifest(text) {
  const range = /^range:\s*([0-9a-f]{40})\.\.([0-9a-f]{40})\s*$/m.exec(text);
  const ids = /^goal:\s*(G\d+) · step:\s*(S\d+|P) · item:\s*(#\d+|-)\s*$/m.exec(text);
  const slotLines = [];
  for (const m of text.matchAll(/^slot-(\d):\s*(\S+) · (\S+) · (\S+) · (pass|fail|inconclusive|missing)\s*$/gm)) {
    slotLines.push({ n: Number(m[1]), file: m[2], model: m[3], tier: m[4], verdict: m[5] });
  }
  // fallback: slot-<k> <locked model> → <fallback model> (<reason>)  — v0.9.0, one line per substituted slot
  const fallback = {};
  for (const m of text.matchAll(/^fallback:\s*slot-(\d)\s+(\S+)\s*→\s*(\S+)\s*\((.*?)\)\s*$/gm)) fallback[Number(m[1])] = { from: m[2], to: m[3], reason: m[4] };
  return { review: field(text, 'review'), goal: ids ? ids[1] : null, step: ids ? ids[2] : null, item: ids ? ids[3] : null,
    rubric: field(text, 'rubric'), base: range ? range[1] : null, head: range ? range[2] : null, paths: field(text, 'paths'),
    slots: field(text, 'slots'), slotLines, fallback, verdict: (field(text, 'verdict') || '').split(/\s/)[0] };
}
function isAncestor(git, a, b) { try { git(['merge-base', '--is-ancestor', a, b]); return true; } catch { return false; } }
const names = out => out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

// FROZEN(G): the worklog as of the commit that introduced its ROUTE line.
function frozen(git, n, contract) {
  let out = '';
  try { out = git(['log', '--reverse', '--format=%H', '--name-only', '-S', `ROUTE: lane:G${n} `, '--', 'tmp/worklogs/']); } catch { out = ''; }
  const lines = out.split(/\r?\n/);
  const i = lines.findIndex(l => /^[0-9a-f]{40}$/.test(l.trim()));
  if (i < 0) return { miss: `frozen BRIEF: no commit introduces ROUTE: lane:G${n} under tmp/worklogs/` };
  const paths = [];
  for (let k = i + 1; k < lines.length && !/^[0-9a-f]{40}$/.test(lines[k].trim()); k++) if (lines[k].trim()) paths.push(lines[k].trim());
  if (paths.length !== 1) return { miss: 'frozen BRIEF ambiguous' };
  const commit = lines[i].trim(), path = paths[0];
  let text; try { text = git(['show', `${commit}:${path}`]); } catch { return { miss: `frozen BRIEF: cannot read ${path} at ${commit.slice(0, 7)}` }; }
  const route = new RegExp(`^ROUTE: lane:G${n} .*?base:([0-9a-f]{7,40})`, 'm').exec(text);
  const dm = /^domains:\s*(.+?)\s*$/m.exec(text);
  if (!route || !dm) return { miss: 'frozen BRIEF: ROUTE base: or domains: line missing' };
  const domains = dm[1].split(/[,\s]+/).filter(Boolean);
  const unknown = domains.filter(d => !contract.domains[d]);
  if (unknown.length) return { miss: `frozen BRIEF: domain ${unknown[0]} is not in the locked contract` };
  let base; try { base = git(['rev-parse', '--verify', `${route[1]}^{commit}`]).trim(); } catch { return { miss: `frozen BRIEF: base ${route[1]} is not a commit` }; }
  const gp = goalPaths(contract, domains);
  if (!gp.length) return { miss: 'frozen BRIEF: goal paths empty (domains grant only evidence paths)' };
  return { commit, path, base, domains, paths: gp };
}

// Step manifests of the goal at HEAD (slot files excluded by the pattern; plan manifests by S<digits>).
function manifests(git, n) {
  let files = [];
  try { files = names(git(['ls-tree', '--name-only', 'HEAD', 'docs/reviews/'])); } catch { files = []; }
  const re = new RegExp(`^docs/reviews/M\\d+\\.G${n}\\.S(\\d+)\\.R(\\d+)\\.md$`);
  return files.filter(f => re.test(f)).map(f => { const m = re.exec(f); return { file: f, s: Number(m[1]), r: Number(m[2]), ...parseManifest(git(['show', `HEAD:${f}`])) }; });
}

// CHAIN(G): passing step manifests ordered by ancestry of head-sha.
function chain(git, all) {
  const passing = all.filter(m => m.verdict === 'pass' && m.base && m.head);
  for (let i = 0; i < passing.length; i++) {
    for (let k = i + 1; k < passing.length; k++) {
      const a = passing[i], b = passing[k];
      if (a.head !== b.head && !isAncestor(git, a.head, b.head) && !isAncestor(git, b.head, a.head)) return { miss: `branched history (${a.review} vs ${b.review})` };
    }
  }
  // Equal heads (a step that added no commit) tie-break by S then R — stated, not in the spec.
  passing.sort((a, b) => (a.head === b.head ? (a.s - b.s || a.r - b.r) : (isAncestor(git, a.head, b.head) ? -1 : 1)));
  return { chain: passing };
}
function chainHolds(ch, frozenBase) {
  if (!ch.length) return null;
  if (ch[0].base !== frozenBase) return `chain: ${ch[0].review} base ${ch[0].base.slice(0, 7)} ≠ ROUTE base ${frozenBase.slice(0, 7)}`;
  for (let i = 1; i < ch.length; i++) if (ch[i].base !== ch[i - 1].head) return `chain: ${ch[i].review} base ${ch[i].base.slice(0, 7)} ≠ ${ch[i - 1].review} head ${ch[i - 1].head.slice(0, 7)}`;
  return null;
}

// LEGS (a)–(f) on one manifest. Returns null or the miss text, leg first.
function legs(git, m, fz, contract, models) {
  for (const ent of (m.rubric || '').split(/\s*\+\s*/).filter(Boolean)) {
    const mm = /^(.+)\.md@([0-9a-f]{64})$/.exec(ent);
    if (!mm) return `(a) rubric entry "${ent}" is not <name>.md@<sha256>`;
    const p = `docs/reviews/rubrics/${mm[1]}.${mm[2]}.md`;
    let body; try { body = git(['show', `HEAD:${p}`]); } catch { return `(a) ${p} missing at HEAD`; }
    if (sha256(body) !== mm[2]) return `(a) ${p} content hash ≠ ${mm[2].slice(0, 12)}…`;
  }
  if (!m.base || !m.head) return '(b) range: line missing or not <sha>..<sha>';
  if (!isAncestor(git, m.head, 'HEAD')) return `(b) head ${m.head.slice(0, 7)} is not an ancestor of HEAD`;
  if (!isAncestor(git, m.base, m.head)) return `(b) base ${m.base.slice(0, 7)} is not an ancestor of head ${m.head.slice(0, 7)}`;
  const want = fz.paths.join(' ');
  if (m.paths !== want) return `(d) paths: "${m.paths}" ≠ goal paths "${want}"`;
  const slots = slotsFor(contract, fz.domains);
  if (Number(m.slots) !== slots) return `(d) slots: ${m.slots} ≠ ${slots} (contract review: ${slots === 2 ? 'dual' : 'single'})`;
  const fileVerdicts = [];
  for (let k = 1; k <= slots; k++) {
    const sl = m.slotLines.find(x => x.n === k);
    if (!sl) return `(d) slot-${k}: line missing`;
    if (sl.verdict === 'missing') { fileVerdicts.push('missing'); continue; }
    let text; try { text = git(['show', `HEAD:docs/reviews/${sl.file}`]); } catch { return `(d) slot-${k}: docs/reviews/${sl.file} missing at HEAD`; }
    const sf = parseManifest(text);
    if (sf.base !== m.base || sf.head !== m.head) return `(d) slot-${k}: range ≠ manifest range`;
    if ((sf.paths || '') !== (m.paths || '')) return `(d) slot-${k}: paths ≠ manifest paths`;
    if (sf.verdict !== sl.verdict) return `(d) slot-${k}: line says ${sl.verdict}, file says ${sf.verdict}`;
    fileVerdicts.push(sf.verdict);
  }
  const agg = aggregate(fileVerdicts);
  if (m.verdict !== agg) return `(d) verdict: ${m.verdict} ≠ aggregate ${agg}`;
  if (agg !== 'pass') return `(e) aggregate ${agg}`;
  const floor = reviewTier(contract, fz.domains);
  for (let k = 1; k <= slots; k++) {
    const sl = m.slotLines.find(x => x.n === k);
    const wantModel = k === 1 ? models.review : models['review-alt'];
    if (!wantModel) return `(f) models.${k === 1 ? 'review' : 'review-alt'} not locked`;
    // A declared fallback (the locked slot model failed to run) is accepted only
    // when it names the locked model it replaced and the locked fallback model.
    const fb = m.fallback && m.fallback[k];
    const okFallback = fb && fb.from === wantModel && models['review-fallback'] && sl.model === models['review-fallback'];
    if (sl.model !== wantModel && !okFallback) return `(f) slot-${k}: model ${sl.model} ≠ locked ${wantModel}${fb ? ' (fallback not locked as models.review-fallback)' : ''}`;
    if (rankIndex(sl.tier) < rankIndex(floor)) return `(f) slot-${k}: tier ${sl.tier} below ${floor}`;
  }
  return null;
}

function lint({ git, contract, models, verb }) {
  const miss = m => ({ ok: false, miss: m });
  const fz = frozen(git, verb.goal, contract);
  if (fz.miss) return miss(fz.miss);
  const all = manifests(git, verb.goal);
  const ch = chain(git, all);
  if (ch.miss) return miss(`(c) ${ch.miss}`);
  const cerr = chainHolds(ch.chain, fz.base);
  if (cerr) return miss(`(c) ${cerr}`);
  const last = ch.chain[ch.chain.length - 1];
  let targets;
  if (verb.kind === 'done') {
    const cands = all.filter(m => m.s === verb.step).sort((a, b) => b.r - a.r);
    if (!cands.length) return miss(`target: no manifest docs/reviews/*.G${verb.goal}.S${verb.step}.R*.md at HEAD`);
    const t = cands[0];
    if (t.goal !== `G${verb.goal}` || t.step !== `S${verb.step}` || t.item !== `#${verb.item}`) return miss(`target: ${t.file} names ${t.goal} ${t.step} ${t.item}; the verb says G${verb.goal} S${verb.step} #${verb.item}`);
    if (t.verdict !== 'pass') return miss(`(e) ${t.file} verdict: ${t.verdict || '(none)'}`);
    if (last !== t) return miss(`(c) ${t.file} is not the latest passing manifest of G${verb.goal} (${last ? last.file : 'none'})`);
    targets = [t];
  } else {
    if (!last) return miss(`(c) no passing step manifest for G${verb.goal} at HEAD`);
    let wl; try { wl = git(['show', `HEAD:${fz.path}`]); } catch { return miss(`close: ${fz.path} is not at HEAD`); }
    const gate = [...wl.matchAll(/^GATE:.*?subject:([0-9a-f]{7,40})/gm)].pop();
    if (!gate) return miss('close: no GATE block with subject: in the worklog at HEAD');
    if (!last.head.startsWith(gate[1])) return miss(`close: GATE subject ${gate[1].slice(0, 7)} ≠ last passing head ${last.head.slice(0, 7)} (${last.review})`);
    targets = ch.chain;
  }
  for (const t of targets) { const e = legs(git, t, fz, contract, models); if (e) return miss(`${e} [${t.file}]`); }
  if (verb.kind === 'close') {
    let changed = [];
    try { changed = names(git(['diff', `${last.head}..HEAD`, '--name-only'])).filter(f => matchesGoal(fz.paths, f)); } catch (e) { return miss(`close tail: ${String(e.message).split('\n')[0]}`); }
    if (changed.length) return miss(`close tail: ${changed[0]} changed after ${last.review} (${last.head.slice(0, 7)})`);
  }
  return { ok: true, target: targets[targets.length - 1].file, frozen: fz };
}

module.exports = { EVIDENCE, isEvidence, sha256, goalPaths, matchesGoal, slotsFor, reviewTier, aggregate, parseManifest, frozen, manifests, chain, chainHolds, legs, lint };
