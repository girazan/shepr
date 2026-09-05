// Session marker — <git-common-dir>/orch/session-<sessionId>.json
// { role, milestone, goal, step, startedAt } (spec §4 "session marker").
// Created from the pane's env (ORCH_ROLE, ORCH_IDS=M<n>[.G<k>[.S<j>]]) by
// hooks/session-start.js, or lazily by the first guardrail that needs it;
// updated by scripts/session-marker.js when a role's focus moves. Every
// reader fails open: no marker = today's behaviour. ADVISORY state.
'use strict';
const fs = require('fs');
const path = require('path');
const { resolveRepoKey } = require('./config');

function markerPath(commonDir, sessionId) {
  return path.join(commonDir, 'orch', `session-${String(sessionId).replace(/[^\w.-]/g, '_')}.json`);
}
function parseIds(ids) {
  const m = /^(M\d+)(?:\.(G\d+)(?:\.(S\d+))?)?$/.exec(String(ids || '').trim());
  return m ? { milestone: m[1], goal: m[2] || null, step: m[3] || null } : { milestone: null, goal: null, step: null };
}
function readMarker(commonDir, sessionId) {
  try { return JSON.parse(fs.readFileSync(markerPath(commonDir, sessionId), 'utf8')); } catch { return null; }
}
function writeMarker(commonDir, sessionId, marker) {
  const p = markerPath(commonDir, sessionId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(marker));
  return p;
}
// Marker for this hook payload: the existing one, else one materialised
// from env when ORCH_ROLE is set. Either field may be null.
function ensureMarker(j, env = process.env) {
  const commonDir = resolveRepoKey((j && j.cwd) || process.cwd());
  if (!commonDir || !j || !j.session_id) return { commonDir, marker: null };
  const existing = readMarker(commonDir, j.session_id);
  if (existing) return { commonDir, marker: existing };
  if (!env.ORCH_ROLE) return { commonDir, marker: null };
  const marker = { role: env.ORCH_ROLE, ...parseIds(env.ORCH_IDS), startedAt: new Date().toISOString() };
  try { writeMarker(commonDir, j.session_id, marker); } catch { /* fail-open: advisory state */ }
  return { commonDir, marker };
}
module.exports = { markerPath, parseIds, readMarker, writeMarker, ensureMarker };
