// merge-check matrix — pure, no git, no gh.
'use strict';
const { mergeCheck, needsFor } = require('../hooks/lib/merge-check');

let pass = 0, fail = 0, n = 0;
function check(name, cond) { n++; if (cond) { pass++; console.log(`  ok ${n}. ${name}`); } else { fail++; console.log(`FAIL ${n}. ${name}`); } }

const contract = { domains: {
  numerics: { paths: ['src/Solver/**'], decide: 'ai', ship: 'merge' },
  tests: { paths: ['tests/**'], decide: 'ai', ship: 'merge' },
  'plant-data': { paths: ['plants/**'], decide: 'human', ship: 'none' },
  docs: { paths: ['docs/**'], decide: 'ai', ship: 'push' },
} };
const body = 'Suite: Passed! 10\nMetric: 36 s -> 41 s\nBaseline: abc1234\nCloses #77\n';
const item = (recipe, step = 'S2') => ({ issue: 77, step, recipe, goal: 142 });
const P = { goal: 'G142', step: 'P', item: '-', verdict: 'pass' };
const S2 = { goal: 'G142', step: 'S2', item: '#77', verdict: 'pass' };
const base = { base: 'main', defaultBranch: 'main', contract, files: ['src/Solver/a.cs', 'tests/a.cs', 'tmp/worklogs/G142-x.md'], body };

check('needsFor iterate = none', JSON.stringify(needsFor('iterate')) === '{"plan":false,"step":false}');
check('needsFor tdd = plan only', JSON.stringify(needsFor('tdd')) === '{"plan":true,"step":false}');
check('needsFor unknown = plan + step', JSON.stringify(needsFor(undefined)) === '{"plan":true,"step":true}');

check('iterate: no manifests needed -> ok', mergeCheck({ ...base, item: item('iterate'), manifests: [] }).ok === true);
check('fast: ok', mergeCheck({ ...base, item: item('fast'), manifests: [] }).ok === true);
check('tdd without plan manifest -> miss', /plan manifest/.test(mergeCheck({ ...base, item: item('tdd'), manifests: [] }).miss));
check('tdd with plan manifest -> ok', mergeCheck({ ...base, item: item('tdd'), manifests: [P] }).ok === true);
check('spec without step manifest -> miss', /no passing manifest .*S2/.test(mergeCheck({ ...base, item: item('spec'), manifests: [P] }).miss));
check('spec with plan + step -> ok', mergeCheck({ ...base, item: item('spec'), manifests: [P, S2] }).ok === true);
check('no recipe = spec rules', mergeCheck({ ...base, item: item(null), manifests: [P, S2] }).ok === true && !mergeCheck({ ...base, item: item(null), manifests: [P] }).ok);
check('failed step manifest does not count', !mergeCheck({ ...base, item: item('spec'), manifests: [P, { ...S2, verdict: 'fail' }] }).ok);
check('step manifest for another item does not count', !mergeCheck({ ...base, item: item('spec'), manifests: [P, { ...S2, item: '#78' }] }).ok);

check('base not default -> miss', /not the default/.test(mergeCheck({ ...base, base: 'autopilot/x', item: item('fast'), manifests: [] }).miss));
check('file in ship:none domain -> miss', /plant-data.*none/.test(mergeCheck({ ...base, files: ['src/Solver/a.cs', 'plants/p.yaml'], item: item('fast'), manifests: [] }).miss));
check('file in ship:push domain -> miss', /docs.*push/.test(mergeCheck({ ...base, files: ['docs/x.md'], item: item('fast'), manifests: [] }).miss));
check('unmatched file -> miss', /no domain matches/.test(mergeCheck({ ...base, files: ['README.md'], item: item('fast'), manifests: [] }).miss));
check('evidence paths never block', mergeCheck({ ...base, files: ['docs/reviews/M1.G142.S2.R1.md', 'src/Solver/a.cs'], item: item('fast'), manifests: [] }).ok === true);
check('body missing legs -> miss', /Metric:/.test(mergeCheck({ ...base, body: 'Suite: ok\nBaseline: x\nCloses #77', item: item('fast'), manifests: [] }).miss));
check('Closes points at a non-item -> miss', /not a board item/.test(mergeCheck({ ...base, item: null, manifests: [] }).miss));
check('no merge domain anywhere -> miss', /no domain grants/.test(mergeCheck({ ...base, contract: { domains: { d: { paths: ['**'], decide: 'ai', ship: 'push' } } }, item: item('fast'), manifests: [] }).miss));
check('empty PR -> miss', /no files/.test(mergeCheck({ ...base, files: [], item: item('fast'), manifests: [] }).miss));

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
