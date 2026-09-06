// owner-queue: park / decide / tick with a fake board and a fixed clock.
'use strict';
const fs = require('fs');
const path = require('path');
const { main } = require('../scripts/owner-queue');

const ROOT = path.join(__dirname, 'scratch-owner-queue');
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(ROOT, 'tmp', 'worklogs'), { recursive: true });
fs.mkdirSync(path.join(ROOT, '.claude'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tmp', 'worklogs', 'G142-x.md'), '# wl\n');

let pass = 0, fail = 0, n = 0;
function check(name, cond) { n++; if (cond) { pass++; console.log(`  ok ${n}. ${name}`); } else { fail++; console.log(`FAIL ${n}. ${name}`); } }

const board = { loadCfg: () => ({}), readBoard: () => ({ goals: [
  { lane: 'G142', issue: 142, feature: null, items: [{ issue: 77, feature: 'Steady-state solver' }, { issue: 78, feature: 'Process & equipment models' }, { issue: 79, feature: null }] },
] }) };
const cfg = { rulings: { autoResolveHours: 4, never: ['Plant Editor', 'Process & equipment models'] } };
const T0 = '2026-09-06T10:00:00.000Z';
let out = '';
const run = (argv, now) => { out = ''; return main(argv, { root: ROOT, cfg, board, now: now || T0, stdout: s => { out += s + '\n'; } }); };

check('park process feature -> deadline +4h', run(['park', '--item', '77', '--q', 'merge order?', '--opt', 'a=#2155 first', '--opt', 'b=#2148 first', '--rec', 'a', '--evidence', 'tmp/x.md']) === 0 && /R1 parked #77 feature=Steady-state solver auto-resolve at 2026-09-06T14:00:00.000Z → \(a\)/.test(out));
check('park physics feature -> never', run(['park', '--item', '78', '--q', 'vent density?', '--opt', 'a=live', '--opt', 'c=keep', '--rec', 'a']) === 0 && /R2 .*never auto-resolves/.test(out) && !/set the Feature/.test(out));
check('park no feature -> never + set-feature hint', run(['park', '--item', '79', '--q', 'q3', '--opt', 'a=x']) === 0 && /R3 .*never auto-resolves — set the Feature/.test(out));
check('rendered md lists 3 open', /## Open \(3\)/.test(fs.readFileSync(path.join(ROOT, 'tmp', 'OWNER-QUEUE.md'), 'utf8')));
check('tick before T-1h: silent', run(['tick'], '2026-09-06T12:30:00.000Z') === 0 && out.trim() === '');
check('tick at T-1h: WARN once', run(['tick'], '2026-09-06T13:05:00.000Z') === 0 && /^WARN R1 #77 auto-resolves/.test(out) && run(['tick'], '2026-09-06T13:30:00.000Z') === 0 && out.trim() === '');
check('tick at deadline: AUTO R1 only, R2/R3 untouched', run(['tick'], '2026-09-06T14:00:00.000Z') === 0 && /^AUTO Ruling: R1 #77 auto-resolved \(a\)/.test(out) && !/R2|R3/.test(out));
check('auto-resolve wrote the Ruling into the goal worklog', /^- Ruling: R1 #77 auto-resolved \(a\) after 4 h — merge order\? — evidence tmp\/x\.md/m.test(fs.readFileSync(path.join(ROOT, 'tmp', 'worklogs', 'G142-x.md'), 'utf8')));
check('audit line appended', /"decision":"R1"/.test(fs.readFileSync(path.join(ROOT, '.claude', 'orch-audit.jsonl'), 'utf8')));
check('decide R2 by owner', run(['decide', 'R2', 'c', '--by', 'telegram']) === 0 && /R2 decided \(c\) by telegram/.test(out));
check('decide twice is a no-op', run(['decide', 'R2', 'a']) === 0 && /already decided \(c\)/.test(out));
check('decide unknown option -> usage', run(['decide', 'R3', 'z']) === 64);
check('list shows only R3 open', run(['list']) === 0 && /^R3 #79 \(no feature\) never/.test(out) && !/R1|R2/.test(out));
check('store persisted', JSON.parse(fs.readFileSync(path.join(ROOT, '.orch', 'owner-queue.json'), 'utf8')).rulings.length === 3);

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
