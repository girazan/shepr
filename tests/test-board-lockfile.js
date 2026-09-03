'use strict';
const fs = require('fs');
const path = require('path');
const { withLock } = require('../scripts/lib/lockfile');
const SCRATCH = path.join(__dirname, 'scratch-lockfile');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
const L = path.join(SCRATCH, 'board.lock');
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
check('runs fn and returns its value', withLock(L, () => 42) === 42);
check('lock released after fn', !fs.existsSync(L));
try { withLock(L, () => { throw new Error('boom'); }); } catch {}
check('lock released after fn throws', !fs.existsSync(L));
fs.writeFileSync(L, JSON.stringify({ pid: 999999, t: Date.now() - 60000 }));
check('stale dead-pid lock is taken over', withLock(L, () => 'ok') === 'ok');
fs.writeFileSync(L, JSON.stringify({ pid: process.pid, t: Date.now() }));
let threw = null;
try { withLock(L, () => 'no', { waitMs: 300 }); } catch (e) { threw = e.message; }
check('live-pid lock refuses', /held by pid/.test(threw || ''));
fs.unlinkSync(L);
fs.writeFileSync(L, JSON.stringify({ pid: 999999, t: Date.now() }));
threw = null;
try { withLock(L, () => 'no', { waitMs: 300, staleMs: 60000 }); } catch (e) { threw = e.message; }
check('fresh dead-pid lock is not stolen before staleMs', /held by pid/.test(threw || ''));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
