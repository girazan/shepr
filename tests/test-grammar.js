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
const milestone = R('skills/milestone/SKILL.md'); const setup = R('skills/setup/SKILL.md');

let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}

// 1. ROUTE worklog line — canonical in go/SKILL.md, all six fields in order.
const ROUTE = 'ROUTE: lane:G<n> · <domain> · decide:<ai|human> · ship:<none|commit|push> · tier:<model-tier> · base:<sha> · review:<single|dual> · approved:<operator|auto> · <date>';
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

// 5. Milestone grammar — canonical in skills/milestone/SKILL.md only.
const MS_TITLE = 'M<n> · <objective>';
const MS_DESC = 'target: <YYYY-MM-DD> · done: <observable>';
check('milestone states the title grammar', milestone.includes(MS_TITLE));
check('milestone states the description grammar', milestone.includes(MS_DESC));
check('no other skill restates the milestone description grammar', ![go, goal, board, work, loop, setup].some(t => t.includes(MS_DESC)));
for (const verb of ['define', 'split', 'prioritize', 'close']) check(`milestone has verb "${verb}"`, milestone.includes(`## ${verb}`));
check('milestone skill refuses under ORCH_ROLE', milestone.includes('ORCH_ROLE'));
check('milestone never creates goals itself', milestone.includes('/orch:goal') && !milestone.includes('add-goal'));
check('milestone prioritize uses move on a goal', milestone.includes('move G<n> <Priority option>'));

// 6. BRIEF — six lines, canonical in goal; feature: is the primary domain, read by add-goal.
check('goal BRIEF carries the feature: line after domains:', /domains: <contract domains this will touch>\r?\n\s*feature: <primary domain/.test(goal));
check('goal add-item line carries --accept and --recipe', goal.includes('[--accept "<criterion>"] [--recipe <name>]'));
check('goal does not pass --feature to add-goal (the script reads the BRIEF)', !/add-goal[^\n]*--feature/.test(goal));

// 7. Goal-pick rule — one sentence, in go only.
const PICK = '`blocked`/`needs_attention` never → named goal → `running`/`review` first → Priority bucket across milestones → lower milestone → lower issue';
check('go states the goal-pick rule', go.includes(PICK));
check('go no longer picks by most recently touched worklog', !go.includes('most recently touched'));
check('goal always creates at least one step', goal.includes('Always create at least one step'));
check('goal no longer says the feature is omitted when unsure', !/--feature[^\n]*omitted when unsure/.test(goal));
check('board owns the sync verb', R('skills/board/SKILL.md').includes('sync-features'));
check('go never chooses dual review at route time', !/dual review/.test(go));
check('no lane prose in delegate/goal', !/the lane\b/.test(R('skills/go/delegate.md')) && !/the lane\b/.test(goal));
check('setup asks for review-alt', R('skills/setup/SKILL.md').includes('review-alt'));

// 8. setup syncs Feature options on domain change.
check('setup runs sync-features after a domain edit', setup.includes('sync-features'));

console.log(`\n${pass}/${n} pass`);
process.exit(fail ? 1 : 0);
