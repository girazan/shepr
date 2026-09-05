// SessionStart — materialises the session marker for a roled pane (spec §4
// "session marker"): the launcher sets ORCH_ROLE and ORCH_IDS in the pane's
// env; this hook keys them to the session id only the hook payload knows,
// and exports ORCH_SESSION_ID for the session (CLAUDE_ENV_FILE) so
// scripts/session-marker.js can find the marker when focus moves.
// ADVISORY, silent on every failure; no-op without ORCH_ROLE.
'use strict';
const fs = require('fs');
const { readStdin } = require('./lib/config');
const { ensureMarker } = require('./lib/session');

if (!process.env.ORCH_ROLE) process.exit(0);
const { j } = readStdin();
if (!j) process.exit(0);
const { marker } = ensureMarker(j);
if (marker && process.env.CLAUDE_ENV_FILE) {
  try { fs.appendFileSync(process.env.CLAUDE_ENV_FILE, `export ORCH_SESSION_ID=${JSON.stringify(String(j.session_id))}\n`); } catch {}
}
process.exit(0);
