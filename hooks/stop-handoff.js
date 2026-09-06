// Stop — "no Stop without a handoff" (spec §6). A roled pane that edited
// anything since its session marker's startedAt may not end until its
// handoff file is newer than startedAt:
//   dev          tmp/handoffs/M<n>.G<k>.S<j>-dev.md
//   architect    tmp/handoffs/M<n>.G<k>-architect.md
//   coordinator  tmp/handoffs/M<n>-coordinator.md
// Refuses ONCE (stop_hook_active), names the file. ADVISORY and fail-open:
// no marker, no role, ids missing, bad startedAt, unreadable transcript →
// let it end. Size budgets (spec §6) are one advisory stderr line, exit 0:
// handoff ≤ 40 lines; the worklog's plan section (`## Plan` to the next
// `## `) ≤ 300 lines and ≤ 7 steps.
'use strict';
const fs = require('fs');
const path = require('path');
const { readStdin, appendAudit } = require('./lib/config');
const { ensureMarker } = require('./lib/session');
const { countEdits } = require('./lib/transcript');

function handoffFor(m) {
  if (m.role === 'dev' && m.milestone && m.goal && m.step) return `tmp/handoffs/${m.milestone}.${m.goal}.${m.step}-dev.md`;
  if (m.role === 'architect' && m.milestone && m.goal) return `tmp/handoffs/${m.milestone}.${m.goal}-architect.md`;
  if (m.role === 'coordinator' && m.milestone) return `tmp/handoffs/${m.milestone}-coordinator.md`;
  return null;
}
function budgets(root, m, handoff) {
  const lines = p => { try { return fs.readFileSync(p, 'utf8').split(/\r?\n/); } catch { return null; } };
  const over = [];
  const h = lines(path.join(root, handoff));
  if (h && h.length > 40) over.push(`${handoff} is ${h.length} lines (budget 40)`);
  if (!m.goal) return over;
  let wl = null;
  try { wl = fs.readdirSync(path.join(root, 'tmp', 'worklogs')).find(f => f.startsWith(`${m.goal}-`) && f.endsWith('.md')); } catch { wl = null; }
  const w = wl && lines(path.join(root, 'tmp', 'worklogs', wl));
  if (!w) return over;
  const s = w.findIndex(l => /^## Plan\b/.test(l));
  if (s < 0) return over;
  let e = s + 1;
  while (e < w.length && !/^## /.test(w[e])) e++;
  const plan = w.slice(s + 1, e);
  const steps = plan.filter(l => /^\s*(?:[-*]|\d+\.)\s+S\d+\b/.test(l)).length;
  if (plan.length > 300) over.push(`${wl} plan section is ${plan.length} lines (budget 300)`);
  if (steps > 7) over.push(`${wl} plan section has ${steps} steps (budget 7 — split the goal)`);
  return over;
}

const { j } = readStdin();
if (!j) process.exit(0);
const root = j.cwd || process.cwd();
let marker = null;
try { marker = ensureMarker(j).marker; } catch { marker = null; }
if (!marker || !marker.role) process.exit(0);
const handoff = handoffFor(marker);
if (!handoff) process.exit(0); // reviewer, or ids the launcher never set
const started = Date.parse(marker.startedAt);
if (Number.isNaN(started)) process.exit(0);
let mtime = 0;
try { mtime = fs.statSync(path.join(root, handoff)).mtimeMs; } catch { mtime = 0; }
if (mtime > started) {
  const over = budgets(root, marker, handoff);
  if (over.length) console.error(`SIZE BUDGET (shepr, ADVISORY): ${over.join(' · ')}.`);
  process.exit(0);
}
if (j.stop_hook_active) process.exit(0); // refused once already — let it end
const edits = countEdits(j.transcript_path, marker.startedAt);
if (edits < 1) process.exit(0);
appendAudit(root, { action: 'stop-handoff', role: marker.role, file: handoff, verdict: 'BLOCK', label: 'ADVISORY',
  reason: `${edits} edit(s) since ${marker.startedAt}, no handoff newer than that`, by: 'hook' });
console.error(
  `HANDOFF (shepr, ADVISORY): ${edits} edit(s) this session as ${marker.role} and no handoff newer than ${marker.startedAt}. ` +
  `Write ${handoff} (≤40 lines: what changed · what is blocked · what was decided · the next role's first action), then stop again.`
);
process.exit(2);
