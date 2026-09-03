// Thin `gh api` runner. Argument arrays only (spec §4.3). Retry 3× with
// 2/4/8 s backoff on any failure, then throw — the caller's step fails;
// nothing is queued (spec §4.3 "Failure").
'use strict';
const { execFileSync } = require('child_process');

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

function defaultRun(args, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8', input: input == null ? undefined : input,
    stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'], timeout: 60000,
  });
}

function makeGh(run = defaultRun) {
  const base = Number(process.env.ORCH_GH_BACKOFF_MS || 2000);
  function attempt(args, input) {
    let last;
    for (let i = 0; i < 4; i++) {
      if (i) sleep(base * 2 ** (i - 1));
      try { return run(args, input); } catch (e) { last = e; }
    }
    throw new Error(`gh failed after 4 attempts: ${last && last.message}`);
  }
  return {
    graphql(query, variables = {}) {
      const j = JSON.parse(attempt(['api', 'graphql', '--input', '-'], JSON.stringify({ query, variables })));
      if (j.errors && j.errors.length) throw new Error(`graphql: ${j.errors[0].message}`);
      return j.data;
    },
    rest(method, apiPath, body) {
      const args = ['api', '-X', method, apiPath];
      let input;
      if (body !== undefined) { args.push('--input', '-'); input = JSON.stringify(body); }
      const out = attempt(args, input);
      return out.trim() ? JSON.parse(out) : null;
    },
  };
}

module.exports = { makeGh, defaultRun };
