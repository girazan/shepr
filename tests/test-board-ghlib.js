'use strict';
process.env.ORCH_GH_BACKOFF_MS = '1';
const { makeGh } = require('../scripts/lib/gh');
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
let calls = 0;
const flaky = makeGh(() => { calls++; if (calls < 3) throw new Error('net'); return JSON.stringify({ data: { ok: 1 } }); });
check('retries until success', flaky.graphql('query { x }', { a: 1 }).ok === 1 && calls === 3);
calls = 0;
const dead = makeGh(() => { calls++; throw new Error('503'); });
let msg = '';
try { dead.rest('GET', 'repos/o/r'); } catch (e) { msg = e.message; }
check('gives up after 4 attempts', calls === 4 && /after 4 attempts/.test(msg));
const gqlErr = makeGh(() => JSON.stringify({ data: null, errors: [{ message: 'Could not resolve' }] }));
msg = '';
try { gqlErr.graphql('query { x }'); } catch (e) { msg = e.message; }
check('graphql errors array throws', /Could not resolve/.test(msg));
const seen = [];
const rec = makeGh((args, input) => { seen.push({ args, input }); return '{"data":{}}'; });
rec.graphql('query($a:Int){x}', { a: 1 });
rec.rest('POST', 'repos/o/r/issues', { title: 't' });
rec.rest('GET', 'repos/o/r/issues/1');
check('graphql posts {query,variables} on stdin', seen[0].args.join(' ') === 'api graphql --input -' && JSON.parse(seen[0].input).variables.a === 1);
check('rest POST passes method, path, --input -', seen[1].args.join(' ') === 'api -X POST repos/o/r/issues --input -' && JSON.parse(seen[1].input).title === 't');
check('rest GET has no --input', seen[2].args.join(' ') === 'api -X GET repos/o/r/issues/1' && seen[2].input === undefined);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
