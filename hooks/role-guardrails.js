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

// BRIEF block = from the first `BRIEF` line (else line 1) to the next blank
// line — the copy the goal skill puts at the top of every worklog.
function briefBlock(text) {
  const lines = text.split(/\r?\n/);
  let s = lines.findIndex(l => /^BRIEF\b/.test(l));
  if (s < 0) s = 0;
  let e = s;
  while (e < lines.length && lines[e].trim() !== '') e++;
  return lines.slice(s, e).filter(l => l.trim() !== '');
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
  if (isWrite && role === 'architect' && !under('docs/adr') && !isWorklog) {
    const cfg = loadConfig(j);
    const domains = (cfg.contract && cfg.contract.domains) || {};
    for (const [name, d] of Object.entries(domains)) {
      if (d && Array.isArray(d.paths) && d.paths.some(p => typeof p === 'string' && globToRe(p).test(rel))) {
        refuse(`ORCH_ROLE=architect writes no production code: ${rel} is domain "${name}" — plan it as a step (add-item) for a Dev; docs/adr/ and the worklog stay open.`, cfg);
      }
    }
  }
  if (isWrite && role === 'dev' && isWorklog) {
    let current = null;
    try { current = fs.readFileSync(path.resolve(root, file), 'utf8'); } catch { current = null; }
    if (current !== null) {
      const brief = briefBlock(current);
      const touches = tool === 'Edit'
        ? brief.some(line => String(j.tool_input.old_string || '').includes(line))
        : briefBlock(String(j.tool_input.content || '')).join('\n') !== brief.join('\n');
      if (touches) refuse(`ORCH_ROLE=dev changes no scope: the worklog's first block is the BRIEF — append to the ledger below it; a scope change is the Director's (${rel}).`);
    }
  }
} catch { process.exit(0); } // fail-open: a guardrail that crashes is no guardrail
process.exit(0);
