// Prompt-contract test — the record grammars are stated in prose in more
// than one file; this pins every restatement to one canonical string so
// they cannot drift apart silently.
'use strict';
const fs = require('fs');
const path = require('path');

const R = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const go = R('skills/go/SKILL.md');
const goal = R('skills/goal/SKILL.md');
const board = R('skills/board/SKILL.md');
const work = R('skills/go/work.md');
const loop = R('skills/go/loop.md');
const renderer = R('scripts/board-html.js');

let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}

// 1. ROUTE worklog line — canonical in go/SKILL.md, all six fields in order.
const ROUTE = 'ROUTE: lane:G<n> · <domain> · decide:<ai|human> · ship:<none|commit|push> · tier:<model-tier> · approved:<operator|auto> · <date>';
check('go states the full ROUTE line grammar', go.includes(ROUTE));
check('no other skill restates the ROUTE line', ![goal, board, work, loop].some(t => t.includes('ROUTE: lane:')));

// 2. Board item grammar — goal writes it via board-gh.js verbs, board reads
// the board-gh.js JSON, renderer parses that JSON (via board-html.js --json).
check('goal writes items via add-item G<n> "<step>"', goal.includes('add-item G<n> "<step>"'));
check('board reads the board-gh.js read --json output', board.includes('board-gh.js" read --json'));
// Owner-item parking line: `YOU | NOW | <item> |` retired for the --you
// flag, stated identically in goal (seeding) and go (parking).
check('goal and go both carry the --you owner-item invocation',
  goal.includes('--you') && go.includes('--you'));
// `milestone:` item marker retired for `--gate` on the done-condition item.
check('goal and board both carry the gate marker', goal.includes('gate') && board.includes('gate'));
// Goal status is never written — it is folded from the items into these six
// states; go/SKILL.md is the one place that states the full fold.
for (const status of ['merged', 'blocked', 'needs_attention', 'review', 'running', 'ready']) {
  check(`go states the folded status "${status}"`, go.includes(`\`${status}\``));
}
// Renderer must accept exactly that shape (incl. outcome + milestone).
check('renderer splits items on |', /split\(\s*['"]\|['"]\s*\)|\|/.test(renderer));
for (const marker of ['->', 'milestone:', '✓']) {
  check(`renderer handles "${marker}"`, renderer.includes(marker));
}

// 2b. Focus line — go opens every report with it when lanes are open.
check('go states the focus line grammar', go.includes('focus: G<n> · <name> (+<k> open)'));

// 3. Ledger iter line — canonical in work.md; board reads before → after.
check('work states the iter ledger grammar',
  work.includes('iter <n> · <short-sha> · <before> → <after> · keep|revert|flat|refuted · <what>'));
check('board reads the ledger before → after', board.includes('before → after'));

// 4. LAUNCH journal line — canonical in loop.md.
check('loop states the LAUNCH line grammar',
  loop.includes('LAUNCH <date> · <prompt file> · max-iter <n> · budget <tokens> · promise <string>'));

console.log(`\n${pass}/${n} pass`);
process.exit(fail ? 1 : 0);
