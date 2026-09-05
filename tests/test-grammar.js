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
const readme = R('README.md');
const delegate = R('skills/go/delegate.md');

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

// 9. Five commands, stated once in README.
check('README lists five commands', readme.includes('/orch:milestone') && /Five commands/.test(readme) && readme.includes('one of these five'));

// 10. Recipes — one page each in skills/go/recipes/; stages and rubric adds verbatim from spec §8.
const { RECIPES } = require('../scripts/board-gh');
const RECIPE_DIR = path.join(__dirname, '..', 'skills', 'go', 'recipes');
const STAGE_LINES = {
  spec: 'Stages: brainstorm/grill → spec → `P.R1` → steps',
  research: 'Stages: search → grade sources → findings note',
  tdd: 'Stages: red at the seam → green → refactor',
  debug: 'Stages: reproduce → hypothesis → bisect → fix → regression test',
  iterate: 'Stages: hypothesis first → change → measure → keep/revert',
  cleanup: 'Stages: separate pass, separate agent',
  fast: 'Stages: implement → test',
};
const RUBRIC_ADDS = {
  spec: '- plan covers `done:`; each `accept:` checkable',
  research: '- sources cited and graded; no code',
  tdd: '- green-can-go-red',
  debug: '- a test that was red before the fix; root cause named',
  iterate: '- delta outside the noise band; `⚠complexity` weighed',
  cleanup: '- tests unchanged and green; the diff deletes',
  fast: '- mechanical step only',
};
check('recipe pages = RECIPES + review-goal, nothing else', fs.readdirSync(RECIPE_DIR).sort().join() === [...RECIPES, 'review-goal'].map(x => `${x}.md`).sort().join());
for (const name of RECIPES) {
  const t = R(`skills/go/recipes/${name}.md`);
  check(`recipe ${name} is one page (≤45 lines)`, t.split('\n').length <= 45);
  check(`recipe ${name} states its stages verbatim`, t.includes(STAGE_LINES[name]));
  check(`recipe ${name} carries the §8 gate rubric adds`, /^## Gate rubric adds$/m.test(t) && t.includes(RUBRIC_ADDS[name]));
  check(`recipe ${name} names its skill stage ledger line`, t.includes('skill: ' + (name === 'spec' ? 'grill' : name) + '='));
}
check('shaping recipes say they never go on a step', R('skills/go/recipes/spec.md').includes('never on a step') && R('skills/go/recipes/research.md').includes('never on a step'));
const rg = R('skills/go/recipes/review-goal.md');
check('review-goal is one page with the tri-state verdict grammar', rg.split('\n').length <= 45 && rg.includes('verdict: pass | fail | inconclusive'));
check('review-goal is read-only, runs tests, fixes nothing', rg.includes('git show <sha>:<path>') && rg.includes('EXISTS → SUBSTANTIVE → WIRED') && rg.includes('You fix nothing you find.'));

// 11. Skill routing — the §9 table lives in scripts/tools.js (STAGES) and skills/setup/tools.md; setup pins, goal/milestone route by stage.
const { STAGES, TRACKER_PUBLISHING } = require('../scripts/tools');
const toolsDoc = R('skills/setup/tools.md');
for (const [stage, , chosen, native] of STAGES) check(`tools.md carries stage ${stage}, its native fallback${chosen ? ' and chosen skill' : ''}`, toolsDoc.includes(`\`${stage}\``) && toolsDoc.includes(native) && (!chosen || toolsDoc.includes(`\`${chosen}\``)));
check('tools.md states the resolution rule once', toolsDoc.includes('`tools[stage]` if set and installed at the pinned version → the skill; else the native fallback, and the ledger says which.'));
check('tools.md names the tracker-publishing skills and the local tracker', TRACKER_PUBLISHING.every(x => toolsDoc.includes(`\`${x}\``)) && toolsDoc.includes('# Issue tracker: Local Markdown'));
check('tools.md says no hook reads the map', toolsDoc.includes('no hook reads this map'));
check('setup loads tools.md and pins with tools.js pin --write', setup.includes('tools.md') && setup.includes('tools.js" list') && setup.includes('tools.js" pin') && setup.includes('--write'));
check('setup offers find-skills only when installed, native first', setup.includes('find-skills') && setup.includes('native first'));
check('setup requires the local-markdown tracker for tracker-publishing skills', setup.includes('# Issue tracker: Local Markdown') && setup.includes('/setup-matt-pocock-skills'));
check('goal routes shaping by recipe and stage', goal.includes('recipes/spec.md') && goal.includes('recipes/research.md') && goal.includes('tools.js" check'));
check('goal says shaping recipes never go on a step', goal.includes('Shaping recipes never go on a step.'));
check('milestone define routes through the define-milestone stage', milestone.includes('`define-milestone`') && milestone.includes('tools.js" check'));
check('orch never routes to superpowers', ![goal, setup, milestone, go, work].some(t => /superpowers:/.test(t)));

// 12. Work phase — recipe and skill per step; ledger line canonical in work.md; board lists broken pins.
const SKILL_LINE = 'skill: <stage>=<name>';
check('work states the skill ledger line', work.includes(SKILL_LINE));
check('no other skill restates the skill ledger line', ![go, goal, board, loop, setup, milestone, delegate].some(t => t.includes(SKILL_LINE)));
check('work loads the step recipe page and runs the tools check before dispatch', work.includes('recipes/<recipe>.md') && work.includes('tools.js" check') && work.includes('items[].recipe'));
check('work says how to invoke: skill vs read', work.includes('invoke: read') && work.includes('invoke: skill'));
check('work falls back per stage and says so', work.includes('missing') && work.includes('mismatch') && work.includes('native fallback'));
check('delegate brief MUST DO opens with the recipe stages', delegate.includes("MUST DO:   <the step's recipe stages first, in order (recipes/<recipe>.md), then the constraints that are non-negotiable>"));
check('go route names the execution recipes once', go.includes('the step\'s `recipe:`') && go.includes('recipes/'));
check('board gathers the tools check and renders the TOOLS line', board.includes('tools.js" check') && board.includes('TOOLS: <stage> <name>@<pin> missing|mismatch → native'));

// 13. README states recipes and stage routing once.
check('README glossary has recipe and stage; setup row mentions workflow.tools', readme.includes('**recipe**') && readme.includes('**stage**') && readme.includes('workflow.tools'));

// 14. Handoff and marker grammars — canonical in delegate.md; go only invokes the CLI.
for (const h of ['tmp/handoffs/M<n>.G<k>.S<j>-dev.md', 'tmp/handoffs/M<n>.G<k>-architect.md', 'tmp/handoffs/M<n>-coordinator.md']) {
  check(`delegate states the handoff path ${h}`, delegate.includes(h));
  check(`no other skill restates ${h}`, ![go, goal, board, work, loop].some(t => t.includes(h)));
}
check('delegate states the env pair a launcher sets', delegate.includes('ORCH_ROLE=dev|architect|coordinator|reviewer') && delegate.includes('ORCH_IDS=M<n>.G<k>.S<j>'));
check('delegate states the roster entry with orchRole and ids', delegate.includes('"orchRole": "dev"') && delegate.includes('"ids": "M53.G142.S2"') && delegate.includes('"vehicle": "herdr"'));
check('delegate names the marker path', delegate.includes('<git-common-dir>/orch/session-<sessionId>.json'));
check('go records the focus pick in the marker', go.includes('session-marker.js" set --goal G<n>'));
check('README counts eleven hooks and states the unlocked-contract degradation', /Eleven hooks/.test(readme) && readme.includes('advisory in fact') && readme.includes('contract: locked|unlocked'));

console.log(`\n${pass}/${n} pass`);
process.exit(fail ? 1 : 0);
