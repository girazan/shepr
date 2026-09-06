// merge-check — the `ship: merge` decision, pure. The hook feeds it what
// GitHub and git say; nothing here talks to the network, so the whole
// matrix is unit-testable. Spec: owner-confirmed design 2026-09-06
// (review by recipe; gates + reviewer = approval for ship: merge domains).
'use strict';
const { globToRe } = require('./contract');
const { isEvidence } = require('./evidence-lint');

const norm = p => String(p).replace(/\\/g, '/');
const LEGS = [[/^\s*suite\s*:/im, 'Suite:'], [/^\s*metric\s*:/im, 'Metric:'], [/^\s*baseline\s*:/im, 'Baseline:'],
  [/\b(closes|fixes|resolves)\s+#\d+/i, 'Closes #<item>']];

// Review a recipe needs before its PR may land on the default branch.
//   iterate/fast/cleanup/research  → none (suite + metric + baseline ARE the review)
//   tdd/debug                      → the goal's plan manifest passed
//   spec / unknown / no recipe     → plan manifest AND the step's manifest passed
function needsFor(recipe) {
  if (['iterate', 'fast', 'cleanup', 'research'].includes(recipe)) return { plan: false, step: false };
  if (['tdd', 'debug'].includes(recipe)) return { plan: true, step: false };
  return { plan: true, step: true };
}

// o = { base, defaultBranch, files, body, contract, item: {issue, step, recipe, goal} | null,
//       manifests: [{file, goal, step, item, verdict}] at the PR head }
function mergeCheck(o) {
  const miss = m => ({ ok: false, miss: m });
  if (!o.base || !o.defaultBranch) return miss('base branch unknown');
  if (o.base !== o.defaultBranch) return miss(`base ${o.base} is not the default branch ${o.defaultBranch}`);
  const domains = (o.contract && o.contract.domains) || {};
  const mergeDomains = Object.entries(domains).filter(([, d]) => d.ship === 'merge');
  if (!mergeDomains.length) return miss('no domain grants ship: merge');
  const files = (o.files || []).map(norm);
  if (!files.length) return miss('PR has no files');
  for (const f of files) {
    if (isEvidence(f)) continue;
    const owner = Object.entries(domains).filter(([, d]) => (d.paths || []).some(g => globToRe(g).test(f)));
    if (!owner.length) return miss(`${f}: no domain matches — omission never grants`);
    const weakest = owner.find(([, d]) => d.ship !== 'merge');
    if (weakest) return miss(`${f}: domain "${weakest[0]}" grants ship: ${weakest[1].ship}, not merge`);
  }
  const body = o.body || '';
  const missing = LEGS.filter(([re]) => !re.test(body)).map(([, l]) => l);
  if (missing.length) return miss(`PR body missing ${missing.join(' | ')}`);
  const itemNo = Number((/\b(?:closes|fixes|resolves)\s+#(\d+)/i.exec(body) || [])[1]);
  if (!o.item || o.item.issue !== itemNo) return miss(`#${itemNo} is not a board item`);
  if (!o.item.goal) return miss(`#${itemNo}: goal unknown`);
  const need = needsFor(o.item.recipe);
  const mans = (o.manifests || []).filter(m => m.goal === `G${o.item.goal}` && m.verdict === 'pass');
  if (need.plan && !mans.some(m => m.step === 'P')) return miss(`recipe ${o.item.recipe || '(none)'}: no passing plan manifest for G${o.item.goal} at the PR head`);
  if (need.step) {
    if (!o.item.step) return miss(`#${itemNo} has no step:`);
    if (!mans.some(m => m.step === o.item.step && m.item === `#${itemNo}`)) return miss(`recipe ${o.item.recipe || '(none)'}: no passing manifest for G${o.item.goal} ${o.item.step} #${itemNo} at the PR head`);
  }
  return { ok: true, domains: mergeDomains.map(([n]) => n), recipe: o.item.recipe || null, need };
}

module.exports = { mergeCheck, needsFor, LEGS };
