'use strict';
const { foldStatus } = require('../scripts/lib/fold');
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
const open = { state: 'open', labels: ['orch:goal'] }, closed = { state: 'closed', labels: ['orch:goal'] };
const attn = { state: 'open', labels: ['orch:goal', 'orch:needs_attention'] };
const it = (status, labels = [], blockerComment = null) => ({ status, labels, blockerComment });

check('closed goal → merged even with blocked items', foldStatus(closed, [it('Todo', ['orch:blocked'], 'x')]).status === 'merged');
check('orch:blocked wins over In progress', foldStatus(open, [it('In progress'), it('Todo', ['orch:blocked'], 'blocked: needs setup · owner: you')]).status === 'blocked');
check('blocker text comes from the blocked item', foldStatus(open, [it('Todo', ['orch:blocked'], 'blocked: needs setup · owner: you')]).blocker === 'blocked: needs setup · owner: you');
check('needs_attention on the goal beats review', foldStatus(attn, [it('In review')]).status === 'needs_attention');
check('In review → review', foldStatus(open, [it('Todo'), it('In review')]).status === 'review');
check('In progress → running', foldStatus(open, [it('Done'), it('In progress')]).status === 'running');
check('all Todo → ready', foldStatus(open, [it('Todo'), it('Todo')]).status === 'ready');
check('no items → ready', foldStatus(open, []).status === 'ready');
check('null status ignored', foldStatus(open, [it(null)]).status === 'ready');
check('blocker null when not blocked', foldStatus(open, [it('Todo')]).blocker === null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
