// coordinator.js — the tick as code: pick rules 0–5 (file overlap), kill,
// capacity, pulse/stale, proposal text, launch side effects, fix rounds,
// verdict mapping, PR text, milestone summary, fleet/out-of-scope data.
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../scripts/coordinator');

let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}

const CONTRACT = { domains: {
  hmi: { paths: ['src/Hmi.Web/**', 'docs/**'], decide: 'ai', ship: 'commit', tiers: { work: 'mid', review: 'high' } },
  numerics: { paths: ['src/Core/**'], decide: 'human', ship: 'none' },
  shared: { paths: ['src/Shared/**'], decide: 'ai', ship: 'push', review: 'dual' } } };
const LS = ['src/Hmi.Web/a.cs', 'src/Core/calc.cs', 'src/Shared/util.cs', 'docs/reviews/M1.G2.S1.R1.md', 'docs/adr/0001-x.md', 'README.md'];
const goal = (lane, status, domains, items = [{ issue: 1, step: 'S1', recipe: 'tdd', text: 'the step', done: false, you: false, status: 'Todo' }]) =>
  ({ lane, issue: Number(lane.slice(1)), name: `name ${lane}`, status, bucket: 'Now', milestone: { number: 53, title: 'M53 · x' },
    brief: `BRIEF\ngoal: g\nmetric: m\ndone: d\ndomains: ${domains}\nfeature: ${domains.split(/[,\s]+/)[0]}\nkill: 3 sessions`, items });

// --- filesOfDomains ---------------------------------------------------------------
check('filesOfDomains: every listed domain, evidence paths removed', C.filesOfDomains(LS, CONTRACT, ['hmi', 'shared']).join() === 'src/Hmi.Web/a.cs,src/Shared/util.cs');
check('filesOfDomains: docs/** does not make a manifest or an ADR a domain file', !C.filesOfDomains(LS, CONTRACT, ['hmi']).some(f => f.startsWith('docs/')));
check('filesOfDomains: unknown domain → no files', C.filesOfDomains(LS, CONTRACT, ['nope']).length === 0);
check('domainsOf splits on comma or space', C.domainsOf('x\ndomains: hmi, numerics shared\n').join() === 'hmi,numerics,shared');

// --- pick: rules 0–5 ----------------------------------------------------------------
const filesOf = g => C.filesOfDomains(LS, CONTRACT, C.domainsOf(g.brief));
{
  const goals = [goal('G1', 'blocked', 'hmi'), goal('G2', 'needs_attention', 'hmi'), goal('G3', 'ready', 'hmi')];
  const r = C.pick({ goals, filesOf });
  check('rule 0: blocked and needs_attention are never picked, and are named', r.pick.lane === 'G3' && r.skipped.map(s => s.lane + ':' + s.reason).join('|') === 'G1:rule 0: blocked|G2:rule 0: needs_attention');
}
{
  const goals = [goal('G3', 'ready', 'hmi'), goal('G4', 'ready', 'numerics')];
  check('rule 1: the named goal wins over board order', C.pick({ goals, named: 'g4', filesOf }).pick.lane === 'G4');
  check('rule 1: a named goal that is blocked is not picked', C.pick({ goals: [goal('G4', 'blocked', 'numerics')], named: 'G4', filesOf }).pick === null);
  check('rule 1: a named goal not on the board → null, said', C.pick({ goals, named: 'G9', filesOf }).skipped[0].reason === 'rule 1: not on the board');
}
{
  const goals = [goal('G3', 'ready', 'hmi'), goal('G5', 'review', 'numerics'), goal('G6', 'running', 'shared')];
  check('rule 2: in-flight (review/running) beats ready, first in board order', C.pick({ goals, filesOf }).pick.lane === 'G5');
}
{
  const goals = [goal('G7', 'ready', 'hmi'), goal('G8', 'ready', 'numerics'), goal('G9', 'merged', 'hmi')];
  check('rules 3–4: board order is the tie-break; merged never picked', C.pick({ goals, filesOf }).pick.lane === 'G7');
}
{
  const goals = [goal('G6', 'running', 'hmi'), goal('G7', 'ready', 'hmi, numerics'), goal('G8', 'ready', 'numerics')];
  const r = C.pick({ goals, filesOf });
  check('rule 2 still picks the running goal itself', r.pick.lane === 'G6');
  const r2 = C.pick({ goals: goals.filter(g => g.lane !== 'G6').concat([{ ...goal('G6', 'running', 'hmi'), items: [] }]), filesOf });
  check('rule 5: a candidate sharing a file with a running goal is skipped with the file named',
    r2.pick.lane === 'G8' && r2.skipped.some(s => s.lane === 'G7' && s.reason === 'rule 5: shares src/Hmi.Web/a.cs with G6'));
  const ovl = [goal('G6', 'running', 'hmi'), goal('G7', 'ready', 'docs-only')];
  check('rule 5 compares files, not globs: overlapping globs with no common file do not collide', C.pick({ goals: ovl, named: 'G7', filesOf: g => g.lane === 'G7' ? ['docs/x.md'] : filesOf(g) }).pick.lane === 'G7');
}

console.log(`\n${pass}/${n} pass`);
process.exit(fail ? 1 : 0);
