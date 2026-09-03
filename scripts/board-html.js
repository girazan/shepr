#!/usr/bin/env node
// board-html — deterministic renderer for /orch:board's HTML view.
// The SKILL (model) owns judgment (stale detection, digest, queue order)
// and passes it as args; this script owns parsing + rendering only, so
// its output is testable and its failures are boring.
'use strict';
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
function opt(name) { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; }
const jsonPath = opt('json');
const positional = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
const [boardPath, outPath] = jsonPath ? [null, positional[0]] : positional;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let buckets = [], items = [], malformed = 0, lines = [];
const laneNames = {}, laneStatus = {};
if (jsonPath) {
  // Input = `board-gh read` JSON (spec §4.3); GitHub is the board. The
  // renderer's internal `milestone` key = the item's `gate:` label.
  let b;
  try { b = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); }
  catch (e) { console.error('board-html: cannot read ' + jsonPath); process.exit(1); }
  buckets = b.buckets || [];
  for (const g of b.goals || []) {
    laneNames[g.lane] = g.name + (g.milestone ? ` · ${g.milestone.title}` : '');
    laneStatus[g.lane] = g.status + (g.blocker ? ` — ${g.blocker}` : '');
    for (const i of g.items) items.push({ lane: i.you ? 'YOU' : g.lane, bucket: i.bucket, done: i.done, text: `${i.text} #${i.issue}`, outcome: i.outcome, milestone: i.gate });
  }
} else {
  let board;
  try { board = fs.readFileSync(boardPath, 'utf8'); }
  catch (e) { console.error('board-html: cannot read ' + boardPath); process.exit(1); }
  lines = board.split(/\r?\n/);
  const routeAt = lines.findIndex(l => /^##\s*ROUTE\b/i.test(l));
  if (routeAt >= 0) {
    for (let i = routeAt + 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (/^##\s/.test(l)) break;
      if (!l) continue;
      const bm = l.match(/^buckets:\s*(.+)$/i);
      if (bm) { buckets = bm[1].split('·').map(s => s.trim()).filter(Boolean); continue; }
      const parts = l.split('|').map(s => s.trim());
      if (parts.length < 3 || !/^(C\d+|G\d+|YOU)$/i.test(parts[0])) { malformed++; continue; }
      const extra = parts[3] || '';
      items.push({ lane: parts[0].toUpperCase(), bucket: parts[1], done: parts[2].startsWith('✓'), text: parts[2].replace(/^✓\s*/, ''),
        outcome: (extra.match(/^->\s*(.+)$/) || [])[1] || null, milestone: (extra.match(/^(?:milestone|gate):\s*(.+)$/i) || [])[1] || null });
    }
  }
  for (const l of lines) {
    const m = l.match(/^\|\s*([CG]\d+)\s*·\s*([^|]+?)\s*\|(.*)\|?$/);
    if (m) { laneNames[m[1]] = m[2].trim(); laneStatus[m[1]] = (m[3].split('|')[0] || '').trim(); }
  }
}
// GATES section: lines after "## GATES" until next heading.
const gatesAt = lines.findIndex(l => /^##\s*GATES\b/i.test(l));
const gates = gatesAt >= 0
  ? lines.slice(gatesAt + 1).filter(l => l.trim() && !/^#/.test(l)).slice(0, 3).join(' ')
  : (lines.find(l => /^Rules of the board/i.test(l)) || '');

const annot = raw => Object.fromEntries((raw || '').split(',').map(s => {
  const i = s.indexOf(':'); return i < 0 ? null : [s.slice(0, i).trim().toUpperCase(), s.slice(i + 1).trim()];
}).filter(Boolean));
const stale = annot(opt('stale')), digest = annot(opt('digest'));

// Worklog metrics: last ledger line's "before → after", BRIEF metric: line.
const metrics = {};
const wl = opt('worklogs');
if (wl) {
  let files = [];
  try { files = fs.readdirSync(wl); } catch {}
  for (const f of files) {
    const m = f.match(/^(C\d+)-.*\.md$/i);
    if (!m) continue;
    let t = '';
    try { t = fs.readFileSync(path.join(wl, f), 'utf8'); } catch { continue; }
    const iters = [...t.matchAll(/^iter .+? · .+? · (.+?) → (.+?) ·/gm)];
    const target = (t.match(/^metric:\s*(.+)$/m) || [])[1] || '';
    const last = iters[iters.length - 1];
    if (last || target) {
      metrics[m[1].toUpperCase()] =
        (last ? `${last[1]} → ${last[2]}` : '') + (target ? ` (${target.trim()})` : '');
    }
  }
}
// Proposed ADRs with age in days.
const adrs = [];
const adrDir = opt('adr');
if (adrDir) {
  let files = [];
  try { files = fs.readdirSync(adrDir); } catch {}
  for (const f of files) {
    try {
      const p = path.join(adrDir, f);
      if (!/^Status:\s*proposed/mi.test(fs.readFileSync(p, 'utf8'))) continue;
      adrs.push(`${f.replace(/\.md$/i, '')} proposed ${Math.round((Date.now() - fs.statSync(p).mtimeMs) / 86400000)}d`);
    } catch {}
  }
}

// --- render --------------------------------------------------------------
const lanes = [...new Set(items.map(i => i.lane))]
  .sort((a, b) => (a === 'YOU') - (b === 'YOU') || a.localeCompare(b, undefined, { numeric: true }));
if (!buckets.length) buckets = [...new Set(items.map(i => i.bucket))];

const cell = its => its.map(i => {
  let t = esc(i.text);
  if (i.done) t = `<s>✓ ${t}</s>`;
  if (i.outcome) t += ` <span class="arrow">──▶ ${esc(i.outcome)}</span>`;
  if (i.milestone) t += ` <b class="ms">= ${esc(i.milestone)} ✅</b>`;
  return `<div class="item">├─▶ ${t}</div>`;
}).join('');

const rows = lanes.map(l => {
  const name = l === 'YOU' ? 'YOU · owner lane' : `${l} · ${esc(laneNames[l] || '')}`;
  const meta = [
    laneStatus[l] ? esc(laneStatus[l]) : '',
    stale[l] ? `<span class="warn">⚠ stale ${esc(stale[l])}</span>` : '',
    metrics[l] ? `<span class="metric">${esc(metrics[l])}</span>` : '',
    digest[l] ? `<span class="digest">${esc(digest[l])}</span>` : '',
  ].filter(Boolean).join(' · ');
  const cells = buckets.map(b =>
    `<td>${cell(items.filter(i => i.lane === l && i.bucket === b))}</td>`).join('');
  return `<tr class="${l === 'YOU' ? 'you' : ''}"><th><div>${name}</div><div class="meta">${meta}</div></th>${cells}</tr>`;
}).join('\n');

const foot = [
  gates ? `GATES: ${esc(gates)}` : '',
  adrs.length ? `ADRs: ${esc(adrs.join(' · '))}` : '',
  opt('queue') ? `TODAY'S QUEUE: ${esc(opt('queue'))}` : '',
  malformed ? `⚠ ${malformed} malformed ROUTE line${malformed > 1 ? 's' : ''} skipped` : '',
].filter(Boolean).map(s => `<div>${s}</div>`).join('');

fs.writeFileSync(outPath, `<!doctype html><meta charset="utf-8">
<title>${esc(opt('title') || 'orch board')}</title>
<style>
:root{color-scheme:dark light;--bg:#0d1117;--fg:#e6edf3;--dim:#8b949e;--line:#30363d;--acc:#58a6ff;--warn:#f0883e;--ok:#3fb950}
@media(prefers-color-scheme:light){:root{--bg:#fff;--fg:#1f2328;--dim:#656d76;--line:#d1d9e0;--acc:#0969da;--warn:#bc4c00;--ok:#1a7f37}}
body{background:var(--bg);color:var(--fg);font:14px/1.5 ui-monospace,monospace;margin:24px}
h1{font-size:18px}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid var(--line);padding:8px;vertical-align:top;text-align:left}
thead th{color:var(--acc)}
tr.you th{color:var(--warn)}
.meta{color:var(--dim);font-size:12px;font-weight:normal}
.item{margin:2px 0}.arrow{color:var(--acc)}.ms{color:var(--ok)}
.warn{color:var(--warn)}.metric{color:var(--ok)}.digest{color:var(--dim)}
s{color:var(--dim)}
footer{margin-top:16px;color:var(--dim);border-top:1px solid var(--line);padding-top:8px}
</style>
<h1>${esc(opt('title') || 'orch board')}</h1>
<table><thead><tr><th></th>${buckets.map(b => `<th>${esc(b)}</th>`).join('')}</tr></thead>
<tbody>${rows}</tbody></table>
<footer>${foot}</footer>
`);
console.log('board-html: wrote ' + outPath);
