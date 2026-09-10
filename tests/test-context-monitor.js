// context-monitor: parses a REAL transcript usage object, fires each stage once.
// Regression: a usage object carries nested members (output_tokens_details,
// server_tool_use, cache_creation) and an iterations[] array. The original
// /"usage":\s*\{[^{}]*\}/ could not match one, so the hook silently never fired
// on any session — every other hook had written thousands of markers and this
// one had written none.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOOK = path.join(__dirname, '..', 'hooks', 'context-monitor.js');
// Unique per run: on Windows a scratch dir can stay locked by an unrelated
// process, and a suite that cannot re-run is a suite you stop trusting.
const SCRATCH = path.join(__dirname, `scratch-ctxmon-${process.pid}`);
const PROJ = path.join(SCRATCH, 'proj');
process.on('exit', () => { try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch {} });
fs.mkdirSync(path.join(PROJ, '.claude'), { recursive: true });

let pass = 0, fail = 0, n = 0;
function check(name, cond) { n++; if (cond) { pass++; console.log(`  ok ${n}. ${name}`); } else { fail++; console.log(`FAIL ${n}. ${name}`); } }

// A usage object shaped like a real one: nested members plus iterations[].
const usage = read => ({
  input_tokens: 2,
  cache_creation_input_tokens: 122,
  cache_read_input_tokens: read,
  output_tokens: 2511,
  output_tokens_details: { thinking_tokens: 1935 },
  server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
  cache_creation: { ephemeral_1h_input_tokens: 122, ephemeral_5m_input_tokens: 0 },
  iterations: [{ input_tokens: 2, output_tokens: 2511, cache_creation: { ephemeral_5m_input_tokens: 0 }, type: 'message' }],
});

function transcript(name, read) {
  const p = path.join(SCRATCH, name);
  const lines = [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: usage(read) } }),
  ];
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

let session = 0;
function run(tp, opts = {}) {
  const payload = { session_id: `s${++session}-${process.pid}`, tool_name: 'Bash', cwd: PROJ };
  if (tp) payload.transcript_path = tp;
  if (opts.session) payload.session_id = opts.session;
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: 'utf8' });
  return { out: r.stdout || '', code: r.status };
}

// window 200000: 150000 read -> 25% remaining (trip); 100000 -> 50% (quiet).
const trip = transcript('trip.jsonl', 150000);
const quiet = transcript('quiet.jsonl', 100000);
const pre = transcript('pre.jsonl', 122000); // ~39% remaining -> pre-alarm

const a = run(trip);
check('a nested usage object is parsed and the trip fires', /CONTEXT TRIP/.test(a.out));
check('the trip reports a percentage', /% window remaining/.test(a.out));

const b = run(quiet);
check('plenty of window left stays silent', b.out.trim() === '' && b.code === 0);

const c = run(pre);
check('the pre-alarm fires before the trip', /CONTEXT PRE-ALARM/.test(c.out));

const sid = `once-${process.pid}`;
const d1 = run(trip, { session: sid });
const d2 = run(trip, { session: sid });
check('the trip fires once for a session', /CONTEXT TRIP/.test(d1.out));
check('the same session does not fire again', d2.out.trim() === '');

const e = run(null);
check('no transcript_path exits quietly', e.out.trim() === '' && e.code === 0);

const missing = run(path.join(SCRATCH, 'nope.jsonl'));
check('an unreadable transcript exits quietly', missing.out.trim() === '' && missing.code === 0);

// A torn first line is normal: the hook reads a byte slice of the tail.
const torn = path.join(SCRATCH, 'torn.jsonl');
fs.writeFileSync(torn, '{"type":"assistant","mess' + '\n' +
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: usage(150000) } }) + '\n');
check('a torn leading line is skipped, not fatal', /CONTEXT TRIP/.test(run(torn).out));

console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
