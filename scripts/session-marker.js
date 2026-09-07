#!/usr/bin/env node
// session-marker — update the pane's session marker (spec §4): the go
// skill runs `set --goal G<k>` when focus moves; a launcher may run it
// after starting a pane. Reads ORCH_SESSION_ID (exported by
// hooks/session-start.js) unless --session is given. Prints the marker.
'use strict';
const { resolveRepoKey } = require('../hooks/lib/config');
const { readMarker, writeMarker, parseIds } = require('../hooks/lib/session');

const USAGE = 'usage: session-marker <set|show> [--role <role>] [--ids <M<n>|C<n>>[.G<k>[.S<j>]]] [--milestone <M<n>|C<n>>] [--goal G<k>] [--step S<j>] [--session <id>]\n';
const SHAPE = { milestone: /^[MC]\d+$/, goal: /^G\d+$/, step: /^S\d+$/ };

function main(argv, deps = {}) {
  const env = deps.env || process.env;
  const cwd = deps.cwd || process.cwd();
  const out = deps.stdout || (s => process.stdout.write(s));
  const opt = {}; const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else pos.push(argv[i]);
  }
  const verb = pos[0];
  if (verb !== 'set' && verb !== 'show') { out(USAGE); return 1; }
  const session = typeof opt.session === 'string' ? opt.session : env.ORCH_SESSION_ID;
  if (!session) { out('session-marker: no session id — ORCH_SESSION_ID is unset (SessionStart hook did not run?) and --session not given\n'); return 1; }
  const commonDir = resolveRepoKey(cwd);
  if (!commonDir) { out('session-marker: not inside a git repository\n'); return 1; }
  let marker = readMarker(commonDir, session);
  if (verb === 'show') { out(marker ? JSON.stringify(marker) + '\n' : 'session-marker: no marker for this session\n'); return marker ? 0 : 1; }
  marker = marker || { role: env.ORCH_ROLE || null, milestone: null, goal: null, step: null, startedAt: new Date().toISOString() };
  if (typeof opt.ids === 'string') {
    const ids = parseIds(opt.ids);
    if (!ids.milestone) { out('session-marker: --ids must match <M<n>|C<n>>[.G<k>[.S<j>]]\n'); return 1; }
    Object.assign(marker, ids);
  }
  for (const k of ['role', 'milestone', 'goal', 'step']) if (typeof opt[k] === 'string') marker[k] = opt[k];
  for (const [k, re] of Object.entries(SHAPE)) {
    if (marker[k] !== null && !re.test(marker[k])) { out(`session-marker: ${k} must match ${re}\n`); return 1; }
  }
  writeMarker(commonDir, session, marker);
  out(JSON.stringify(marker) + '\n');
  return 0;
}
if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main };
