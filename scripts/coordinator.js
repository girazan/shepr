#!/usr/bin/env node
// coordinator — the Coordinator's tick as code (spec §7 step 2, §4 pick
// rule, d.21–25, d.29, d.33). Pure functions + a thin main(). The script
// READS (board, contract, git ls-files/log, roster, audit, worklogs,
// manifests) and WRITES only audit lines, the session marker + roster entry
// at launch, and tmp/handoffs/M<n>-coordinator.md. Every git/gh/board-gh
// mutation is typed by the Coordinator so the ship gate sees it (v2 caveat).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { globToRe, RANKS } = require('../hooks/lib/contract');
const { appendAudit, AUDIT_REL, loadConfig, resolveRepoKey } = require('../hooks/lib/config');
const { withLock } = require('./lib/lockfile');

// Evidence paths are never domain files (spec §5) — removed before any match.
const EVIDENCE = ['docs/reviews/**', 'tmp/worklogs/**', 'docs/adr/**'];

const briefLine = (brief, key) => { const m = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(brief || ''); return m ? m[1].trim() : null; };
const domainsOf = brief => (briefLine(brief, 'domains') || '').split(/[,\s]+/).filter(Boolean);

// Files a goal owns at HEAD: git ls-files ∩ locked paths of EVERY domain in
// domains: (spec §4 rule 5 — files, not globs; Opus S7).
function filesOfDomains(lsFiles, contract, domains) {
  const pats = [];
  for (const d of domains) for (const p of (((contract || {}).domains || {})[d] || {}).paths || []) pats.push(globToRe(p));
  const ev = EVIDENCE.map(globToRe);
  return lsFiles.map(f => f.replace(/\\/g, '/')).filter(f => pats.some(r => r.test(f)) && !ev.some(r => r.test(f)));
}

// Spec §4 goal pick, rules 0–5. `goals` arrive in board order (plan 1's
// Priority → milestone → issue sort) — rules 3–4 are that order, never re-sorted here.
function pick({ goals, named, filesOf }) {
  const skipped = [];
  const running = goals.filter(g => g.status === 'running').map(g => ({ lane: g.lane, files: new Set(filesOf(g)) }));
  const overlap = g => {
    const mine = filesOf(g);
    for (const r of running) { if (r.lane === g.lane) continue; const hit = mine.find(f => r.files.has(f)); if (hit) return `rule 5: shares ${hit} with ${r.lane}`; }
    return null;
  };
  const eligible = g => {
    if (g.status === 'merged') return false;
    if (g.status === 'blocked' || g.status === 'needs_attention') { skipped.push({ lane: g.lane, reason: `rule 0: ${g.status}` }); return false; }
    const o = overlap(g);
    if (o) { skipped.push({ lane: g.lane, reason: o }); return false; }
    return true;
  };
  if (named) {
    const g = goals.find(x => x.lane === String(named).toUpperCase());
    if (!g) return { pick: null, skipped: [{ lane: String(named).toUpperCase(), reason: 'rule 1: not on the board' }] };
    return { pick: eligible(g) ? g : null, skipped };
  }
  // Compute eligibility for every goal once (not lazily inside .find's
  // condition) so rule 0/5 skips are recorded for every goal, not only the
  // ones a short-circuited && happens to reach.
  const elig = new Map(goals.map(g => [g.lane, eligible(g)]));
  const hasOpenItem = g => (g.items || []).some(i => !i.done && !i.you);
  const inflight = goals.find(g => (g.status === 'running' || g.status === 'review') && hasOpenItem(g) && elig.get(g.lane));
  if (inflight) return { pick: inflight, skipped };
  return { pick: goals.find(g => g.status === 'ready' && elig.get(g.lane)) || null, skipped };
}

module.exports = { EVIDENCE, briefLine, domainsOf, filesOfDomains, pick };
