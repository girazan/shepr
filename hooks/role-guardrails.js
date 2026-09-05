// PreToolUse (Edit|Write|Read) — role guardrails keyed on ORCH_ROLE (spec
// §6). ADVISORY, every row: ORCH_ROLE is process env set by whoever
// launched the pane — inherited by subagents, settable by the pane itself,
// never a credential. The rows catch a sloppy agent's drift; they do not
// stop intent, and they see only direct tool calls (a Bash `cat`/`sed`
// is out of sight — the v2 caveat). Fail-OPEN on every abnormality: no
// role → no-op; no path / unknown tool / unreadable state → allow. Every
// refusal writes an audit line labelled ADVISORY.
//
//   reviewer      Edit|Write only under docs/reviews/
//   anyone else   no Edit|Write under docs/reviews/ (the evidence lint is what counts)
//   coordinator   Read only tmp/handoffs/, docs/reviews/, .claude/orch.json,
//                 the focus goal's worklog (goal from the session marker)
//   architect     no Edit|Write on a contract domain's paths (docs/adr/, worklog allowed)
//   dev           no Edit|Write touching the worklog's first (BRIEF) block
//
// Contract paths come from loadConfig: an unlocked contract is the
// agent-writable .claude/orch.json, so the audit line also records
// contract: locked|unlocked (spec §6 last row).
'use strict';
const fs = require('fs');
const path = require('path');
const { readStdin, loadConfig, appendAudit } = require('./lib/config');
const { globToRe } = require('./lib/contract');
const { ensureMarker } = require('./lib/session');

const role = process.env.ORCH_ROLE;
if (!role) process.exit(0);
const { j } = readStdin();
if (!j || !j.tool_input) process.exit(0);
const tool = j.tool_name || '';
const file = j.tool_input.file_path || j.tool_input.filePath || '';
if (!file || !/^(Edit|Write|Read)$/.test(tool)) process.exit(0);
const root = j.cwd || process.cwd();
const rel = path.relative(root, path.resolve(root, file)).replace(/\\/g, '/');
const under = dir => rel === dir || rel.startsWith(dir + '/');
const isWrite = tool !== 'Read';
const isWorklog = /^tmp\/worklogs\/[^/]+\.md$/.test(rel);

function refuse(reason, cfg) {
  appendAudit(root, { action: 'role-guardrail', role, tool, file: rel, verdict: 'BLOCK', label: 'ADVISORY',
    contract: cfg ? (cfg.__repoLocked ? 'locked' : 'unlocked') : 'n/a', reason, by: 'hook' });
  console.error(`BLOCKED (orch role-guardrail, ADVISORY): ${reason}`);
  process.exit(2);
}

try {
  if (isWrite && role === 'reviewer' && !under('docs/reviews')) {
    refuse(`ORCH_ROLE=reviewer edits only docs/reviews/ — a reviewer never fixes what it finds; put the finding in the slot file (${rel}).`);
  }
  if (isWrite && role !== 'reviewer' && under('docs/reviews')) {
    refuse(`only the gate reviewer writes docs/reviews/ (ORCH_ROLE=${role}); manifests come from \`orch review\`, never by hand (${rel}).`);
  }
  if (!isWrite && role === 'coordinator') {
    const goal = (ensureMarker(j).marker || {}).goal || null;
    const focusWorklog = goal ? new RegExp(`^tmp/worklogs/${goal}-[^/]*\\.md$`) : /^tmp\/worklogs\/[^/]+\.md$/;
    const ok = under('tmp/handoffs') || under('docs/reviews') || rel === '.claude/orch.json' || focusWorklog.test(rel);
    if (!ok) refuse(`ORCH_ROLE=coordinator reads no code: tmp/handoffs/, docs/reviews/, .claude/orch.json and the focus goal's worklog${goal ? ` (${goal})` : ''} only — dispatch a Dev or Architect instead of reading ${rel}.`);
  }
} catch { process.exit(0); } // fail-open: a guardrail that crashes is no guardrail
process.exit(0);
