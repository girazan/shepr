# Board on GitHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `docs/BOARD.md` with GitHub Issues + Projects v2 as orch's only board store, driven by one CLI (`scripts/board-gh.js`) that the goal/go/board skills call.

**Architecture:** Three levels, matching how the operator already runs Pertasim: **milestone** = GitHub Milestone `C<n> …` (operator-owned, orch never creates one) → **goal** = Issue labeled `orch:goal` (the BRIEF is its body, lane id `G<issue#>`) → **items** = sub-issues of the goal. Board columns = the Project's existing `Priority` field (`Now/Next/Later` after the operator renames `P0/P1/P2`). Goal status is never stored — it is folded from the sub-issues. Every mutating verb runs under a repo lockfile and journals each sub-effect (intent → GitHub call → done, fsynced) so a crash resumes idempotently. GitHub unreachable = the step fails; nothing is queued.

**Tech Stack:** Node ≥ 20 (stdlib only — `fs`, `child_process`, `crypto`), `gh` CLI (`gh api` REST + GraphQL, operator's own login), repo's zero-framework `tests/test-*.js` + `check()` style.

**Spec:** `docs/specs/2026-08-31-orch-v2-upgrade-design.md` §4 (r8d), with §1 "Lock scope" (`board.github`) and §2.3 (`close-goal` evidence match).

## Global Constraints

- Stdlib only. No new npm dependencies (`package.json` has none today; keep it that way).
- Process execution is always argument-array (`execFileSync('gh', [...])`), never a shell string (spec §4.3).
- Gate hooks make **no network calls** (threat model). Only `scripts/board-gh.js` talks to GitHub; the ship-gate hook reads git only.
- Every GitHub call: retry 3× with 2/4/8 s backoff, then exit non-zero (spec §4.3 "Failure").
- Journal: intent record fsynced **before** the call; done record fsynced after; torn last line treated as absent (spec §4.3).
- Vocabulary (spec r8d): **milestone** = GitHub Milestone (`C<n> …`, operator's); **goal** = `orch:goal` issue, lane `G<issue#>`; **item** = sub-issue; **gate** = the item whose completion closes the goal, marked `gate: <LABEL>` in its body (never the word "milestone" for this). "campaign" is not used anywhere.
- Labels orch owns: `orch:goal orch:item orch:you orch:blocked orch:needs_attention` — never touch any other label. No `orch:bucket:*`.
- Buckets (`Now`/`Next`/`Later`) are the Project's existing **`Priority`** single-select options, read at init in field order. orch never renames options (the operator renames `P0/P1/P2` in the UI). No Iteration field.
- `Pipeline`/`Feature` are pass-through: `add-item --pipeline <existing option> [--feature <existing option>]`. `init` creates `Pipeline`/`Priority` only when absent.
- `init --project <number>` adopts an existing Project (Pertasim = `--project 1` under `istart-dev`); without it, find-or-create `<repo> · orch board`.
- Identity marker on every orch item body, last line: `<!-- orch-item -->`. Goal issues carry label `orch:goal`; their body is the BRIEF verbatim.
- `YOU` items are sub-issues carrying `orch:item` + `orch:you`, assigned to the operator login.
- Config file: `.orch/board.json` (spec §4.2). Committed.
- Tests use fake HOME/cwd under `tests/scratch-*` and never call real `gh` — `board-gh.js` takes an injected runner.
- Commit after every task. Commit messages: `feat(board-gh): …` / `test(board-gh): …` / `docs(board): …`.

---

## File map

| File | Responsibility |
|---|---|
| `scripts/lib/gh.js` | `makeGh(run)` → `{graphql, rest}` with retry/backoff; `defaultRun` = `execFileSync('gh', …)` |
| `scripts/lib/lockfile.js` | `withLock(lockPath, fn)` — O_EXCL, PID liveness, 30 s stale takeover |
| `scripts/lib/journal.js` | `openJournal(path)` → `{pending(), intent(rec), done(opId, remoteId)}` with fsync + torn-tail rule |
| `scripts/lib/fold.js` | `foldStatus(goal, items)` → goal status + blocker (pure) |
| `scripts/board-gh.js` | CLI entry: config, `read`, `milestones`; exports `main(argv, deps)` |
| `scripts/board-gh-init.js` | `init` verb |
| `scripts/board-gh-write.js` | mutating verbs under lock + journal |
| `scripts/board-html.js` | gains `--json <file>` input (board-gh `read` output) |
| `hooks/lib/config.js` | exposes `out.board` from `lock.repos[key].board` |
| `hooks/contract-ship-gate.js` | pre-check: `board-gh.js close-goal G<n>` requires ledger line in HEAD's worklog |
| `skills/goal/SKILL.md`, `skills/go/SKILL.md`, `skills/board/SKILL.md`, `skills/setup/SKILL.md` | re-pointed at `board-gh` |
| `tests/test-board-fold.js`, `tests/test-board-journal.js`, `tests/test-board-lockfile.js`, `tests/test-board-ghlib.js`, `tests/test-board-gh.js`, `tests/test-board-gh-init.js`, `tests/test-board-html-json.js`, `tests/test-ship-gate-close-goal.js` | one suite per unit |

---

### Task 1: `scripts/lib/fold.js` — goal status fold

**Files:**
- Create: `scripts/lib/fold.js`
- Test: `tests/test-board-fold.js`

**Interfaces:**
- Produces: `foldStatus(goal, items) → { status, blocker }`
  - `goal`: `{ state: 'open'|'closed', labels: string[] }`
  - `items`: `[{ labels: string[], status: 'Todo'|'In progress'|'In review'|'Done'|null, blockerComment: string|null }]`
  - `status` ∈ `merged|blocked|needs_attention|review|running|ready`; `blocker` = the first blocked item's `blockerComment` or `null`

- [ ] **Step 1: Write the failing test**

`tests/test-board-fold.js`:
```javascript
'use strict';
const { foldStatus } = require('../scripts/lib/fold');
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
const open = { state: 'open', labels: ['orch:goal'] }, closed = { state: 'closed', labels: ['orch:goal'] };
const attn = { state: 'open', labels: ['orch:goal', 'orch:needs_attention'] };
const it = (status, labels = [], blockerComment = null) => ({ status, labels, blockerComment });

check('closed goal → merged even with blocked items', foldStatus(closed, [it('Todo', ['orch:blocked'], 'x')]).status === 'merged');
check('orch:blocked wins over In progress', foldStatus(open, [it('In progress'), it('Todo', ['orch:blocked'], 'blocked: needs setup · owner: you')]).status === 'blocked');
check('blocker text comes from the blocked item', foldStatus(open, [it('Todo', ['orch:blocked'], 'blocked: needs setup · owner: you')]).blocker === 'blocked: needs setup · owner: you');
check('needs_attention on the goal beats review', foldStatus(attn, [it('In review')]).status === 'needs_attention');
check('In review → review', foldStatus(open, [it('Todo'), it('In review')]).status === 'review');
check('In progress → running', foldStatus(open, [it('Done'), it('In progress')]).status === 'running');
check('all Todo → ready', foldStatus(open, [it('Todo'), it('Todo')]).status === 'ready');
check('no items → ready', foldStatus(open, []).status === 'ready');
check('null status ignored', foldStatus(open, [it(null)]).status === 'ready');
check('blocker null when not blocked', foldStatus(open, [it('Todo')]).blocker === null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails** — Run: `node tests/test-board-fold.js` — Expected: `Cannot find module '../scripts/lib/fold'`

- [ ] **Step 3: Write minimal implementation**

`scripts/lib/fold.js`:
```javascript
// Goal status is DERIVED from the goal issue + its sub-issues (spec §4.1
// fold). Nothing stores it, so nothing can drift. First match wins.
'use strict';
function has(x, label) { return (x.labels || []).includes(label); }

function foldStatus(goal, items) {
  if (goal.state === 'closed') return { status: 'merged', blocker: null };
  const blocked = items.find(i => has(i, 'orch:blocked'));
  if (blocked) return { status: 'blocked', blocker: blocked.blockerComment || null };
  if (has(goal, 'orch:needs_attention')) return { status: 'needs_attention', blocker: null };
  if (items.some(i => i.status === 'In review')) return { status: 'review', blocker: null };
  if (items.some(i => i.status === 'In progress')) return { status: 'running', blocker: null };
  return { status: 'ready', blocker: null };
}

module.exports = { foldStatus };
```

- [ ] **Step 4: Run test to verify it passes** — `node tests/test-board-fold.js` — Expected: `10 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/fold.js tests/test-board-fold.js
git commit -m "feat(board-gh): goal status fold (spec §4.1)"
```

---

### Task 2: `scripts/lib/journal.js` — fsynced intent/done journal

**Files:**
- Create: `scripts/lib/journal.js`
- Test: `tests/test-board-journal.js`

**Interfaces:**
- Produces: `openJournal(filePath) → { intent(rec), done(opId, remoteId), pending() }`
  - `intent({ opId, lane, subEffect, desired })` appends `{...rec, status:'intent', ts}` and fsyncs
  - `done(opId, remoteId)` appends `{ opId, status:'done', remoteId, ts }` and fsyncs
  - `pending()` → intent records with no matching done record, in file order; a torn (non-JSON) final line is ignored

- [ ] **Step 1: Write the failing test**

`tests/test-board-journal.js`:
```javascript
'use strict';
const fs = require('fs');
const path = require('path');
const { openJournal } = require('../scripts/lib/journal');
const SCRATCH = path.join(__dirname, 'scratch-journal');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
const J = path.join(SCRATCH, 'board-journal.jsonl');
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
let j = openJournal(J);
check('fresh journal has no pending', j.pending().length === 0);
j.intent({ opId: 'a', lane: 'G1', subEffect: 'createIssue', desired: { title: 'x' } });
check('intent is pending', j.pending().map(r => r.opId).join() === 'a');
j.done('a', 'I_123');
check('done clears pending', j.pending().length === 0);
j.intent({ opId: 'b', lane: 'G1', subEffect: 'comment', desired: {} });
j.intent({ opId: 'c', lane: 'G1', subEffect: 'close', desired: {} });
j.done('c', 'x');
check('pending preserves file order and skips done', j.pending().map(r => r.opId).join() === 'b');
fs.appendFileSync(J, '{"opId":"torn","status":"inte');
check('torn final line is ignored', openJournal(J).pending().map(r => r.opId).join() === 'b');
j = openJournal(J);
j.intent({ opId: 'd', lane: 'G2', subEffect: 'x', desired: {} });
const lines = fs.readFileSync(J, 'utf8').split('\n').filter(Boolean);
check('append after torn line starts on a fresh line', JSON.parse(lines[lines.length - 1]).opId === 'd');
check('records carry ts', typeof JSON.parse(lines[0]).ts === 'string');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails** — `node tests/test-board-journal.js` — Expected: `Cannot find module '../scripts/lib/journal'`

- [ ] **Step 3: Write minimal implementation**

`scripts/lib/journal.js`:
```javascript
// Append-only JSONL journal of board sub-effects (spec §4.3). Every record
// is fsynced before the function returns: an intent that isn't durable
// before its GitHub call can vanish and duplicate on resume.
'use strict';
const fs = require('fs');
const path = require('path');

function readRecords(filePath) {
  let raw = '';
  try { raw = fs.readFileSync(filePath, 'utf8'); } catch { return { records: [], tornTail: false }; }
  const lines = raw.split('\n');
  const records = [];
  let tornTail = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    try { records.push(JSON.parse(l)); }
    catch {
      // Only the LAST non-empty line may be torn (crash mid-append); it is
      // treated as absent. Anything else unparseable is corruption → throw.
      if (lines.slice(i + 1).every(x => !x)) { tornTail = true; break; }
      throw new Error(`board journal corrupt at line ${i + 1}: ${filePath}`);
    }
  }
  return { records, tornTail };
}

function openJournal(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  function append(rec) {
    const { tornTail } = readRecords(filePath);
    const fd = fs.openSync(filePath, 'a');
    try {
      fs.writeSync(fd, (tornTail ? '\n' : '') + JSON.stringify({ ...rec, ts: new Date().toISOString() }) + '\n');
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  }
  return {
    intent(rec) { append({ ...rec, status: 'intent' }); },
    done(opId, remoteId) { append({ opId, status: 'done', remoteId: remoteId == null ? null : remoteId }); },
    pending() {
      const { records } = readRecords(filePath);
      const doneIds = new Set(records.filter(r => r.status === 'done').map(r => r.opId));
      return records.filter(r => r.status === 'intent' && !doneIds.has(r.opId));
    },
  };
}

module.exports = { openJournal };
```

- [ ] **Step 4: Run test to verify it passes** — `node tests/test-board-journal.js` — Expected: `7 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/journal.js tests/test-board-journal.js
git commit -m "feat(board-gh): fsynced sub-effect journal with torn-tail recovery (spec §4.3)"
```

---

### Task 3: `scripts/lib/lockfile.js` — O_EXCL repo lock with liveness takeover

**Files:**
- Create: `scripts/lib/lockfile.js`
- Test: `tests/test-board-lockfile.js`

**Interfaces:**
- Produces: `withLock(lockPath, fn, { staleMs = 30000, waitMs = 10000 } = {}) → fn()'s return value`
  - lockfile content `{"pid":<n>,"t":<epoch ms>}`; held by a live PID → retry every 200 ms up to `waitMs`, then throw `Error('board lock held by pid N …')`; dead PID **and** older than `staleMs` → delete + retake; always unlinks in `finally`.

- [ ] **Step 1: Write the failing test**

`tests/test-board-lockfile.js`:
```javascript
'use strict';
const fs = require('fs');
const path = require('path');
const { withLock } = require('../scripts/lib/lockfile');
const SCRATCH = path.join(__dirname, 'scratch-lockfile');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
const L = path.join(SCRATCH, 'board.lock');
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
check('runs fn and returns its value', withLock(L, () => 42) === 42);
check('lock released after fn', !fs.existsSync(L));
try { withLock(L, () => { throw new Error('boom'); }); } catch {}
check('lock released after fn throws', !fs.existsSync(L));
fs.writeFileSync(L, JSON.stringify({ pid: 999999, t: Date.now() - 60000 }));
check('stale dead-pid lock is taken over', withLock(L, () => 'ok') === 'ok');
fs.writeFileSync(L, JSON.stringify({ pid: process.pid, t: Date.now() }));
let threw = null;
try { withLock(L, () => 'no', { waitMs: 300 }); } catch (e) { threw = e.message; }
check('live-pid lock refuses', /held by pid/.test(threw || ''));
fs.unlinkSync(L);
fs.writeFileSync(L, JSON.stringify({ pid: 999999, t: Date.now() }));
threw = null;
try { withLock(L, () => 'no', { waitMs: 300, staleMs: 60000 }); } catch (e) { threw = e.message; }
check('fresh dead-pid lock is not stolen before staleMs', /held by pid/.test(threw || ''));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails** — `node tests/test-board-lockfile.js` — Expected: `Cannot find module`

- [ ] **Step 3: Write minimal implementation**

`scripts/lib/lockfile.js`:
```javascript
// Exclusive lockfile for board writes (spec §3.1 discipline, §4.3 use).
// O_EXCL create is the atomicity primitive; a lock whose owner PID is dead
// AND whose file is older than staleMs is taken over.
// ponytail: liveness = process.kill(pid, 0) only; PID reuse inside the
// stale window is accepted. Add the OS start-time check (spec §3.1) when
// the fleet roster lands and shares this file.
'use strict';
const fs = require('fs');
const path = require('path');

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

function withLock(lockPath, fn, { staleMs = 30000, waitMs = 10000 } = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + waitMs;
  let fd;
  for (;;) {
    try { fd = fs.openSync(lockPath, 'wx'); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner = null;
      try { owner = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
      const stale = owner && typeof owner.t === 'number' && Date.now() - owner.t > staleMs;
      const dead = !owner || typeof owner.pid !== 'number' || !alive(owner.pid);
      if (stale && dead) { try { fs.unlinkSync(lockPath); } catch {} continue; }
      if (Date.now() >= deadline) throw new Error(`board lock held by pid ${owner ? owner.pid : '?'} (${lockPath})`);
      sleep(200);
    }
  }
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, t: Date.now() }));
    fs.fsyncSync(fd);
    return fn();
  } finally {
    try { fs.closeSync(fd); } catch {}
    try { fs.unlinkSync(lockPath); } catch {}
  }
}

module.exports = { withLock };
```

- [ ] **Step 4: Run test** — `node tests/test-board-lockfile.js` — Expected: `6 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/lockfile.js tests/test-board-lockfile.js
git commit -m "feat(board-gh): O_EXCL repo lockfile with dead-pid takeover"
```

---

### Task 4: `scripts/lib/gh.js` — `gh api` runner with retry/backoff

**Files:**
- Create: `scripts/lib/gh.js`
- Test: `tests/test-board-ghlib.js`

**Interfaces:**
- Produces: `makeGh(run = defaultRun) → { graphql(query, variables), rest(method, apiPath, body) }`
  - `run(args: string[], input?: string) → string` (stdout). Both retry `run` 3× on throw (2/4/8 s; env `ORCH_GH_BACKOFF_MS` overrides the base), then throw `Error('gh failed after 4 attempts: <msg>')`.
  - `graphql` posts `{query, variables}` JSON on stdin via `gh api graphql --input -`; throws when the response has a non-empty `errors` array.
  - `rest` runs `gh api -X <METHOD> <path> [--input -]`, body JSON on stdin; returns parsed JSON or `null` for empty output.
  - `defaultRun(args, input)` = `execFileSync('gh', args, { encoding:'utf8', input, stdio:[input==null?'ignore':'pipe','pipe','pipe'], timeout:60000 })`

- [ ] **Step 1: Write the failing test**

`tests/test-board-ghlib.js`:
```javascript
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
```

- [ ] **Step 2: Run test to verify it fails** — `node tests/test-board-ghlib.js` — Expected: `Cannot find module '../scripts/lib/gh'`

- [ ] **Step 3: Write minimal implementation**

`scripts/lib/gh.js`:
```javascript
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
```

- [ ] **Step 4: Run test** — `node tests/test-board-ghlib.js` — Expected: `6 passed, 0 failed`

- [ ] **Step 5: Live sanity (manual, once):** `node -e "const {makeGh}=require('./scripts/lib/gh');console.log(makeGh().graphql('query{viewer{login}}'))"` → `{ viewer: { login: '<you>' } }`

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/gh.js tests/test-board-ghlib.js
git commit -m "feat(board-gh): gh api runner with retry/backoff"
```

---

### Task 5: `scripts/board-gh.js` — config, `milestones`, `read` (goal fold)

**Files:**
- Create: `scripts/board-gh.js`, stubs `scripts/board-gh-init.js`, `scripts/board-gh-write.js`
- Test: `tests/test-board-gh.js`

**Interfaces:**
- Consumes: `makeGh`, `foldStatus`, `openJournal`, `withLock`
- Produces:
  - `main(argv, deps) → exit code`; `deps = { gh, cwd, commonDir, stdout, lockCfg }`
  - `.orch/board.json` shape (written by `init`, Task 6):
    ```json
    { "owner": "istart-dev", "repo": "i-Start", "projectOwner": "istart-dev", "ownerType": "Organization",
      "projectNumber": 1, "projectId": "PVT_x",
      "fieldIds": { "status": "PVTSSF_s", "priority": "PVTSSF_r", "pipeline": "PVTSSF_p", "feature": null },
      "optionIds": { "status": { "Todo": "o1", "In progress": "o2", "In review": "o3", "Done": "o4" },
                     "priority": { "Now": "r1", "Next": "r2", "Later": "r3" },
                     "pipeline": { "Engine": "p1" }, "feature": {} } }
    ```
    `buckets` = `Object.keys(cfg.optionIds.priority)` (field order). `loadCfg` requires `fieldIds.status`, `fieldIds.priority`, and ≥ 1 priority option.
  - `milestones` → prints JSON `[{ number, title, open, closed }]`: open milestones, `C<n>` titles first (numeric), then `backlog`, then the rest.
  - `read [--goal G<n>] [--json]` → JSON:
    ```json
    { "goals": [ { "lane": "G142", "issue": 142, "name": "knowledge-gate",
        "milestone": { "number": 49, "title": "C1 SHU-HDS operable" } | null,
        "status": "running", "blocker": null, "brief": "<goal body>", "updated": "…",
        "items": [ { "issue": 150, "bucket": "Now", "pipeline": "Engine", "feature": null, "status": "In progress",
                     "text": "…", "outcome": "…"|null, "gate": "LABEL"|null,
                     "done": false, "you": false, "updated": "…" } ] } ],
      "buckets": ["Now", "Next", "Later"] }
    ```
    Goals ordered by milestone number (none last), then issue number.
  - Item body grammar (written by `add-item`, parsed by `read`): `<text>\n\n[outcome: …]\n[gate: …]\n<!-- orch-item -->`
  - `bucket` = the item's `Priority` field value; unset → `buckets[0]`. `done` = state `CLOSED` or Status `Done`.
  - Exports `{ main, parseBody, bodyOf, readBoard, listMilestones, loadCfg, MARK, STATUS_OPTS }`.

- [ ] **Step 1: Write the failing test**

`tests/test-board-gh.js`:
```javascript
'use strict';
const fs = require('fs');
const path = require('path');
const { main } = require('../scripts/board-gh');
const SCRATCH = path.join(__dirname, 'scratch-board-gh');
fs.rmSync(SCRATCH, { recursive: true, force: true });
const CWD = path.join(SCRATCH, 'repo'), COMMON = path.join(SCRATCH, 'repo', '.git');
fs.mkdirSync(path.join(CWD, '.orch'), { recursive: true });
fs.mkdirSync(COMMON, { recursive: true });
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
const CFG = {
  owner: 'o', repo: 'r', projectOwner: 'o', ownerType: 'Organization', projectNumber: 1, projectId: 'PVT_1',
  fieldIds: { status: 'F_S', priority: 'F_R', pipeline: 'F_P', feature: null },
  optionIds: { status: { Todo: 's1', 'In progress': 's2', 'In review': 's3', Done: 's4' },
    priority: { Now: 'r1', Next: 'r2', Later: 'r3' }, pipeline: { Engine: 'p1' }, feature: {} },
};
function writeCfg(c) { fs.writeFileSync(path.join(CWD, '.orch', 'board.json'), JSON.stringify(c)); }
function fakeGh(handlers) {
  const calls = [];
  return { calls,
    graphql(q, v) { calls.push({ kind: 'graphql', q, v }); for (const [re, fn] of handlers) if (re.test(q)) return fn(v, q); throw new Error('unhandled graphql: ' + q.slice(0, 60)); },
    rest(m, p, b) { calls.push({ kind: 'rest', m, p, b }); for (const [re, fn] of handlers) if (re.test(m + ' ' + p)) return fn(b, m + ' ' + p); throw new Error('unhandled rest: ' + m + ' ' + p); },
  };
}
function run(argv, gh, extra = {}) {
  let out = '';
  const code = main(argv, { gh, cwd: CWD, commonDir: COMMON, stdout: s => { out += s; }, lockCfg: { __repoLocked: false }, ...extra });
  return { code, out };
}
const pi = (status, pipeline, priority) => ({ nodes: [{ project: { id: 'PVT_1' }, fieldValues: { nodes: [
  status ? { name: status, field: { name: 'Status' } } : null, pipeline ? { name: pipeline, field: { name: 'Pipeline' } } : null,
  priority ? { name: priority, field: { name: 'Priority' } } : null].filter(Boolean) } }] });

// --- no config → refuse -------------------------------------------------------
fs.rmSync(path.join(CWD, '.orch', 'board.json'), { force: true });
{ const r = run(['read'], fakeGh([])); check('read without board.json refuses with init hint', r.code === 1 && /orch:board init/.test(r.out)); }

// --- milestones ---------------------------------------------------------------
writeCfg(CFG);
{
  const gh = fakeGh([[/GET repos\/o\/r\/milestones/, () => [
    { number: 52, title: 'backlog', open_issues: 4, closed_issues: 25 },
    { number: 50, title: 'C2 Authoring tools ready', open_issues: 8, closed_issues: 2 },
    { number: 49, title: 'C1 SHU-HDS operable', open_issues: 60, closed_issues: 9 },
    { number: 30, title: 'v0.9.1', open_issues: 0, closed_issues: 7 } ]]]);
  const r = run(['milestones'], gh);
  const j = JSON.parse(r.out);
  check('milestones: C<n> numeric first, then backlog, then rest', j.map(c => c.number).join() === '49,50,52,30' && j[0].open === 60);
}

// --- read folds goal status -----------------------------------------------------
const GOALS = { repository: { issues: { nodes: [
  { number: 142, title: 'knowledge-gate', state: 'OPEN', updatedAt: '2026-09-01T00:00:00Z', body: 'BRIEF\ngoal: x',
    milestone: { number: 49, title: 'C1 SHU-HDS operable' }, labels: { nodes: [{ name: 'orch:goal' }] }, projectItems: pi('Todo'),
    subIssues: { nodes: [
      { number: 150, title: 'write grammar', state: 'OPEN', updatedAt: '2026-09-01T00:00:00Z', body: 'write grammar\n\noutcome: canonical home\n<!-- orch-item -->',
        labels: { nodes: [{ name: 'orch:item' }] }, assignees: { nodes: [] }, projectItems: pi('In progress', 'Engine', 'Now') },
      { number: 151, title: 'gate wired', state: 'OPEN', updatedAt: '2026-09-02T00:00:00Z', body: 'gate wired\n\ngate: GATE LIVE\n<!-- orch-item -->',
        labels: { nodes: [{ name: 'orch:item' }] }, assignees: { nodes: [] }, projectItems: pi('Todo', null, 'Next') },
      { number: 152, title: 'run /orch:setup', state: 'OPEN', updatedAt: '2026-09-02T00:00:00Z', body: 'run /orch:setup\n<!-- orch-item -->',
        labels: { nodes: [{ name: 'orch:item' }, { name: 'orch:you' }] }, assignees: { nodes: [{ login: 'me' }] }, projectItems: pi('Todo') } ] } },
  { number: 99, title: 'old goal', state: 'CLOSED', updatedAt: '2026-08-01T00:00:00Z', body: 'BRIEF', milestone: null,
    labels: { nodes: [{ name: 'orch:goal' }] }, projectItems: pi('Done'), subIssues: { nodes: [] } },
] } } };
{
  const gh = fakeGh([[/subIssues/, () => GOALS]]);
  const r = run(['read', '--json'], gh);
  const j = JSON.parse(r.out);
  check('read exits 0', r.code === 0);
  check('goal G142 in milestone 49 folds running', j.goals[0].lane === 'G142' && j.goals[0].milestone.number === 49 && j.goals[0].status === 'running' && j.goals[0].brief.startsWith('BRIEF'));
  check('items carry bucket(Priority)/pipeline/outcome/gate/you', j.goals[0].items[0].bucket === 'Now' && j.goals[0].items[0].pipeline === 'Engine' && j.goals[0].items[0].outcome === 'canonical home' && j.goals[0].items[1].bucket === 'Next' && j.goals[0].items[1].gate === 'GATE LIVE' && j.goals[0].items[2].you === true);
  check('unset Priority → first bucket', j.goals[0].items[2].bucket === 'Now');
  check('closed goal folds merged, null milestone sorts last', j.goals[1].lane === 'G99' && j.goals[1].status === 'merged' && j.goals[1].milestone === null);
  check('--goal filters', JSON.parse(run(['read', '--json', '--goal', 'G99'], gh).out).goals.length === 1);
  check('buckets = Priority options in order', j.buckets.join() === 'Now,Next,Later');
  check('read makes exactly one graphql call', gh.calls.length === 1 && gh.calls[0].kind === 'graphql');
}
{
  const blocked = JSON.parse(JSON.stringify(GOALS));
  blocked.repository.issues.nodes[0].subIssues.nodes[1].labels.nodes.push({ name: 'orch:blocked' });
  const gh = fakeGh([[/subIssues/, () => blocked],
    [/GET repos\/o\/r\/issues\/151\/comments/, () => [{ body: 'blocked: needs setup · owner: you\n<!-- opId:abc -->' }]]]);
  const j = JSON.parse(run(['read', '--json'], gh).out);
  check('blocked fold pulls blocker text from latest blocked: comment', j.goals[0].status === 'blocked' && j.goals[0].blocker === 'blocked: needs setup · owner: you');
}
module.exports = { check, run, fakeGh, writeCfg, CFG, CWD, COMMON, SCRATCH, finish() { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); } };
if (require.main === module) module.exports.finish();
```

- [ ] **Step 2: Run test to verify it fails** — `node tests/test-board-gh.js` — Expected: `Cannot find module '../scripts/board-gh'`

- [ ] **Step 3: Write the implementation**

`scripts/board-gh.js`:
```javascript
#!/usr/bin/env node
// board-gh — GitHub Issues + Projects v2 ARE the orch board (spec §4).
// Milestone (operator's) → goal = Issue orch:goal → items = sub-issues.
// Verbs: init · milestones · add-goal · add-item · move · set-status ·
// set-blocker · clear-blocker · done · close-goal · read.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { makeGh } = require('./lib/gh');
const { foldStatus } = require('./lib/fold');
const { openJournal } = require('./lib/journal');
const { withLock } = require('./lib/lockfile');

const MARK = '<!-- orch-item -->';
const STATUS_OPTS = ['Todo', 'In progress', 'In review', 'Done'];

function parseArgs(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opt[k] = argv[++i]; else opt[k] = true; }
    else pos.push(a);
  }
  return { pos, opt };
}

function loadCfg(cwd) {
  const p = path.join(cwd, '.orch', 'board.json');
  if (!fs.existsSync(p)) return null;
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const k of ['owner', 'repo', 'projectId', 'fieldIds', 'optionIds']) if (c[k] == null) return null;
  if (!c.fieldIds.status || !c.fieldIds.priority || !c.optionIds.priority || !Object.keys(c.optionIds.priority).length) return null;
  c.buckets = Object.keys(c.optionIds.priority); // Priority options ARE the buckets, in field order
  return c;
}

function parseBody(body) {
  const lines = (body || '').split(/\r?\n/).filter(l => l.trim() !== MARK);
  const grab = re => { const m = lines.map(l => l.match(re)).find(Boolean); return m ? m[1].trim() : null; };
  return { text: (lines[0] || '').trim(), outcome: grab(/^outcome:\s*(.+)$/i), gate: grab(/^gate:\s*(.+)$/i) };
}
function bodyOf(text, { outcome, gate } = {}) {
  return [text, '', outcome ? `outcome: ${outcome}` : null, gate ? `gate: ${gate}` : null, MARK].filter(x => x !== null).join('\n');
}

const PI = `projectItems(first:10){ nodes{ project{ id } fieldValues(first:20){ nodes{ ... on ProjectV2ItemFieldSingleSelectValue { name field{ ... on ProjectV2FieldCommon { name } } } } } } }`;
const READ_QUERY = `query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){
  issues(first:100,states:[OPEN,CLOSED],labels:["orch:goal"],orderBy:{field:CREATED_AT,direction:ASC}){ nodes{
    number title body state updatedAt milestone{ number title } labels(first:30){ nodes{ name } } ${PI}
    subIssues(first:50){ nodes{ number title body state updatedAt labels(first:30){ nodes{ name } } assignees(first:5){ nodes{ login } } ${PI} } } } } } }`;

function fieldOf(node, cfg, name) {
  const pi = node.projectItems.nodes.find(p => p.project.id === cfg.projectId);
  const v = pi && pi.fieldValues.nodes.find(x => x.field && x.field.name === name);
  return v ? v.name : null;
}
function latestComment(gh, cfg, number, prefix) {
  const cs = gh.rest('GET', `repos/${cfg.owner}/${cfg.repo}/issues/${number}/comments?per_page=100`) || [];
  for (let i = cs.length - 1; i >= 0; i--) { const first = (cs[i].body || '').split(/\r?\n/)[0].trim(); if (first.startsWith(prefix)) return first; }
  return null;
}

function readBoard(gh, cfg) {
  const d = gh.graphql(READ_QUERY, { owner: cfg.owner, repo: cfg.repo });
  const goals = d.repository.issues.nodes.map(g => {
    const items = g.subIssues.nodes.map(i => {
      const labels = i.labels.nodes.map(l => l.name);
      const b = parseBody(i.body);
      const status = fieldOf(i, cfg, 'Status');
      return { issue: i.number, labels, status, pipeline: fieldOf(i, cfg, 'Pipeline'), feature: fieldOf(i, cfg, 'Feature'),
        bucket: fieldOf(i, cfg, 'Priority') || cfg.buckets[0],
        text: b.text || i.title, outcome: b.outcome, gate: b.gate,
        done: i.state === 'CLOSED' || status === 'Done', you: labels.includes('orch:you'), updated: i.updatedAt };
    });
    const forFold = items.map(i => ({ labels: i.labels, status: i.status,
      blockerComment: i.labels.includes('orch:blocked') ? latestComment(gh, cfg, i.issue, 'blocked:') : null }));
    const { status, blocker } = foldStatus({ state: g.state.toLowerCase(), labels: g.labels.nodes.map(l => l.name) }, forFold);
    return { lane: `G${g.number}`, issue: g.number, name: g.title, milestone: g.milestone ? { number: g.milestone.number, title: g.milestone.title } : null,
      status, blocker, brief: g.body || '', updated: g.updatedAt, items: items.map(({ labels, ...rest }) => rest) };
  }).sort((a, b) => ((a.milestone ? a.milestone.number : Infinity) - (b.milestone ? b.milestone.number : Infinity)) || (a.issue - b.issue));
  return { goals, buckets: cfg.buckets };
}

function listMilestones(gh, cfg) {
  const ms = gh.rest('GET', `repos/${cfg.owner}/${cfg.repo}/milestones?state=open&per_page=100`) || [];
  const rank = t => { const m = /^C(\d+)\b/.exec(t); return m ? Number(m[1]) : t === 'backlog' ? 1e6 : 1e7; };
  return ms.map(m => ({ number: m.number, title: m.title, open: m.open_issues, closed: m.closed_issues, r: rank(m.title) }))
    .sort((a, b) => a.r - b.r || a.number - b.number).map(({ r, ...m }) => m);
}

function main(argv, deps = {}) {
  const cwd = deps.cwd || process.cwd();
  const stdout = deps.stdout || (s => process.stdout.write(s));
  const gh = deps.gh || makeGh();
  const { pos, opt } = parseArgs(argv);
  const verb = pos[0];
  if (!verb) { stdout('usage: board-gh <init|milestones|add-goal|add-item|move|set-status|set-blocker|clear-blocker|done|close-goal|read> …\n'); return 1; }
  if (verb === 'init') return require('./board-gh-init').init({ pos, opt, cwd, gh, stdout });
  const cfg = loadCfg(cwd);
  if (!cfg) { stdout('board-gh: no usable .orch/board.json — run `/orch:board init` first.\n'); return 1; }
  if (verb === 'milestones') { stdout(JSON.stringify(listMilestones(gh, cfg), null, 2) + '\n'); return 0; }
  if (verb === 'read') {
    const b = readBoard(gh, cfg);
    if (opt.goal) b.goals = b.goals.filter(g => g.lane === String(opt.goal).toUpperCase());
    stdout(JSON.stringify(b, null, opt.json ? 0 : 2) + '\n');
    return 0;
  }
  const commonDir = deps.commonDir || require('../hooks/lib/config').resolveRepoKey(cwd);
  if (!commonDir) { stdout('board-gh: not inside a git repository.\n'); return 1; }
  return require('./board-gh-write').write({ verb, pos: pos.slice(1), opt, cfg, gh, stdout, cwd, commonDir, lockCfg: deps.lockCfg,
    readBoard, bodyOf, MARK, STATUS_OPTS, openJournal, withLock, crypto });
}

module.exports = { main, parseBody, bodyOf, readBoard, listMilestones, loadCfg, MARK, STATUS_OPTS };
if (require.main === module) process.exit(main(process.argv.slice(2)));
```
Stubs: `scripts/board-gh-init.js` → `'use strict'; module.exports = { init() { throw new Error('init: not implemented yet'); } };` and `scripts/board-gh-write.js` → `'use strict'; module.exports = { write() { throw new Error('write verbs: not implemented yet'); } };`.

- [ ] **Step 4: Run test** — `node tests/test-board-gh.js` — Expected: `11 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add scripts/board-gh.js scripts/board-gh-init.js scripts/board-gh-write.js tests/test-board-gh.js
git commit -m "feat(board-gh): config, milestones, read with goal-status fold (spec §4.1/§4.3)"
```

---

### Task 6: `init` verb — adopt or create the Project; read fields; labels; write config

**Files:**
- Modify: `scripts/board-gh-init.js` (replace stub)
- Test: `tests/test-board-gh-init.js`

**Interfaces:**
- Consumes: `gh.graphql`, `gh.rest`, `.claude/orch.json` `contract.domains` keys (Pipeline options, only when creating the field), `opt.project`, `opt.owner`, `opt['dry-run']`, `git remote get-url origin` for `{owner, repo}`.
- Produces: `init({ pos, opt, cwd, gh, stdout }) → exit code`; writes `.orch/board.json` (Task 5 shape). `--dry-run` prints `DRY <what>` lines and writes nothing. Never creates milestones. Rules:
  - `--project N` → the Project with that number under `projectOwner` must exist, else exit 1 `init: no project #N under <owner>`. Without it: find-or-create `<repo> · orch board`.
  - `Status`: ensure the four canonical options exist (add missing; keep existing, case-insensitive match).
  - `Priority`: single-select; absent → create with `Now, Next, Later`; present → read options as-is (never rename, never add). Zero options → exit 1 `init: Priority field has no options`.
  - `Pipeline`: absent → create with contract domain names (or `general`); present → read as-is.
  - `Feature`: read if present (`fieldIds.feature` may be `null`).
  - Labels: create the five `orch:*` labels if missing.
- GraphQL:
  - owner: `query($o:String!){ repositoryOwner(login:$o){ id __typename ... on ProjectV2Owner { projectsV2(first:100){ nodes{ id number title } } } } }`
  - create project: `mutation($o:ID!,$t:String!){ createProjectV2(input:{ownerId:$o,title:$t}){ projectV2{ id number } } }`
  - fields: `query($p:ID!){ node(id:$p){ ... on ProjectV2 { fields(first:50){ nodes{ ... on ProjectV2FieldCommon { id name } ... on ProjectV2SingleSelectField { id name options{ id name } } } } } } }`
  - add options: `mutation($f:ID!,$opts:[ProjectV2SingleSelectFieldOptionInput!]!){ updateProjectV2Field(input:{fieldId:$f,singleSelectOptions:$opts}){ projectV2Field{ ... on ProjectV2SingleSelectField { id options{ id name } } } } }` — pass existing **plus** missing (`{name, color:"GRAY", description:""}`).
  - create single-select: `mutation($p:ID!,$name:String!,$opts:[ProjectV2SingleSelectFieldOptionInput!]!){ createProjectV2Field(input:{projectId:$p,dataType:SINGLE_SELECT,name:$name,singleSelectOptions:$opts}){ projectV2Field{ ... on ProjectV2SingleSelectField { id name options{ id name } } } } }`
- REST: `GET repos/{o}/{r}/labels?per_page=100`, `POST repos/{o}/{r}/labels {name,color}`.

- [ ] **Step 1: Write the failing test**

`tests/test-board-gh-init.js`:
```javascript
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { main } = require('../scripts/board-gh');
const SCRATCH = path.join(__dirname, 'scratch-board-init');
fs.rmSync(SCRATCH, { recursive: true, force: true });
const CWD = path.join(SCRATCH, 'repo');
fs.mkdirSync(path.join(CWD, '.claude'), { recursive: true });
execFileSync('git', ['-C', CWD, 'init', '-q']);
execFileSync('git', ['-C', CWD, 'remote', 'add', 'origin', 'https://github.com/istart-dev/orch.git']);
fs.writeFileSync(path.join(CWD, '.claude', 'orch.json'), JSON.stringify({ contract: { domains: { numerics: { paths: [], decide: 'ai', ship: 'commit' }, hmi: { paths: [], decide: 'human', ship: 'none' } } } }));
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
function fakeGh(state) {
  const calls = [];
  return { calls,
    graphql(q, v) {
      calls.push({ q, v });
      if (/repositoryOwner/.test(q)) return { repositoryOwner: { id: 'OWN', __typename: 'Organization', projectsV2: { nodes: state.projects } } };
      if (/createProjectV2\(/.test(q)) { const p = { id: 'PVT_new', number: 9, title: v.t }; state.projects.push(p); return { createProjectV2: { projectV2: p } }; }
      if (/fields\(first/.test(q)) return { node: { fields: { nodes: state.fields } } };
      if (/updateProjectV2Field/.test(q)) { const f = state.fields.find(x => x.id === v.f); f.options = v.opts.map((o, i) => ({ id: f.id + i, name: o.name })); return { updateProjectV2Field: { projectV2Field: f } }; }
      if (/createProjectV2Field/.test(q)) { const f = { id: 'F_' + v.name[0], name: v.name, options: v.opts.map((o, i) => ({ id: v.name[0].toLowerCase() + i, name: o.name })) }; state.fields.push(f); return { createProjectV2Field: { projectV2Field: f } }; }
      throw new Error('unhandled ' + q.slice(0, 50));
    },
    rest(m, p, b) {
      calls.push({ m, p, b });
      if (m === 'GET' && /labels/.test(p)) return state.labels.map(nm => ({ name: nm }));
      if (m === 'POST' && /labels/.test(p)) { state.labels.push(b.name); return { name: b.name }; }
      throw new Error('unhandled ' + m + ' ' + p);
    } };
}
function run(argv, gh) { let out = ''; const code = main(argv, { gh, cwd: CWD, commonDir: path.join(CWD, '.git'), stdout: s => { out += s; } }); return { code, out }; }
const CFGP = path.join(CWD, '.orch', 'board.json');
const ALL_LABELS = ['orch:goal', 'orch:item', 'orch:you', 'orch:blocked', 'orch:needs_attention'];
const STATUS4 = () => ['Todo', 'In progress', 'In review', 'Done'].map((nm, i) => ({ id: 's' + i, name: nm }));
const noMut = gh => !gh.calls.some(c => /create|update/.test(c.q || '') || c.m === 'POST');

// Fresh repo, nothing exists → create project, Priority, Pipeline, labels.
{
  const st = { projects: [], fields: [{ id: 'F_S', name: 'Status', options: [{ id: 'a', name: 'Todo' }, { id: 'b', name: 'In Progress' }, { id: 'c', name: 'Done' }] }], labels: [] };
  const gh = fakeGh(st);
  const r = run(['init'], gh);
  check('init exits 0', r.code === 0);
  const cfg = JSON.parse(fs.readFileSync(CFGP, 'utf8'));
  check('project created and recorded', cfg.projectId === 'PVT_new' && cfg.projectNumber === 9 && cfg.owner === 'istart-dev' && cfg.repo === 'orch');
  check('Status gained In review, kept existing', st.fields[0].options.map(o => o.name).join() === 'Todo,In Progress,Done,In review');
  check('Priority created with Now/Next/Later when absent', st.fields.some(f => f.name === 'Priority' && f.options.map(o => o.name).join() === 'Now,Next,Later'));
  check('Pipeline created from contract domains when absent', st.fields.some(f => f.name === 'Pipeline' && f.options.map(o => o.name).join() === 'numerics,hmi'));
  check('optionIds recorded: canonical status names, priority, pipeline; feature null', cfg.optionIds.status['In review'] === 'F_S3' && cfg.optionIds.status['In progress'] === 'F_S1' && cfg.optionIds.priority.Now && cfg.optionIds.pipeline.numerics && cfg.fieldIds.feature === null);
  check('orch labels created (five, no bucket labels)', ALL_LABELS.every(l => st.labels.includes(l)) && !st.labels.some(l => l.startsWith('orch:bucket')));
  check('no milestone call ever', !gh.calls.some(c => /milestones/.test(c.p || '')));
}
// Adopt Pertasim-shaped project: everything present, P0/P1/P2 renamed by the operator already.
{
  const st = { projects: [{ id: 'PVT_pert', number: 1, title: 'Pertasim' }],
    fields: [{ id: 'F_S', name: 'Status', options: STATUS4() },
      { id: 'F_R', name: 'Priority', options: [{ id: 'r0', name: 'Now' }, { id: 'r1', name: 'Next' }, { id: 'r2', name: 'Later' }] },
      { id: 'F_P', name: 'Pipeline', options: [{ id: 'p0', name: 'Authoring' }, { id: 'p1', name: 'Engine' }] },
      { id: 'F_F', name: 'Feature', options: [{ id: 'f0', name: 'E· Numerics core' }] }],
    labels: ALL_LABELS.slice() };
  const gh = fakeGh(st);
  const r = run(['init', '--project', '1'], gh);
  check('adopt --project 1 exits 0', r.code === 0);
  const cfg = JSON.parse(fs.readFileSync(CFGP, 'utf8'));
  check('adopted project recorded, no creation', cfg.projectId === 'PVT_pert' && cfg.projectNumber === 1 && noMut(gh));
  check('Priority options read as-is (buckets Now,Next,Later)', Object.keys(cfg.optionIds.priority).join() === 'Now,Next,Later' && cfg.fieldIds.priority === 'F_R');
  check('Pipeline NOT modified from contract domains', st.fields[2].options.map(o => o.name).join() === 'Authoring,Engine' && cfg.optionIds.pipeline.Engine === 'p1');
  check('Feature recorded', cfg.fieldIds.feature === 'F_F' && cfg.optionIds.feature['E· Numerics core'] === 'f0');
  check('idempotent second run issues no mutations', run(['init', '--project', '1'], gh).code === 0 && noMut(gh));
}
// Adopt with un-renamed P0/P1/P2 → still works, buckets are whatever the options are.
{
  const st = { projects: [{ id: 'PVT_pert', number: 1, title: 'Pertasim' }],
    fields: [{ id: 'F_S', name: 'Status', options: STATUS4() }, { id: 'F_R', name: 'Priority', options: [{ id: 'r0', name: 'P0' }, { id: 'r1', name: 'P1' }, { id: 'r2', name: 'P2' }] }], labels: ALL_LABELS.slice() };
  const gh = fakeGh(st);
  run(['init', '--project', '1'], gh);
  check('un-renamed Priority is used verbatim, never renamed', Object.keys(JSON.parse(fs.readFileSync(CFGP, 'utf8')).optionIds.priority).join() === 'P0,P1,P2' && noMut(gh));
}
// --project that doesn't exist → refuse.
{
  const st = { projects: [], fields: [], labels: [] };
  const r = run(['init', '--project', '77'], fakeGh(st));
  check('unknown --project refuses', r.code === 1 && /no project #77/.test(r.out));
}
// Dry run writes nothing.
{
  fs.rmSync(CFGP, { force: true });
  const st = { projects: [], fields: [{ id: 'F_S', name: 'Status', options: [] }], labels: [] };
  const gh = fakeGh(st);
  const r = run(['init', '--dry-run'], gh);
  check('dry-run prints DRY lines', /DRY create project/.test(r.out) && /DRY create Priority/.test(r.out));
  check('dry-run writes no config and no mutations', !fs.existsSync(CFGP) && noMut(gh));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails** — `node tests/test-board-gh-init.js` — Expected: throws `init: not implemented yet`

- [ ] **Step 3: Write the implementation**

`scripts/board-gh-init.js`:
```javascript
// board-gh init — adopt (--project N) or find-or-create the repo's
// Project; ensure Status options; read Priority (buckets) / Pipeline /
// Feature as they are, creating Priority/Pipeline only when absent;
// create orch:* labels; write .orch/board.json. Idempotent. --dry-run
// prints and writes nothing. Milestones are the operator's — never
// created. Priority options are never renamed here (operator's UI step).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const STATUS_OPTS = ['Todo', 'In progress', 'In review', 'Done'];
const DEFAULT_BUCKETS = ['Now', 'Next', 'Later'];
const LABELS = { 'orch:goal': '5319e7', 'orch:item': '0e8a16', 'orch:you': 'fbca04', 'orch:blocked': 'd93f0b', 'orch:needs_attention': 'e99695' };
const optInput = names => names.map(name => ({ name, color: 'GRAY', description: '' }));
const Q = {
  owner: 'query($o:String!){ repositoryOwner(login:$o){ id __typename ... on ProjectV2Owner { projectsV2(first:100){ nodes{ id number title } } } } }',
  createProject: 'mutation($o:ID!,$t:String!){ createProjectV2(input:{ownerId:$o,title:$t}){ projectV2{ id number } } }',
  fields: 'query($p:ID!){ node(id:$p){ ... on ProjectV2 { fields(first:50){ nodes{ ... on ProjectV2FieldCommon { id name } ... on ProjectV2SingleSelectField { id name options{ id name } } } } } } }',
  updateField: 'mutation($f:ID!,$opts:[ProjectV2SingleSelectFieldOptionInput!]!){ updateProjectV2Field(input:{fieldId:$f,singleSelectOptions:$opts}){ projectV2Field{ ... on ProjectV2SingleSelectField { id options{ id name } } } } }',
  createSelect: 'mutation($p:ID!,$name:String!,$opts:[ProjectV2SingleSelectFieldOptionInput!]!){ createProjectV2Field(input:{projectId:$p,dataType:SINGLE_SELECT,name:$name,singleSelectOptions:$opts}){ projectV2Field{ ... on ProjectV2SingleSelectField { id name options{ id name } } } } }',
};

function remoteRepo(cwd) {
  const url = execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const m = url.match(/[:/]([^/:]+)\/([^/]+?)(\.git)?\/?$/);
  if (!m) throw new Error(`cannot parse origin url: ${url}`);
  return { owner: m[1], repo: m[2] };
}
function domains(cwd) {
  try { const c = JSON.parse(fs.readFileSync(path.join(cwd, '.claude', 'orch.json'), 'utf8')); return Object.keys((c.contract && c.contract.domains) || {}); }
  catch { return []; }
}
function ensureOptions(gh, field, wanted, say, dry, label) {
  const have = field.options.map(x => x.name.toLowerCase());
  const missing = wanted.filter(s => !have.includes(s.toLowerCase()));
  if (!missing.length) return field;
  say(`DRY add ${label} options: ${missing.join(', ')}`);
  if (dry) return field;
  return gh.graphql(Q.updateField, { f: field.id, opts: optInput([...field.options.map(x => x.name), ...missing]) }).updateProjectV2Field.projectV2Field;
}
function createSelect(gh, project, name, opts, say, dry) {
  say(`DRY create ${name} field: ${opts.join(', ')}`);
  return dry ? { id: 'DRY', options: [] } : gh.graphql(Q.createSelect, { p: project.id, name, opts: optInput(opts) }).createProjectV2Field.projectV2Field;
}

function init({ opt, cwd, gh, stdout }) {
  const dry = !!opt['dry-run'];
  const say = s => stdout(s + '\n');
  const { owner: repoOwner, repo } = remoteRepo(cwd);
  const owner = typeof opt.owner === 'string' ? opt.owner : repoOwner;
  const title = `${repo} · orch board`;

  const o = gh.graphql(Q.owner, { o: owner }).repositoryOwner;
  let project;
  if (opt.project !== undefined) {
    project = o.projectsV2.nodes.find(p => p.number === Number(opt.project));
    if (!project) { say(`init: no project #${opt.project} under ${owner}`); return 1; }
  } else {
    project = o.projectsV2.nodes.find(p => p.title === title);
    if (!project) {
      say(`DRY create project "${title}" under ${owner}`);
      project = dry ? { id: 'DRY', number: 0 } : gh.graphql(Q.createProject, { o: o.id, t: title }).createProjectV2.projectV2;
    }
  }
  const fields = project.id === 'DRY' ? [] : gh.graphql(Q.fields, { p: project.id }).node.fields.nodes;
  const byName = n => fields.find(f => f.name === n);

  const status = ensureOptions(gh, byName('Status') || { id: 'DRY', options: [] }, STATUS_OPTS, say, dry, 'Status');
  // Priority IS the bucket axis. Present → read verbatim (operator renames
  // P0/P1/P2 → Now/Next/Later in the UI). Absent → create Now/Next/Later.
  const priority = byName('Priority') || createSelect(gh, project, 'Priority', DEFAULT_BUCKETS, say, dry);
  if (!dry && !priority.options.length) { say('init: Priority field has no options — add at least one in the Project settings.'); return 1; }
  const doms = domains(cwd);
  const pipeline = byName('Pipeline') || createSelect(gh, project, 'Pipeline', doms.length ? doms : ['general'], say, dry);
  const feature = byName('Feature') || null;

  const existing = new Set((gh.rest('GET', `repos/${repoOwner}/${repo}/labels?per_page=100`) || []).map(l => l.name));
  for (const [name, color] of Object.entries(LABELS)) {
    if (existing.has(name)) continue;
    say(`DRY create label ${name}`);
    if (!dry) gh.rest('POST', `repos/${repoOwner}/${repo}/labels`, { name, color });
  }
  if (dry) { say('DRY — nothing written.'); return 0; }

  const toMap = f => Object.fromEntries((f.options || []).map(x => [x.name, x.id]));
  const raw = toMap(status), optStatus = {};
  for (const s of STATUS_OPTS) { const k = Object.keys(raw).find(x => x.toLowerCase() === s.toLowerCase()); optStatus[s] = raw[k]; }
  const cfg = { owner: repoOwner, repo, projectOwner: owner, ownerType: o.__typename, projectNumber: project.number, projectId: project.id,
    fieldIds: { status: status.id, priority: priority.id, pipeline: pipeline.id, feature: feature ? feature.id : null },
    optionIds: { status: optStatus, priority: toMap(priority), pipeline: toMap(pipeline), feature: feature ? toMap(feature) : {} } };
  fs.mkdirSync(path.join(cwd, '.orch'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.orch', 'board.json'), JSON.stringify(cfg, null, 2) + '\n');
  say(`board-gh: wrote .orch/board.json (project #${project.number} under ${owner}; buckets = ${Object.keys(cfg.optionIds.priority).join(' → ')}) — commit it.`);
  return 0;
}

module.exports = { init, STATUS_OPTS, DEFAULT_BUCKETS };
```

- [ ] **Step 4: Run test** — `node tests/test-board-gh-init.js` — Expected: `18 passed, 0 failed`

- [ ] **Step 5: Live smoke (manual, once):** in a clone of `istart-dev/i-Start`, after the operator has renamed Priority `P0/P1/P2 → Now/Next/Later` in the Pertasim settings UI: `init --project 1 --dry-run` must print only the five label creations (or nothing), then `init --project 1`; open `.orch/board.json` and confirm `optionIds.priority` reads `Now/Next/Later`. No project is created.

- [ ] **Step 6: Commit**

```bash
git add scripts/board-gh-init.js tests/test-board-gh-init.js
git commit -m "feat(board-gh): init adopts/creates the Project; Priority = buckets; Pipeline/Feature read-through (spec §4.2)"
```

---

### Task 7: Write verbs — lock + journal + sub-effects + resume

**Files:**
- Modify: `scripts/board-gh-write.js` (replace stub)
- Test: append to `tests/test-board-gh.js`

**Interfaces:**
- Consumes: ctx from `main` (Task 5): `{ verb, pos, opt, cfg, gh, stdout, cwd, commonDir, lockCfg, readBoard, bodyOf, MARK, STATUS_OPTS, openJournal, withLock, crypto }`
- Produces: `write(ctx) → exit code`. Verb grammar:
  - `add-goal <milestone#|backlog|none> "<name>" --brief <file>` → prints `G<issue#>`. `backlog` resolves to the open milestone titled `backlog` (error if absent); `none` = no milestone.
  - `add-item G<n> "<text>" [--you] [--bucket <Priority option>] [--pipeline <Pipeline option>] [--feature <Feature option>] [--outcome "…"] [--gate "LABEL"]` → prints issue number. `--bucket` defaults to `cfg.buckets[0]`; unknown option → error listing the valid ones. `--you` → labels `orch:item,orch:you`, assignee = `GET user`.login.
  - `move <issue#> <Priority option>` → sets Priority only (no comment).
  - `set-status <issue#> <Todo|In progress|In review|Done>` · `set-blocker <issue#> "<text>" --owner <who>` · `clear-blocker <issue#>` · `done <issue#>`
  - `close-goal G<n> --evidence "<ledger line or artifact path>"`
- Authority: if `lockCfg.__repoLocked && !(lockCfg.board && lockCfg.board.github === true)` → print `board-gh: this repo is locked and board.github is not enabled in ~/.claude/orch-lock.json — /orch:setup enables it.` and return 1. `lockCfg` defaults to `require('../hooks/lib/config').loadConfig({ cwd })`.
- Journal `<commonDir>/orch/board-journal.jsonl`; lock `<commonDir>/orch/board.lock`; `opId = crypto.randomUUID()`; comments end with `\n<!-- opId:<opId> -->`.
- Sub-effects: `createGoal | createIssue | addSubIssue | addToProject | setField | comment | addLabel | removeLabel | closeIssue`.
- GitHub calls:
  - sub-issue link: `POST repos/{o}/{r}/issues/{parent#}/sub_issues { sub_issue_id: <child database id> }`
  - parent probe: `query($o:String!,$r:String!,$n:Int!){ repository(owner:$o,name:$r){ issue(number:$n){ id databaseId state parent{ number } projectItems(first:10){ nodes{ id project{ id } } } } } }`
  - add to project: `mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item{ id } } }`
  - set field: `mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){ updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){ projectV2Item{ id } } }`

- [ ] **Step 1: Write the failing tests (append to `tests/test-board-gh.js` before `module.exports`)**

```javascript
// --- write verbs -----------------------------------------------------------------
const JOURNAL = path.join(COMMON, 'orch', 'board-journal.jsonl');
const BRIEF = path.join(SCRATCH, 'brief.md');
fs.writeFileSync(BRIEF, 'BRIEF\ngoal: learn from ships\nmetric: lessons/ship\ndone: gate live\ndomains: numerics\nkill: 3 sessions\n');
function ghStore() {
  const st = { milestones: [{ number: 49, title: 'C1 SHU-HDS operable', state: 'open', open_issues: 0, closed_issues: 0 }, { number: 52, title: 'backlog', state: 'open', open_issues: 0, closed_issues: 0 }],
    issues: {}, comments: {}, items: {}, fields: {}, parent: {}, next: 140, fail: null };
  const FIELD = { F_S: ['status', 'Status'], F_R: ['priority', 'Priority'], F_P: ['pipeline', 'Pipeline'], F_F: ['feature', 'Feature'] };
  const optName = (fid, oid) => Object.entries(CFG.optionIds[FIELD[fid][0]]).find(([, id]) => id === oid)[0];
  const fv = i => st.items[i.node_id] ? [{ project: { id: 'PVT_1' }, fieldValues: { nodes: Object.entries(st.fields).filter(([k]) => k.startsWith(st.items[i.node_id] + ':')).map(([k, o]) => { const fid = k.split(':')[1]; return { name: optName(fid, o), field: { name: FIELD[fid][1] } }; }) } }] : [];
  const node = i => ({ number: i.number, title: i.title, body: i.body, state: i.state.toUpperCase(), updatedAt: 'now', milestone: i.milestone ? st.milestones.find(m => m.number === i.milestone) : null,
    labels: { nodes: i.labels }, assignees: { nodes: (i.assignees || []).map(login => ({ login })) }, projectItems: { nodes: fv(i) } });
  const handlers = [
    [/GET repos\/o\/r\/milestones/, () => st.milestones],
    [/GET user$/, () => ({ login: 'me' })],
    [/POST repos\/o\/r\/issues$/, b => { const n = st.next++; st.issues[n] = { number: n, id: 1000 + n, node_id: 'I_' + n, state: 'open', ...b, labels: (b.labels || []).map(x => ({ name: x })) }; return st.issues[n]; }],
    [/GET repos\/o\/r\/issues\/(\d+)\/comments/, (b, k) => st.comments[k.match(/issues\/(\d+)/)[1]] || []],
    [/POST repos\/o\/r\/issues\/(\d+)\/comments/, (b, k) => { const n = k.match(/issues\/(\d+)/)[1]; (st.comments[n] = st.comments[n] || []).push({ body: b.body }); return { id: 1 }; }],
    [/POST repos\/o\/r\/issues\/(\d+)\/sub_issues/, (b, k) => { const p = Number(k.match(/issues\/(\d+)/)[1]); const child = Object.values(st.issues).find(i => i.id === b.sub_issue_id); st.parent[child.number] = p; return {}; }],
    [/POST repos\/o\/r\/issues\/(\d+)\/labels/, (b, k) => { const i = st.issues[k.match(/issues\/(\d+)/)[1]]; for (const l of b.labels) if (!i.labels.some(x => x.name === l)) i.labels.push({ name: l }); return i.labels; }],
    [/DELETE repos\/o\/r\/issues\/(\d+)\/labels\/(.+)/, (b, k) => { const m = k.match(/issues\/(\d+)\/labels\/(.+)$/); const i = st.issues[m[1]]; i.labels = i.labels.filter(x => x.name !== decodeURIComponent(m[2])); return null; }],
    [/GET repos\/o\/r\/issues\/(\d+)$/, (b, k) => st.issues[k.match(/issues\/(\d+)/)[1]]],
    [/PATCH repos\/o\/r\/issues\/(\d+)/, (b, k) => { const i = st.issues[k.match(/issues\/(\d+)/)[1]]; Object.assign(i, b); return i; }],
    [/issue\(number/, v => { const i = st.issues[v.n]; return { repository: { issue: { id: i.node_id, databaseId: i.id, state: i.state.toUpperCase(), parent: st.parent[i.number] ? { number: st.parent[i.number] } : null, projectItems: { nodes: st.items[i.node_id] ? [{ id: st.items[i.node_id], project: { id: 'PVT_1' } }] : [] } } } }; }],
    [/addProjectV2ItemById/, v => { st.items[v.c] = 'PI_' + v.c; return { addProjectV2ItemById: { item: { id: st.items[v.c] } } }; }],
    [/updateProjectV2ItemFieldValue/, v => { st.fields[v.i + ':' + v.f] = v.o; return { updateProjectV2ItemFieldValue: { projectV2Item: { id: v.i } } }; }],
    [/subIssues/, () => ({ repository: { issues: { nodes: Object.values(st.issues).filter(i => i.labels.some(l => l.name === 'orch:goal')).map(g => ({ ...node(g),
      subIssues: { nodes: Object.values(st.issues).filter(c => st.parent[c.number] === g.number).map(node) } })) } } })],
  ];
  const gh = fakeGh(handlers);
  const g = gh.graphql, r = gh.rest;
  gh.graphql = (q, v) => { if (st.fail && st.fail(q)) throw new Error('simulated outage'); return g(q, v); };
  gh.rest = (m, p, b) => { if (st.fail && st.fail(m + ' ' + p)) throw new Error('simulated outage'); return r(m, p, b); };
  return { st, gh };
}
fs.rmSync(JOURNAL, { force: true });
writeCfg(CFG);
{
  const { st, gh } = ghStore();
  let r = run(['add-goal', '49', 'knowledge-gate', '--brief', BRIEF], gh);
  check('add-goal creates orch:goal issue in milestone, BRIEF body, prints G<n>', r.code === 0 && r.out.trim() === 'G140' && st.issues[140].milestone === 49 && st.issues[140].body.startsWith('BRIEF') && st.issues[140].labels.some(l => l.name === 'orch:goal'));
  check('goal on project with Status Todo', st.items['I_140'] && st.fields['PI_I_140:F_S'] === 's1');
  r = run(['add-goal', 'backlog', 'someday', '--brief', BRIEF], gh);
  check('backlog resolves to the backlog milestone', st.issues[141].milestone === 52);
  r = run(['add-goal', 'nope', 'x', '--brief', BRIEF], gh);
  check('unknown milestone refused', r.code === 1 && /milestone/.test(r.out));
  r = run(['add-item', 'G140', 'write grammar', '--pipeline', 'Engine', '--outcome', 'canonical home'], gh);
  const n1 = Number(r.out.trim());
  check('add-item: sub-issue of goal, same milestone, marker + orch:item', r.code === 0 && st.parent[n1] === 140 && st.issues[n1].milestone === 49 && /<!-- orch-item -->$/.test(st.issues[n1].body) && st.issues[n1].labels.some(l => l.name === 'orch:item'));
  check('add-item on project: Status Todo, Priority = first bucket (Now), Pipeline set', st.fields['PI_I_' + n1 + ':F_S'] === 's1' && st.fields['PI_I_' + n1 + ':F_R'] === 'r1' && st.fields['PI_I_' + n1 + ':F_P'] === 'p1');
  r = run(['add-item', 'G140', 'grammar tests', '--bucket', 'Next', '--gate', 'GATE LIVE'], gh);
  const n2 = Number(r.out.trim());
  check('--bucket Next → Priority option r2; --gate in body', st.fields['PI_I_' + n2 + ':F_R'] === 'r2' && /\ngate: GATE LIVE\n/.test(st.issues[n2].body) && !st.issues[n2].labels.some(l => l.name.startsWith('orch:bucket')));
  r = run(['add-item', 'G140', 'x', '--bucket', 'Someday'], gh);
  check('unknown bucket refused, lists valid options', r.code === 1 && /Now, Next, Later/.test(r.out));
  r = run(['move', String(n2), 'Later'], gh);
  check('move sets Priority only', r.code === 0 && st.fields['PI_I_' + n2 + ':F_R'] === 'r3' && !st.comments[n2]);
  run(['move', String(n2), 'Next'], gh);
  r = run(['add-item', 'G140', 'run /orch:setup', '--you'], gh);
  const ny = Number(r.out.trim());
  check('--you: orch:you + assignee, still a sub-issue', st.issues[ny].labels.some(l => l.name === 'orch:you') && st.issues[ny].assignees[0] === 'me' && st.parent[ny] === 140);
  r = run(['set-status', String(n1), 'In progress'], gh);
  check('set-status sets field and comments with opId', st.fields['PI_I_' + n1 + ':F_S'] === 's2' && /<!-- opId:/.test(st.comments[n1][0].body));
  r = run(['set-blocker', String(n2), 'needs setup', '--owner', 'you'], gh);
  check('set-blocker adds label + blocked: comment', st.issues[n2].labels.some(l => l.name === 'orch:blocked') && st.comments[n2][0].body.startsWith('blocked: needs setup · owner: you'));
  let b = JSON.parse(run(['read', '--json'], gh).out);
  check('read folds G140 blocked with blocker text', b.goals[0].lane === 'G140' && b.goals[0].status === 'blocked' && b.goals[0].blocker === 'blocked: needs setup · owner: you');
  check('read reports buckets from Priority and the gate item', b.goals[0].items.find(i => i.issue === n1).bucket === 'Now' && b.goals[0].items.find(i => i.issue === n2).bucket === 'Next' && b.goals[0].items.find(i => i.issue === n2).gate === 'GATE LIVE');
  r = run(['clear-blocker', String(n2)], gh);
  check('clear-blocker removes label, comments unblocked', !st.issues[n2].labels.some(l => l.name === 'orch:blocked') && st.comments[n2][1].body.startsWith('unblocked'));
  r = run(['done', String(n1)], gh);
  check('done → Status Done + closed', st.fields['PI_I_' + n1 + ':F_S'] === 's4' && st.issues[n1].state === 'closed');
  r = run(['close-goal', 'G140', '--evidence', 'iter 3 · G140 · 10 → 2'], gh);
  check('close-goal refuses while items are open', r.code === 1 && /open item/.test(r.out) && st.issues[140].state === 'open');
  run(['done', String(n2)], gh); run(['done', String(ny)], gh);
  r = run(['close-goal', 'G140'], gh);
  check('close-goal refuses without --evidence', r.code === 1 && /evidence/.test(r.out));
  r = run(['close-goal', 'G140', '--evidence', 'iter 3 · G140 · 10 → 2'], gh);
  check('close-goal: evidence comment on goal, Status Done, closed', r.code === 0 && st.comments[140].some(c => /^evidence: iter 3 · G140/.test(c.body)) && st.fields['PI_I_140:F_S'] === 's4' && st.issues[140].state === 'closed');
  b = JSON.parse(run(['read', '--json'], gh).out);
  check('read folds merged', b.goals[0].status === 'merged');
  check('journal has no pending after clean run', require('../scripts/lib/journal').openJournal(JOURNAL).pending().length === 0);
}
// --- outage: intent stays pending, step fails, next verb resumes -------------------
{
  const { st, gh } = ghStore();
  run(['add-goal', '49', 'g', '--brief', BRIEF], gh);
  st.fail = s => /POST repos\/o\/r\/issues$/.test(s);
  const r = run(['add-item', 'G140', 'flaky item'], gh);
  check('outage → non-zero exit, item not created', r.code === 1 && Object.keys(st.issues).length === 1);
  const pend = require('../scripts/lib/journal').openJournal(JOURNAL).pending();
  check('createIssue intent left pending', pend.length === 1 && pend[0].subEffect === 'createIssue');
  st.fail = null;
  const r2 = run(['add-item', 'G140', 'second item'], gh);
  check('next verb replays pending first: both items exist, flaky created once', r2.code === 0 && Object.values(st.issues).filter(i => st.parent[i.number] === 140).map(i => i.title).sort().join() === 'flaky item,second item');
  check('journal drained', require('../scripts/lib/journal').openJournal(JOURNAL).pending().length === 0);
}
// --- resume probes are idempotent: comment landed, done record lost ----------------
{
  const { st, gh } = ghStore();
  run(['add-goal', '49', 'g', '--brief', BRIEF], gh);
  const num = Number(run(['add-item', 'G140', 'once'], gh).out.trim());
  const { openJournal } = require('../scripts/lib/journal');
  openJournal(JOURNAL).intent({ opId: 'op-crash', lane: 'G140', subEffect: 'comment', desired: { issue: num, body: 'status → In progress' } });
  (st.comments[num] = st.comments[num] || []).push({ body: 'status → In progress\n<!-- opId:op-crash -->' });
  run(['set-status', String(num), 'In review'], gh);
  check('comment with matching opId is NOT re-posted', st.comments[num].filter(c => /opId:op-crash/.test(c.body)).length === 1);
  check('crash intent now recorded done', openJournal(JOURNAL).pending().length === 0);
}
// --- lock authority -----------------------------------------------------------------
{
  const { gh } = ghStore();
  const r1 = run(['add-goal', '49', 'z', '--brief', BRIEF], gh, { lockCfg: { __repoLocked: true, board: { github: false } } });
  check('locked repo without board.github → refuse', r1.code === 1 && /board\.github/.test(r1.out));
  const r2 = run(['add-goal', '49', 'z', '--brief', BRIEF], gh, { lockCfg: { __repoLocked: true, board: { github: true } } });
  check('locked repo with board.github → allowed', r2.code === 0);
}
```

- [ ] **Step 2: Run test to verify it fails** — `node tests/test-board-gh.js` — Expected: first write check throws `write verbs: not implemented yet`

- [ ] **Step 3: Write the implementation**

`scripts/board-gh-write.js`:
```javascript
// board-gh mutating verbs (spec §4.3). Each verb = ordered sub-effects.
// apply(rec): probe remote → already satisfied? journal done : do call →
// journal done. Pending intents from earlier crashes replay first.
'use strict';
const fs = require('fs');
const path = require('path');

function write(ctx) {
  const { verb, pos, opt, cfg, gh, stdout, commonDir, readBoard, bodyOf, STATUS_OPTS, openJournal, withLock, crypto } = ctx;
  const say = s => stdout(s + '\n');
  const lockCfg = ctx.lockCfg || require('../hooks/lib/config').loadConfig({ cwd: ctx.cwd || process.cwd() });
  if (lockCfg.__repoLocked && !(lockCfg.board && lockCfg.board.github === true)) {
    say('board-gh: this repo is locked and board.github is not enabled in ~/.claude/orch-lock.json — /orch:setup enables it.'); return 1;
  }
  const R = `repos/${cfg.owner}/${cfg.repo}`;
  const journal = openJournal(path.join(commonDir, 'orch', 'board-journal.jsonl'));
  const lockPath = path.join(commonDir, 'orch', 'board.lock');
  const opTag = id => `\n<!-- opId:${id} -->`;

  function issueNode(n) {
    return gh.graphql('query($o:String!,$r:String!,$n:Int!){ repository(owner:$o,name:$r){ issue(number:$n){ id databaseId state parent{ number } projectItems(first:10){ nodes{ id project{ id } } } } } }',
      { o: cfg.owner, r: cfg.repo, n }).repository.issue;
  }
  function projectItem(n) { const i = issueNode(n); const pi = i.projectItems.nodes.find(x => x.project.id === cfg.projectId); return { node: i, itemId: pi ? pi.id : null }; }

  const FX = {
    createGoal(d) {
      const hit = readBoard(gh, cfg).goals.find(g => g.name === d.title && g.status !== 'merged' && ((g.milestone && g.milestone.number) || null) === (d.milestoneNumber || null));
      if (hit) return hit.issue;
      const body = { title: d.title, body: d.body, labels: ['orch:goal'] };
      if (d.milestoneNumber) body.milestone = d.milestoneNumber;
      return gh.rest('POST', `${R}/issues`, body).number;
    },
    createIssue(d) {
      const g = readBoard(gh, cfg).goals.find(x => x.issue === d.goal);
      const hit = g && g.items.find(i => i.text === d.text);
      if (hit) return hit.issue;
      const body = { title: d.title, body: d.body, labels: d.labels };
      if (d.milestoneNumber) body.milestone = d.milestoneNumber;
      if (d.assignee) body.assignees = [d.assignee];
      return gh.rest('POST', `${R}/issues`, body).number;
    },
    addSubIssue(d) {
      const child = issueNode(d.issue);
      if (child.parent && child.parent.number === d.goal) return 'linked';
      gh.rest('POST', `${R}/issues/${d.goal}/sub_issues`, { sub_issue_id: child.databaseId }); return 'linked';
    },
    addToProject(d) {
      const { node, itemId } = projectItem(d.issue);
      if (itemId) return itemId;
      return gh.graphql('mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p,contentId:$c}){ item{ id } } }', { p: cfg.projectId, c: node.id }).addProjectV2ItemById.item.id;
    },
    setField(d) {
      const { itemId } = projectItem(d.issue);
      if (!itemId) throw new Error(`issue #${d.issue} is not on the project`);
      gh.graphql('mutation($p:ID!,$i:ID!,$f:ID!,$o:String!){ updateProjectV2ItemFieldValue(input:{projectId:$p,itemId:$i,fieldId:$f,value:{singleSelectOptionId:$o}}){ projectV2Item{ id } } }',
        { p: cfg.projectId, i: itemId, f: d.fieldId, o: d.optionId });
      return itemId; // same value twice is harmless
    },
    comment(d, opId) {
      const cs = gh.rest('GET', `${R}/issues/${d.issue}/comments?per_page=100`) || [];
      if (cs.some(c => (c.body || '').includes(`<!-- opId:${opId} -->`))) return 'exists';
      return gh.rest('POST', `${R}/issues/${d.issue}/comments`, { body: d.body + opTag(opId) }).id;
    },
    addLabel(d) { gh.rest('POST', `${R}/issues/${d.issue}/labels`, { labels: [d.label] }); return d.label; },
    removeLabel(d) { try { gh.rest('DELETE', `${R}/issues/${d.issue}/labels/${encodeURIComponent(d.label)}`); } catch (e) { if (!/404/.test(e.message)) throw e; } return d.label; },
    closeIssue(d) { if (issueNode(d.issue).state === 'CLOSED') return 'closed'; gh.rest('PATCH', `${R}/issues/${d.issue}`, { state: 'closed' }); return 'closed'; },
  };
  function apply(rec) { const remoteId = FX[rec.subEffect](rec.desired, rec.opId); journal.done(rec.opId, remoteId); return remoteId; }
  function effect(lane, subEffect, desired) { const rec = { opId: crypto.randomUUID(), lane, subEffect, desired }; journal.intent(rec); return apply(rec); }
  function replay() { for (const rec of journal.pending()) apply(rec); }

  const laneOf = s => { const m = /^G(\d+)$/i.exec(s || ''); return m ? Number(m[1]) : null; };
  function goal(n) { const g = readBoard(gh, cfg).goals.find(x => x.issue === n); if (!g) throw new Error(`no goal G${n}`); return g; }
  function findItem(n) { for (const g of readBoard(gh, cfg).goals) { const i = g.items.find(x => x.issue === n); if (i) return { g, i }; } throw new Error(`issue #${n} is not an orch item`); }
  const statusOpt = s => { const k = STATUS_OPTS.find(x => x.toLowerCase() === String(s).toLowerCase()); if (!k) throw new Error(`status must be one of ${STATUS_OPTS.join(' | ')}`); return { name: k, id: cfg.optionIds.status[k] }; };
  const setStatus = (lane, issue, name) => effect(lane, 'setField', { issue, fieldId: cfg.fieldIds.status, optionId: cfg.optionIds.status[name] });
  // Any pass-through single-select (priority = buckets, pipeline, feature): option must already exist.
  function optionId(field, value) {
    const map = cfg.optionIds[field] || {};
    const k = Object.keys(map).find(x => x.toLowerCase() === String(value).toLowerCase());
    if (!k || !cfg.fieldIds[field]) throw new Error(`unknown ${field} "${value}" — valid: ${Object.keys(map).join(', ') || '(field absent; re-run init)'}`);
    return map[k];
  }
  const setOpt = (lane, issue, field, value) => effect(lane, 'setField', { issue, fieldId: cfg.fieldIds[field], optionId: optionId(field, value) });

  const VERBS = {
    'add-goal'() {
      const [ms, name] = pos;
      if (!ms || !name || typeof opt.brief !== 'string') throw new Error('usage: add-goal <milestone#|backlog|none> "<name>" --brief <file>');
      let milestoneNumber = null;
      if (ms !== 'none') {
        const all = gh.rest('GET', `${R}/milestones?state=open&per_page=100`) || [];
        const m = /^\d+$/.test(ms) ? all.find(x => x.number === Number(ms)) : all.find(x => x.title === ms);
        if (!m) { say(`add-goal: no open milestone "${ms}" — run \`board-gh milestones\``); return 1; }
        milestoneNumber = m.number;
      }
      const brief = fs.readFileSync(opt.brief, 'utf8');
      const issue = effect('G?', 'createGoal', { title: name, body: brief, milestoneNumber });
      const lane = `G${issue}`;
      effect(lane, 'addToProject', { issue });
      setStatus(lane, issue, 'Todo');
      say(lane);
    },
    'add-item'() {
      const gn = laneOf(pos[0]); const text = pos[1];
      if (!gn || !text) throw new Error('usage: add-item G<n> "<text>" [--you] [--bucket <Priority option>] [--pipeline <opt>] [--feature <opt>] [--outcome …] [--gate LABEL]');
      const g = goal(gn); const lane = g.lane;
      const bucket = typeof opt.bucket === 'string' ? opt.bucket : cfg.buckets[0];
      optionId('priority', bucket); // validate before any write
      if (typeof opt.pipeline === 'string') optionId('pipeline', opt.pipeline);
      if (typeof opt.feature === 'string') optionId('feature', opt.feature);
      const labels = ['orch:item']; if (opt.you) labels.push('orch:you');
      const desired = { goal: gn, title: text.slice(0, 120), text, body: bodyOf(text, { outcome: opt.outcome, gate: opt.gate }), labels, milestoneNumber: g.milestone ? g.milestone.number : null };
      if (opt.you) desired.assignee = gh.rest('GET', 'user').login;
      const issue = effect(lane, 'createIssue', desired);
      effect(lane, 'addSubIssue', { issue, goal: gn });
      effect(lane, 'addToProject', { issue });
      setStatus(lane, issue, 'Todo');
      setOpt(lane, issue, 'priority', bucket);
      if (typeof opt.pipeline === 'string') setOpt(lane, issue, 'pipeline', opt.pipeline);
      if (typeof opt.feature === 'string') setOpt(lane, issue, 'feature', opt.feature);
      say(String(issue));
    },
    move() { const n = Number(pos[0]); if (!n || !pos[1]) throw new Error('usage: move <issue#> <Priority option>'); const { g } = findItem(n); setOpt(g.lane, n, 'priority', pos[1]); },
    'set-status'() { const n = Number(pos[0]); const s = statusOpt(pos[1]); const { g } = findItem(n); setStatus(g.lane, n, s.name); effect(g.lane, 'comment', { issue: n, body: `status → ${s.name}` }); },
    'set-blocker'() {
      const n = Number(pos[0]); const text = pos[1];
      if (!text || typeof opt.owner !== 'string') throw new Error('usage: set-blocker <issue#> "<text>" --owner <who>');
      const { g } = findItem(n);
      effect(g.lane, 'addLabel', { issue: n, label: 'orch:blocked' });
      effect(g.lane, 'comment', { issue: n, body: `blocked: ${text} · owner: ${opt.owner}` });
    },
    'clear-blocker'() { const n = Number(pos[0]); const { g } = findItem(n); effect(g.lane, 'comment', { issue: n, body: 'unblocked' }); effect(g.lane, 'removeLabel', { issue: n, label: 'orch:blocked' }); },
    done() { const n = Number(pos[0]); const { g } = findItem(n); setStatus(g.lane, n, 'Done'); effect(g.lane, 'closeIssue', { issue: n }); },
    'close-goal'() {
      const gn = laneOf(pos[0]); if (!gn) throw new Error('usage: close-goal G<n> --evidence "<ledger line or artifact path>"');
      if (typeof opt.evidence !== 'string' || !opt.evidence.trim()) { say(`close-goal: --evidence required (ledger line or artifact path naming G${gn})`); return 1; }
      const g = goal(gn);
      const open = g.items.filter(i => !i.done);
      if (open.length) { say(`close-goal: ${g.lane} has ${open.length} open item(s): ${open.map(i => '#' + i.issue).join(' ')}`); return 1; }
      effect(g.lane, 'comment', { issue: gn, body: `evidence: ${opt.evidence.trim()}` });
      setStatus(g.lane, gn, 'Done');
      effect(g.lane, 'closeIssue', { issue: gn });
      say(`${g.lane} merged`);
    },
  };
  if (!VERBS[verb]) { say(`board-gh: unknown verb ${verb}`); return 1; }
  try { return withLock(lockPath, () => { replay(); return VERBS[verb]() || 0; }); }
  catch (e) { say(`board-gh: ${verb} failed — ${e.message}`); return 1; }
}

module.exports = { write };
```

- [ ] **Step 4: Run test** — `node tests/test-board-gh.js` — Expected: `41 passed, 0 failed` (11 + 30)

- [ ] **Step 5: Run the whole suite** — `npm test` — Expected: `all N suites passed`

- [ ] **Step 6: Commit**

```bash
git add scripts/board-gh-write.js tests/test-board-gh.js
git commit -m "feat(board-gh): goal/item verbs under lock + journal with idempotent resume (spec §4.3)"
```

---

### Task 8: `board-html.js --json` input

**Files:**
- Modify: `scripts/board-html.js:10-46`
- Test: `tests/test-board-html-json.js`

**Interfaces:**
- Consumes `read` JSON (Task 5). `node scripts/board-html.js --json <read.json> <out.html> [--worklogs …] [--adr …] [--stale …] [--digest …] [--queue …] [--title …]`. Internal shape after parse stays `{ buckets, items[{lane,bucket,done,text,outcome,milestone}], laneNames, laneStatus, gates }` — the renderer's internal `milestone` key is fed from the item's `gate` (renders as `= LABEL ✅`, unchanged); lane = `G<n>`; `laneNames[G<n>] = "<name> · <milestone title>"`; YOU items become lane `YOU`.

- [ ] **Step 1: Write the failing test**

`tests/test-board-html-json.js`:
```javascript
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const SCRATCH = path.join(__dirname, 'scratch-board-html');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(SCRATCH, { recursive: true });
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
const READ = { buckets: ['Now', 'Next', 'Later'],
  goals: [{ lane: 'G142', issue: 142, name: 'knowledge-gate', milestone: { number: 49, title: 'C1 SHU-HDS operable' }, status: 'running', blocker: null, brief: 'BRIEF', updated: 'x',
    items: [{ issue: 150, bucket: 'Now', pipeline: 'Engine', feature: null, status: 'In progress', text: 'write grammar', outcome: 'canonical home', gate: null, done: false, you: false, updated: 'x' },
            { issue: 151, bucket: 'Next', pipeline: null, feature: null, status: 'Done', text: 'tests', outcome: null, gate: 'GATE LIVE', done: true, you: false, updated: 'x' },
            { issue: 152, bucket: 'Now', pipeline: null, feature: null, status: 'Todo', text: 'run setup', outcome: null, gate: null, done: false, you: true, updated: 'x' }] }] };
const jp = path.join(SCRATCH, 'read.json'), out = path.join(SCRATCH, 'b.html');
fs.writeFileSync(jp, JSON.stringify(READ));
execFileSync('node', [path.join(__dirname, '..', 'scripts', 'board-html.js'), '--json', jp, out, '--title', 't']);
const html = fs.readFileSync(out, 'utf8');
check('renders G142 lane with name, milestone and status', /G142/.test(html) && /knowledge-gate/.test(html) && /C1 SHU-HDS operable/.test(html) && /running/.test(html));
check('renders items in buckets', /write grammar #150/.test(html) && /Next/.test(html));
check('done gate item struck through with its label', /<s>✓ tests #151<\/s>/.test(html) && /GATE LIVE/.test(html));
check('YOU item lands on the YOU lane', /run setup #152/.test(html) && /YOU/.test(html));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails** — `node tests/test-board-html-json.js` — Expected: script errors or checks fail.

- [ ] **Step 3: Implement** — replace `scripts/board-html.js` lines 10–46 with:

```javascript
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
```
The lane sort at old line 94–95 uses `localeCompare(…, {numeric:true})` — `G142` sorts fine; `YOU` still last. `gates` reads `lines` (empty in JSON mode) → `''`. Leave the rest untouched.

- [ ] **Step 4: Run tests** — `node tests/test-board-html-json.js && npm test` — Expected: `4 passed`; all suites pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/board-html.js tests/test-board-html-json.js
git commit -m "feat(board-html): accept board-gh read JSON via --json"
```

---

### Task 9: `board.github` lock key + ship-gate `close-goal` evidence match

**Files:**
- Modify: `hooks/lib/config.js:105` (after the `contract` copy)
- Modify: `hooks/contract-ship-gate.js:141-143` (insert between the corrupt-lock probe and `const cls`)
- Test: `tests/test-ship-gate-close-goal.js`

**Interfaces:**
- `loadConfig` sets `out.board = repoEntry.board` when present and defines non-enumerable `__repoLocked = !!repoEntry` (consumed by Task 7's authority check).
- Ship-gate pre-check (git only): command matches `/board-gh(?:\.js)?\s+close-goal\s+(G\d+)\b/i` → with an active contract and a repo root: `git ls-tree --name-only HEAD tmp/worklogs/` must list `tmp/worklogs/G<n>-*.md`, and `git show HEAD:<that>` must contain a line `^(iter|evidence:).*\bG<n>\b` **or** the `--evidence` value verbatim; else BLOCK with `close-goal: worklog for G<n> is not committed at HEAD` / `close-goal: no ledger line naming G<n> in <path> at HEAD`. Pass → `appendAudit(root, {action:'close-goal', lane, verdict:'ALLOW', by:'hook'})`, exit 0. No contract → exit 0 untouched.

- [ ] **Step 1: Write the failing test**

`tests/test-ship-gate-close-goal.js`:
```javascript
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const SHIPHOOK = path.join(__dirname, '..', 'hooks', 'contract-ship-gate.js');
const SCRATCH = path.join(__dirname, 'scratch-close-goal');
const FAKEHOME = path.join(SCRATCH, 'home');
const PROJ = path.join(SCRATCH, 'proj');
fs.rmSync(SCRATCH, { recursive: true, force: true });
fs.mkdirSync(path.join(FAKEHOME, '.claude'), { recursive: true });
fs.mkdirSync(path.join(PROJ, '.claude'), { recursive: true });
const g = a => execFileSync('git', ['-C', PROJ, ...a], { stdio: ['ignore', 'pipe', 'pipe'] });
g(['init', '-q']); g(['config', 'user.email', 't@t']); g(['config', 'user.name', 't']);
fs.writeFileSync(path.join(PROJ, '.claude', 'orch.json'), JSON.stringify({ contract: { domains: { all: { paths: ['**'], decide: 'ai', ship: 'commit' } } } }));
fs.writeFileSync(path.join(PROJ, 'README.md'), 'x');
g(['add', '.']); g(['commit', '-qm', 'init']);
let pass = 0, fail = 0, n = 0;
function check(name, cond) {
  n++;
  if (cond) { pass++; console.log(`  ok ${n}. ${name}`); }
  else { fail++; console.log(`FAIL ${n}. ${name}`); }
}
function run(cmd) {
  const payload = JSON.stringify({ session_id: 's', cwd: PROJ, tool_input: { command: cmd } });
  try { execFileSync('node', [SHIPHOOK], { input: payload, env: { ...process.env, USERPROFILE: FAKEHOME, HOME: FAKEHOME }, stdio: ['pipe', 'pipe', 'pipe'] }); return 0; }
  catch (e) { return e.status; }
}
const CMD = 'node scripts/board-gh.js close-goal G142 --evidence "iter 3 · G142 · 10 → 2"';
check('no worklog at HEAD → BLOCK', run(CMD) === 2);
fs.mkdirSync(path.join(PROJ, 'tmp', 'worklogs'), { recursive: true });
fs.writeFileSync(path.join(PROJ, 'tmp', 'worklogs', 'G142-kg.md'), 'BRIEF\ngoal: x\n');
check('worklog uncommitted → still BLOCK', run(CMD) === 2);
g(['add', '-f', 'tmp/worklogs/G142-kg.md']); g(['commit', '-qm', 'wl']);
check('committed worklog without ledger line → BLOCK', run(CMD) === 2);
fs.appendFileSync(path.join(PROJ, 'tmp', 'worklogs', 'G142-kg.md'), 'iter 3 · G142 · 10 → 2 · ok\n');
check('ledger line only in working copy → BLOCK (HEAD is the truth)', run(CMD) === 2);
g(['add', '-f', 'tmp/worklogs/G142-kg.md']); g(['commit', '-qm', 'ledger']);
check('ledger line at HEAD → ALLOW', run(CMD) === 0);
check('other goal still blocked', run(CMD.replace(/G142/g, 'G7')) === 2);
check('read verb untouched', run('node scripts/board-gh.js read --json') === 0);
const audit = fs.readFileSync(path.join(PROJ, '.claude', 'orch-audit.jsonl'), 'utf8');
check('ALLOW audited with lane', /"action":"close-goal".*"lane":"G142".*"verdict":"ALLOW"/.test(audit));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Run test to verify it fails** — `node tests/test-ship-gate-close-goal.js` — Expected: check 1 fails (hook exits 0 — no git verb in the command).

- [ ] **Step 3: Implement — `hooks/lib/config.js`** — after line 105 (`}` closing `if (repoEntry && … 'contract')`), add:
```javascript
  if (repoEntry && Object.prototype.hasOwnProperty.call(repoEntry, 'board')) out.board = repoEntry.board;
  Object.defineProperty(out, '__repoLocked', { value: !!repoEntry });
```

- [ ] **Step 4: Implement — ship-gate pre-check** — insert after line 141 (end of the corrupt-lock `if` block), before `const cls = …`:
```javascript
// board-gh close-goal (spec §4.1 "Evidence-before-done" / §2.3 at v0.10):
// evidence must already be committed — a ledger line naming the goal in
// that goal's worklog AT HEAD. Git only; no network.
const CG = cmd.match(/board-gh(?:\.js)?\s+close-goal\s+(G\d+)\b/i);
if (CG) {
  const lane = CG[1].toUpperCase();
  const cwd0 = (j && j.cwd) || process.cwd();
  let root0 = null;
  try { root0 = git(cwd0, ['rev-parse', '--show-toplevel']).trim(); } catch {}
  const cfg0 = loadConfig({ cwd: root0 || cwd0 });
  const active = cfg0.contract && cfg0.contract.domains && Object.keys(cfg0.contract.domains).length;
  if (active && root0) {
    const block = reason => { appendAudit(root0, { action: 'close-goal', lane, verdict: 'BLOCK', reason, by: 'hook' }); console.error(`BLOCKED (orch ship-gate): ${reason}`); process.exit(2); };
    let files = [];
    try { files = git(root0, ['ls-tree', '--name-only', 'HEAD', 'tmp/worklogs/']).split(/\r?\n/).filter(Boolean); } catch {}
    const wl = files.find(f => new RegExp(`^tmp/worklogs/${lane}-.*\\.md$`, 'i').test(f));
    if (!wl) block(`close-goal: worklog for ${lane} is not committed at HEAD`);
    const text = git(root0, ['show', `HEAD:${wl}`]);
    const ev = cmd.match(/--evidence\s+(?:"([^"]+)"|'([^']+)'|(\S+))/) || [];
    const evidence = ev[1] || ev[2] || ev[3] || '';
    if (!new RegExp(`^(iter|evidence:).*\\b${lane}\\b`, 'm').test(text) && !(evidence && text.includes(evidence))) block(`close-goal: no ledger line naming ${lane} in ${wl} at HEAD`);
    appendAudit(root0, { action: 'close-goal', lane, verdict: 'ALLOW', by: 'hook' });
  }
  process.exit(0);
}
```
(`git()` is defined at line 126 — above the insertion point.)

- [ ] **Step 5: Run tests** — `node tests/test-ship-gate-close-goal.js && npm test` — Expected: `8 passed`; all suites pass (the `test-lock.js` suite must be unaffected by the new `out.board` line).

- [ ] **Step 6: Commit**

```bash
git add hooks/lib/config.js hooks/contract-ship-gate.js tests/test-ship-gate-close-goal.js
git commit -m "feat(ship-gate): close-goal evidence-at-HEAD check; board.github lock key (spec §2.3/§4.2)"
```

---

### Task 10: Skills re-pointed at `board-gh`

**Files:**
- Modify: `skills/board/SKILL.md`, `skills/goal/SKILL.md:1-10,49-73`, `skills/go/SKILL.md` (lines 3–9, 19–32, 47–61, 80–84, 105–110, 130–138), `skills/setup/SKILL.md`

Prose edits. Vocabulary everywhere: milestone / goal / item / gate. Replace every "campaign" in these four files (descriptions included — e.g. `skills/goal/SKILL.md:5` "Create or edit a campaign" → "Create or edit a goal").

- [ ] **Step 1: `skills/board/SKILL.md`** — header: drop the legacy-numbering sentence (numbers are goal issue numbers now). Replace **Gather** items 1–2 and the last two sections:

```markdown
1. Board: `node "<plugin>/scripts/board-gh.js" read --json` — GitHub Issues
   + the repo's Project ARE the board (spec §4): `goals[]` (lane `G<n>`,
   `name`, `milestone`, folded `status`, `blocker`, `items[]` incl. YOU
   items flagged `you`, the gate item carrying `gate`). No
   `.orch/board.json` → say "board not initialised — run
   `/orch:board init`" and stop. GitHub unreachable → say so and stop;
   never render from memory.
2. Stale: an item's `updated` older than `board.staleDays`
   (`.claude/orch.json`, default 3) while its goal's status is unchanged
   → ⚠ with age.
```
Render: header line `ORCH BOARD · <repo> · project #<n>`; columns = `buckets` (`Now → Next → Later`); goal tracks grouped under a one-line milestone header (`── C1 SHU-HDS operable ──`), then `G142 · <name>   <status>`; the gate item renders `= <LABEL> ✅` as today; `you: true` items go on the single YOU track at the bottom. Replace the html + "No route section" sections with:
```markdown
## `/orch:board html`

Run `read --json > tmp/board.json`, compute stale + digest as above, then:

    node "<plugin>/scripts/board-html.js" --json tmp/board.json tmp/board.html \
      --worklogs tmp/worklogs --adr docs/adr \
      --stale "G142:5d" --digest "G142:4 ships · 1 block" \
      --queue "<queue>" --title "orch board · <repo>"

Report the output path; do not open it unasked.

## `/orch:board init` — the one write this command owns

Announce it, run `node "<plugin>/scripts/board-gh.js" init [--project N] --dry-run`,
show the DRY lines, and on the operator's go run it without `--dry-run`.
`--project N` adopts an existing Project (i-Start: `--project 1`,
Pertasim); otherwise a `<repo> · orch board` Project is created.
Idempotent; never creates milestones; never renames `Priority` options
— tell the operator to rename `P0/P1/P2 → Now/Next/Later` in the
Project settings first if they want those names. Commit
`.orch/board.json`. Option: `--owner <login>` (Project owner if not the
repo owner).
```

- [ ] **Step 2: `skills/goal/SKILL.md`** — description: "Create or edit a goal … register the goal on the board". Replace Register items 1–3 with:

```markdown
1. Pick the milestone — exactly one question: run
   `node "<plugin>/scripts/board-gh.js" milestones` and offer the open
   ones (`C<n> …` first, then `backlog`). Milestones are the operator's;
   never create one. Write the BRIEF to `tmp/worklogs/_brief.md` first.
2. Register: `add-goal <milestone#> "<name>" --brief tmp/worklogs/_brief.md`
   prints the lane `G<n>` (the goal issue's number — unique, never
   reused). Rename the worklog to `tmp/worklogs/G<n>-<name>.md`; the
   goal is `G<n> · <name>` everywhere from here on. Prefer a short
   code-like name (2-6 chars). Create `tmp/worklogs/` and `docs/adr/`
   now if missing. No `.orch/board.json` → stop, point to `/orch:board init`.
3. Seed the route — one call per known BRIEF step:
   `add-item G<n> "<step>" [--bucket Now|Next|Later] [--pipeline <option>] [--feature <option>] [--outcome "<next>"] [--gate "<LABEL>"]`
   — `--gate` on the done-condition item (its completion closes the
   goal); first steps `--bucket Now`, the rest `Next`; `--pipeline` /
   `--feature` = the Project's own options (`.orch/board.json` →
   `optionIds`), picked by judgment from the step text, omitted when
   unsure. Owner actions (merge clicks, sign-offs):
   `add-item G<n> "<action>" --you`. Buckets are the Project's
   `Priority` options — never invent one.
```
"Complete when": `the BRIEF is the goal issue's body and sits at the top of the worklog, and the goal's items are on the board`.

- [ ] **Step 3: `skills/go/SKILL.md`**
  - Description + invocation: "campaign" → "goal" throughout (`/orch:go C2` → `/orch:go G142`; `focus: G<n> · <name> (+<k> open)`).
  - Invocation item 1: `docs/BOARD.md` → `` `node "<plugin>/scripts/board-gh.js" read --json` ``; delete the legacy-numbering sentence. Item 2 "Focus": one **goal** per session.
  - Phase table row 1: "board row `merged`" → "goal status `merged`"; row 3: "no goal / no BRIEF".
  - "The board" section, first paragraph →
    ```markdown
    Canonical store: GitHub Issues + the repo's Project (`.orch/board.json`,
    spec §4). Milestone (operator's, `C<n> …`) → goal = `orch:goal` issue
    (`G<n>`) → items = sub-issues; the item marked `gate:` closes the
    goal. Goal status is never written — it is folded from the items:
    `merged` (goal closed) · `blocked` (an item has `orch:blocked`) ·
    `needs_attention` (label on the goal) · `review` · `running` ·
    `ready`. Change it by changing items: `set-status <issue#>
    <Todo|In progress|In review|Done>`, `set-blocker <issue#> "<why>"
    --owner <who>`, `clear-blocker`, `done <issue#>`; reschedule with
    `move <issue#> Now|Next|Later` (the Project's `Priority` field — the
    board's columns). Every verb fails the step if GitHub is unreachable —
    say so, never pretend.
    ```
  - Contract section park line: `` (`YOU | NOW | <item> |`) `` → `` (`add-item G<n> "<action>" --you`) ``.
  - Phase route step 5 ROUTE line: `lane:C<n>` → `lane:G<n>`.
  - Phase ship step 3 →
    ```markdown
    3. Board: evidence-before-done — `done <issue#>` for each completed
       item; append the ledger line to the worklog and COMMIT it; then
       `close-goal G<n> --evidence "<that ledger line>"`. The script
       refuses while any item is open or without evidence; the ship-gate
       hook independently requires the ledger line in the worklog **at
       HEAD**. The gate item flipping `done` is what makes the goal
       closable. Work ended without evidence → `set-blocker <gate-item#>
       "no evidence: <why>" --owner <who>` and leave the goal blocked.
    ```
    (ponytail: no `needs_attention` verb — `set-blocker` with an explicit reason covers it; the fold still honors the label if a human applies it.)

- [ ] **Step 4: `skills/setup/SKILL.md`** — add a migration step:
```markdown
- **v0.10 board on GitHub:** run `/orch:board init` (dry-run first;
  `--project N` to adopt an existing Project); commit `.orch/board.json`;
  if the lock has a `repos[<key>]` entry, write `board: { github: true }`
  into it (same atomic-replace path as contract); delete `docs/BOARD.md`
  if present — no import, the file is retired (spec §4, Non-goals).
  Existing worklogs named `C<n>-…` are left alone; new goals are `G<n>-…`.
```

- [ ] **Step 5: Sanity** — `rtk grep -n "BOARD.md" skills/` → only the setup deletion line. `rtk grep -in "campaign" skills/` → zero hits. `npm test`.

- [ ] **Step 6: Commit**

```bash
git add skills/board/SKILL.md skills/goal/SKILL.md skills/go/SKILL.md skills/setup/SKILL.md
git commit -m "docs(skills): goal/go/board/setup drive the board through board-gh (spec §4.4)"
```

---

### Task 11: CHANGELOG + README + spec §2 lane examples

**Files:**
- Modify: `CHANGELOG.md` (Unreleased), `README.md` (board section), `docs/specs/2026-08-31-orch-v2-upgrade-design.md` §2.1/§2.2 (`C3` → `G142` in examples and the branch-prefix rule)

- [ ] **Step 1: Spec §2** — in §2.1's route-record JSON change `"lane": "C3"` → `"lane": "G142"` and `"worklog": "tmp/worklogs/C3-HDS.md"` → `"tmp/worklogs/G142-HDS.md"`; in §2.2 change `C3/<slug>` → `G142/<slug>`, `orch-lane:C3` → `orch-lane:G142`, "e.g. `C3/...`" → "e.g. `G142/...`", and `C<n>`/`C<m>` in the lane-binding sentence → `G<n>`/`G<m>`. Leave Review provenance untouched.

- [ ] **Step 2: CHANGELOG** under `## Unreleased`:
```markdown
### Added
- `scripts/board-gh.js` — GitHub Issues + Projects v2 are the board (spec §4 r8d). Milestone (operator's, `C<n> …`) → goal = `orch:goal` issue `G<n>` → items = sub-issues; buckets = the Project's `Priority` options (`Now/Next/Later` after the operator renames them). Verbs: init (`--project N` adopts), milestones, add-goal, add-item, move, set-status, set-blocker, clear-blocker, done, close-goal, read. Lock + fsynced journal; idempotent resume.
- `.orch/board.json` per repo; `board.github` lock key.
- ship-gate: `close-goal G<n>` requires a ledger line naming `G<n>` in `tmp/worklogs/G<n>-*.md` at HEAD.
- `board-html.js --json`.
### Changed
- Vocabulary: "milestone" is GitHub's Milestone; "goal" replaces "campaign"; the done-condition item marker is `gate: <LABEL>` (was `milestone:`). Lane id is `G<issue#>`.
### Removed
- `docs/BOARD.md` as a board store. `/orch:setup` deletes it; nothing is imported.
```

- [ ] **Step 3: README** — replace the board paragraph with: where the board lives (milestone → goal → items, gate item), `/orch:board init [--project N]` once per repo, the one-time Priority rename, GitHub unreachable fails the step (no offline mode).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md README.md docs/specs/2026-08-31-orch-v2-upgrade-design.md
git commit -m "docs(board): changelog, readme, G<n> lane examples in spec §2"
```

---

## Self-review

**Spec coverage** — §4.1 three-level model: T5 (read/fold over goals + sub-issues), T7 (add-goal/add-item/sub-issue link), T1 (fold), evidence-before-done: T7 (script) + T9 (hook, `G<n>`). Buckets = Priority (r8c): T5 read, T6 init (adopt, never rename), T7 `--bucket`/`move`. Pipeline/Feature pass-through: T6 (create-only-if-absent), T7 `optionId()`. `gate:` marker (r8d): T5 parse/body, T7 `--gate`, T8 render, T10 prose. §4.2 config/init/authority: T6, T9, T7 (authority check). §4.3 verbs incl. `milestones`, lock, journal, failure, read shape: T2–T5, T7. §4.4 skills + ship-gate + setup: T10, T9. Lane grammar `G<n>`: T9 regex, T10 prose, T11 spec §2. Non-goals: no milestone creation (T6 test), no import, no queue, no cross-clone lock, OWNER-APPROVED untouched.

**Deliberate gaps:** `needs_attention` has no verb (T10 note). Sub-issue link uses the REST `sub_issues` endpoint with the child's `databaseId`; if the repo's GitHub plan lacks sub-issues the `addSubIssue` call fails and the step fails loudly — the live smoke in T6/T4 is where that surfaces.

**Type consistency** — `read` JSON (T5) consumed by T7 (`goal()`, `findItem()` use `goals[].items[].issue/done/text`, `goals[].milestone.number`), T8 (`goals[].items[].you/gate`), T10 prose. `foldStatus(goal{state,labels}, items{labels,status,blockerComment})` built in T5 `readBoard`. `openJournal` API used identically in T2/T7. `withLock(lockPath, fn, opts)` in T3/T7. `makeGh(run)` → `{graphql, rest}` in T4 and every fake. `lockCfg.__repoLocked` / `.board.github` defined in T9 config.js, consumed in T7. `bodyOf(text, {outcome, gate})` in T5, used in T7.
