# Orch v2 Upgrade — Design Spec

Date: 2026-09-01 · Status: rework round 7 draft (Codex r1 REWORK → r2 FAIL
→ r3 FAIL → r4 FAIL → r5 FAIL → r6 FAIL → r7 FAIL → this revision).
Operator's r7 cap reached — no r8 launched. The 3 r7 criticals were
instead verified directly against real `git`/`gh` behavior (see Review
provenance) and fixed with confirmed facts; the 4 r7 highs were doc-only
consistency fixes. This revision is **unreviewed by Codex** — treat as
believed-correct-pending-a-future-check, not as passing. Baseline: orch
v0.6.0 (`2684655`)

**r8 (2026-09-03, operator decision, not a Codex round):** §4 rewritten
— the board moves *to* GitHub (Issues + Projects v2 as the only store,
`docs/BOARD.md` retired) instead of being mirrored there. Cross-refs in
§1 Lock scope, §2.2, §2.3, Goal, Non-goals, release/status tables and
Testing updated to match. Everything else unchanged from r7.
**r8b (same day):** three-level model after checking Pertasim's real
usage — Milestone = top level (operator's, never created by orch), a
`/orch:goal` = Issue `orch:goal` with sub-issues as route items, lane id
`G<issue#>`; `C<n>` reserved for milestone titles. Config is
`.orch/board.json`. **r8c:** buckets = the Project's existing `Priority`
field (operator renames `P0/P1/P2` → `Now/Next/Later` in the UI); no
new fields, no `orch:bucket:*` labels, no Sprint/Iteration; `init
--project N` adopts an existing Project (Pertasim #1 is orch's trial);
Pipeline/Feature are pass-through. **r8d:** orch says "milestone", not
"campaign", for the top level (GitHub's own word); the item marker
`milestone: <LABEL>` is renamed `gate: <LABEL>` to keep one meaning.

## Threat model (governs every enforcement claim)

The hook wall defends against a **sloppy or drifting agent** — one that
forgets the contract, picks a too-cheap tier, or claims done without
evidence. It does NOT defend against an adversarial agent that forges
state, and it does not survive harness faults: **a Claude Code PreToolUse
hook that times out (10 s budget), crashes, or exits non-2 lets the action
through.** Every ENFORCED label below therefore means "verified
independently of agent-written state, *conditional on successful hook
execution*." Gate hooks are written to protect that condition: all script
errors caught and converted to exit 2, no network calls, no unbounded git
operations. Where the operator needs unconditional blocking, the harness's
own permission deny-rules are the tool, not orch hooks — documented in
README.

Label vocabulary: **ENFORCED** (hook verifies against locked config /
repo state) · **ADVISORY** (guardrail that catches drift; spoofable or
bypassable by intent) · **INSTRUCTED** (skill-text rule with no hook).
The status table at the end of this spec labels every mechanism.

## Goal

Four workstreams, shipped in order, each independently releasable:

1. **Contract v2** — domain × model-tier matrix (governance data)
2. **Enforcement** — hook additions that consume it
3. **Coordination** — fleet roster + vehicle abstraction (herdr-pluggable)
4. **Board on GitHub** — Issues + Projects v2 become the board; no file

Design principle: skills write records at decision time; hooks verify at
action time; hooks **recompute anything security-relevant from locked
config** rather than trusting agent-written records.

## Non-goals

- No coordination runtime (no orca; the harness's `Workflow` tool is the
  DAG engine). No peer-to-peer delegate messaging.
- No tier caps (floors only). No adversarial-grade attestation (trusted-
  runner evidence manifests, hook-owned session state beyond the per-
  session route record) — deferred epic, added per-gate if bypass shows
  up in practice.
- No `docs/BOARD.md` after v0.10 — not as a cache, not as a mirror. No
  migration of any existing BOARD.md content. No offline write queue.
  No cross-clone lock. No GitHub-side owner-approval signal (the
  OWNER-APPROVED marker stays a chat-typed, owner-only marker, untouched
  by §4). Pertasim's `Feature`/`Priority` fields are left at GitHub
  defaults and unused.

---

## 1. Contract v2 — domain × model matrix

Optional per-domain `tiers` block in delegate.md's role vocabulary
(`low | mid | high | frontier`), never model names:

```json
"numerics": { "paths": ["src/..."], "expertise": "...",
  "decide": "ai", "ship": "commit",
  "tiers": { "work": "mid", "review": "high" } }
```

- `work` = floor for implement/edit dispatches. `review` = floor for
  review verdicts — **INSTRUCTED** (the go skill applies it at verdict
  time; no hook can tell a work brief from a review brief).
- Absent `tiers` = today's advisory tier table. No migration needed.
- Strictest-wins across multi-domain matches: **highest** floor.
- **Schema versioning:** new field `contract.schemaVersion: 2`. The
  existing `contract.version` is documented as what it already is — a
  monotonic edit **revision** — and keeps incrementing per edit. Absent
  `schemaVersion` = schema 1 regardless of revision. `schemaVersion: 2`
  marks the contract's **data shape only** (tiers/models present) — it
  is never itself an activation switch; see Sequencing for the
  `enforcement.*` flags that actually turn hooks on, and the evaluation
  order below (r4) for how the two combine.
- **Evaluation order (r4 — resolves the r3 schemaVersion/flag
  contradiction):** each v0.8+ hook evaluates in this fixed order: ①
  read its own `enforcement.<name>` flag from raw, validated lock
  provenance (never the merged project view — see Lock scope below); ②
  flag absent or `false` → no-op, today's advisory behavior, regardless
  of `schemaVersion` — an unsupported `schemaVersion` on an unmigrated
  repo is therefore inert, not a block. ③ flag `true` → require
  `schemaVersion === 2` and strictly valid data (§ this section); if
  either is missing or malformed → BLOCK "enforcement enabled but
  contract data invalid — run `/orch:setup` migration." A `true` flag
  can never coexist with unmigrated data in practice because `/orch:setup`
  is the only writer of both and always writes them together, but the
  hook re-derives this itself rather than trusting that invariant.
- **Lock bundle:** the lock's atomic-replace rule extends from `contract`
  alone to the bundle `{contract, models}`, replaced **wholesale** — no
  key-level merging of project model entries into a locked map. Rank
  order low<mid<high<frontier validated at load; a model name appearing
  at multiple ranks resolves to the highest (fail-strict).
- **Lock scope (r5 — keyed by git common dir, not toplevel path; full
  schema enumerated; migration moved out of hook-read time):** today's
  single flat `~/.claude/orch-lock.json` deep-overrides whichever
  repo's project config is currently being read (`hooks/lib/config.js`)
  — fine for machine-wide guard toggles (`destructiveGit.enabled` and
  similar), wrong for repo-specific governance data: migrating one repo
  must not silently arm gates in every other repo sharing the same home
  directory. That governance bundle nests under a `repos` map keyed by
  the repo's **git common directory** (`git rev-parse --git-common-dir`,
  resolved to an **absolute path via filesystem realpath** — resolving
  symlinks/junctions to their real target — r6: never unconditional
  case-folding, which collides distinct repositories on case-sensitive
  filesystems; case handling instead comes from the filesystem's own
  reported case-sensitivity, queried once at resolve time, not assumed)
  — never the toplevel working-tree path, which differs per linked
  worktree (`.worktrees/*` in this repo included) while the common dir
  is shared by the main checkout and every worktree alike:
  `lock.repos["D:/istart/orch/.git"] = {contract, models, enforcement,
  fleet, board, prGate}`. **Full schema, no repo-specific key left
  top-level:** `fleet.capacity`/`fleet.staleMinutes`/
  `fleet.reservationTimeoutMinutes`, `board.github` (r8 — renamed from
  r6's `boardSync.enabled`: it no longer authorizes a sync, it
  authorizes GitHub as the board store; one spelling, §4 is normative),
  and `prGate.maxRangeCommits`/`prGate.scanTimeoutMs` (r7 —
  added; §2.2's range bound is meaningless as a defense if these
  ceilings were project-writable) move under the same repo entry — all
  three authorize repo-specific
  behavior (capacity planning, external writes) and belong with
  `contract`/`models`/`enforcement`, not beside the genuinely
  machine-global guard toggles (`destructiveGit`, `blockProcessKill`),
  which stay top-level. The loader resolves the *current* repo's common
  dir first and reads only `lock.repos[<that path>]`, ignoring every
  other entry — a hook never sees another repo's flags, contract, fleet
  limits, or sync authorization. Bare repos and submodules use the same
  `--git-common-dir` call (git defines it for both); a path that isn't
  inside any git repository has no key and every repo-scoped hook no-ops.
  Tested: linked worktree, symlinked/junctioned repo path, case-sensitive
  filesystem with two similarly-named repos, bare repo, submodule.
- **Legacy migration (r5 — moved out of hook-read time, was an
  unsynchronized concurrent write):** a lock file with a top-level
  `contract`/`models` and no `repos` map is **not** auto-rewritten by
  whichever hook happens to read it first (r4's version raced
  concurrent hooks from different repos with no locking, corrupting the
  shared file under contention). Instead, `/orch:setup`'s v0.7 first-run
  step is the sole migration writer: it acquires the same `O_EXCL`
  lockfile discipline as §3.1's roster writes, reads the legacy
  top-level bundle, writes it into `repos[<current common dir>]` in a
  temp file, fsyncs, and renames — a single serialized, attended
  operation, never performed implicitly by a hook. Until an operator
  runs that step, a legacy lock's top-level `contract`/`models` is
  inert for every repo (no implicit adoption, no guessing which repo it
  belonged to).
- **Lock failure semantics (r2):** the loader returns
  `{present, corrupt, value}` per locked section instead of erasing
  provenance. Rules: lock present+corrupt → every guard whose locked
  authority is unrecoverable fails **closed** (updating
  `tests/test-lock.js`, which currently pins destructive-guard
  fail-open; CHANGELOG documents the break). Lock carries a tiered
  `contract` but no complete valid `models` map → tier gate fails
  closed ("locked contract requires a locked model map").
- **Tier value validation (r3):** every domain's `tiers.work` /
  `tiers.review`, when present, must be exactly one of
  `low|mid|high|frontier`. Any other value — missing, wrong type, an
  unknown role string — makes that domain's tier data invalid; the tier
  gate treats it as "locked contract requires valid tier data" and
  fails **closed** (BLOCK) rather than silently matching with no floor.
- **Strict `schemaVersion` parsing (r5 — scoped to only run when a hook
  is actually enforcing, r4's version contradicted the flag-first
  evaluation order and could block a v0.7 "zero behavior change"
  install):** this check is step ③ of §"Sequencing"'s evaluation order
  and **only runs there** — i.e. only after the hook's own
  `enforcement.<name>` flag has already been read as `true`. With the
  flag `false` (every v0.7 install, and any v0.8 install that hasn't
  migrated a given domain), a malformed `schemaVersion` is never
  inspected and causes no block — step ② already short-circuited to
  no-op. Once the flag is `true` there is **one rule, no no-op branch**
  (r6 — removes the self-contradiction: r5 let a flag-true, schema-1
  combination silently no-op with only a warning, which is exactly the
  "enabled gate does nothing" bug this section exists to prevent):
  exactly the integer `2` → schema 2, proceed. Anything else — absent,
  a string, `3`, a float, malformed — → BLOCK "unsupported
  contract.schemaVersion (enforcement is enabled but the contract is
  not migrated)." `/orch:setup` is the only writer of `enforcement.*`
  flags and always writes `schemaVersion: 2` in the same operation, so
  this BLOCK should only ever fire on a manually-edited lock — same
  fail-closed posture as the `residentFloor` truth table's row 1.
  `schemaVersion` remains a **data-shape** marker, not an
  activation switch — the flags are.

Touches: `skills/setup/SKILL.md`, `skills/go/SKILL.md`,
`skills/go/delegate.md`, `hooks/lib/config.js`, README.

## 2. Enforcement hooks

All: `config.js` loader, `appendAudit` on every ALLOW/BLOCK, lockable,
error-trapped to exit 2 (see threat model).

### 2.1 Tier gate — new `hooks/tier-gate.js`

Matchers are **anchored exacts**: `^Agent$`, `^Workflow$`, `^SendMessage$`
(r2 — a bare `Task` dispatch tool does not exist in current Claude Code;
an unanchored `Task` regex would catch `TaskCreate`/`TaskUpdate`).

**Route record (r2 — per-session):**
`<git-common-dir>/orch/route-<sessionId>.json`, atomic write:

```json
{ "lane": "G142", "domains": ["numerics", "hmi"],
  "worklog": "tmp/worklogs/G142-HDS.md",
  "repo": "<toplevel path>", "contractRevision": 7,
  "routedAt": "<iso>" }
```

Written by phase route (the skill instructs domains must equal the
BRIEF's `domains:` line), rewritten on re-route, deleted on lane merge.
Concurrent sessions each own their file; the hook reads only the record
matching the payload's `session_id`. **No floors stored**: the hook
recomputes floors from the locked contract for the named domains and
takes the highest. A mis-named domain in the record can still lower the
computed floor — that record is agent-written, so the tier gate's status
is **ADVISORY overall, ENFORCED for the requested-model-vs-floor
comparison given the routed domains**.

**Stale-route rejection (r3):** the record's `contractRevision` is
compared against the contract's live `version` on every tier-gate check,
not just recorded for audit. A mismatch — the contract was edited
(domain renamed, removed, or its `tiers` block changed) after this
session routed — → BLOCK "contract changed since route; re-route
(`/orch:go` phase route) before dispatching." This closes the case where
a post-route contract edit silently drops a domain's floor to none.

Checks on `Agent` dispatch while this session's record exists and any
matched domain has `tiers`:

- `model` param required — missing/unknown → BLOCK "name the model
  explicitly." Guarantee covers the **requested** model only (runtime
  substitution out of scope, documented).
- requested model → rank via locked `models`; rank < work floor → BLOCK.
- `Workflow` (r2): the hook cannot see per-stage models AND one workflow
  may run up to 16 concurrent agents — on a routed lane, Workflow is
  refused unless the work floor is `low` **and** `fleet.capacity ≥ 16`.
  The spec states this plainly: with the default capacity 6, Workflow is
  unavailable on routed lanes; raising capacity is the operator's call.
- `SendMessage` (r5 — four explicit rows, resolves r4's row-1-vs-prose
  contradiction; `residentFloor` validation happens *before* the global
  tierGate-false early return, as its own dependency check, not after
  it): the roster that stores each resident's granted rank doesn't ship
  until v0.9.0 (§3.1). This hook validates `enforcement.residentFloor`
  first, independent of `tierGate`, because an operator can set it via
  manual lock editing even when `/orch:setup` normally wouldn't:

  | `residentFloor` | `tierGate` | Behavior |
  |---|---|---|
  | `true` | `false`/absent | **invalid config** — `residentFloor` without `tierGate` is meaningless (no routed lane to check a floor against); fails closed exactly as row 3 below (outright block), never row 1's ALLOW. Logged as a config warning. |
  | `false`/absent | `false` | not an orch-routed enforcement session — ALLOW (today's behavior). |
  | `false`/absent | `true` | routed lane, any matched domain has `tiers` → `SendMessage` to a background agent is BLOCKED outright: "resident coordination unavailable on tiered routes until the roster ships; use a throwaway `Agent` call instead." |
  | `true` | `true` | roster's spawn-time rank applies — `SendMessage` to a roster-known resident whose rank is below the session's current work floor → BLOCK "resident under-tiered for this route; spawn at floor." |

  `/orch:setup` refuses to *write* `residentFloor: true` unless
  `tierGate: true` is already set and the roster-producing hooks (v0.9)
  are installed — row 1 exists only to fail closed on a manually-edited
  lock, not as a normal path. This closes the re-brief bypass without
  claiming enforcement the system can't yet perform.
- No route record for this session → ALLOW (not an orch-routed session).

Fleet ceiling (**r4 — atomic reserve is now the only capacity path,
replacing r2's accepted TOCTOU overshoot**): reservation and the
capacity check are the same lockfile-serialized read-modify-write
described in §3.1 — `count ≥ fleet.capacity` refuses the reservation
outright rather than reserving and discovering overshoot after the
fact, so there is no window left for two concurrent sessions to both
observe capacity and both proceed. BLOCK "park or tear down first" on
refusal. No roster file → no-op (activates at v0.9.0).

### 2.2 PR gate — extend `hooks/contract-ship-gate.js`

`gh pr create` is a **push-rank ship action**: any touched domain with
`ship: none|commit` blocks PR creation. Accepted grammar (r6 — `--base`
now permitted, see Commit-range resolution below for why): plain
`gh pr create` with only message/title/body/draft/label flags, plus an
optional `--base <local-ref>`; `--head`/`--repo`/fork forms and any flag
the parser doesn't recognize → fail closed with "operator runs
cross-target PRs." Implicit push offers are refused: push first, then
PR.

**Commit-range resolution (r7 — precedence order verified against
`gh pr create --help` directly, r6 had it backwards):** confirmed
locally (`gh` 2.x, `gh pr create --help`): *"The base branch for the
created PR can be specified using the `--base` flag. If not provided,
the value of `gh-merge-base` git branch config will be used. If not
configured, the repository's default branch will be used."* — i.e.
`--base` > `branch.<name>.gh-merge-base` > server-resolved default, in
that order, not the reverse. r6 checked `gh-merge-base` before `--base`.
The third tier (repository default) is resolved by `gh` itself via a
live API call — genuinely unobservable locally without a network call
of the hook's own, which the threat model forbids. r7's resolution: ①
explicit `--base <ref>` on the command line (accepted grammar, §
above) — use it directly, skip config entirely, since it's what `gh`
will use regardless of any config. ② no `--base` → `git config
branch.<current>.gh-merge-base` if set — the exact value `gh` then
consults. ③ neither present → BLOCK "cannot resolve PR target locally —
pass `--base <ref>`, or set `branch.<current>.gh-merge-base` (e.g. via
`gh repo set-default`)." — the hook does not attempt to guess the
server-resolved default from a local cache, since r6's `origin/HEAD`
approximation is confirmed unreliable and no local value is
authoritative for that tier. `--base <ref>` is validated to resolve
locally before use. head = `HEAD` on the current branch. Range =
`merge-base(<resolved base>, HEAD)..HEAD`; merge-base failing → BLOCK
the same way. No fallback to `staged ∪ dirty`, no network call from the
hook itself. Tested against `gh-merge-base` set to a non-default
branch, and against an explicit `--base` overriding it.

**Range bound (r6 — the scan itself was unbounded, a threat-model
violation on its own: an oversized range can exceed the 10s hook budget
and let the PR command through unblocked; r6's fix still called plain
`rev-list --count`, which must fully traverse the range before it can
compare against the cap — verified locally: `--count` alone walks
everything, while `git rev-list --max-count=N <range>` returns after
exactly N regardless of total range size):** `git rev-list
--max-count=<prGate.maxRangeCommits + 1> <range> | wc -l` — this bounds
the traversal itself, not just the reported number; result over
`prGate.maxRangeCommits` (default 500) → BLOCK "PR range exceeds
`prGate.maxRangeCommits` commits — rebase/squash, or raise the limit
deliberately." Both `prGate.maxRangeCommits` and `prGate.scanTimeoutMs`
live in the repo-scoped lock bundle (§1, "Lock scope"), not merged
project config — an agent raising them from the project side has no
effect, closing the gap where a config-controlled ceiling could be
self-raised to defeat its own purpose. The subsequent tail-commit and
GATE-block scan runs under its own subprocess deadline
(`prGate.scanTimeoutMs`, default 3000ms, well inside the 10s hook
budget) — deadline exceeded → BLOCK "evidence scan timed out," never
ALLOW-on-timeout.

**Lane binding (r5 — cross-checked against the route record, r4's
branch-name-only source let a mis-named branch bind evidence to the
wrong lane):** the *expected* lane comes from **two independent
sources that must agree**, not the branch name alone: (a) the current
branch name is required to carry the lane as its first path segment
(`G142/<slug>`, enforced by the same ship phase that writes commits — a
branch not shaped this way cannot reach `gh pr create` under the
contract at all, BLOCK "branch must start with the lane, e.g.
`G142/...`"), and (b) this session's route record (§2.1) has a `lane`
field written at route time, independent of and prior to any branch
name choice. `gh pr create` → BLOCK "branch lane `G<n>` does not match
routed lane `G<m>`" if (a) and (b) disagree, or if no route record
exists for this session. Only once both agree does the hook proceed to
the GATE scan. The ship phase then appends `<!-- orch-lane:G142 -->` as
the last line of the GATE block (same HTML-comment marker style as §4's
issue identity) at evidence-commit time — this is normative and now included
in the GATE grammar shown under Evidence protocol below. **Selection
(r6 — one definition, not two: this is the *only* place "latest GATE"
is defined; § Evidence protocol's step 3 below defers to it instead of
independently saying "the last GATE block," which r5 left as a second,
conflicting rule keyed on commit-DAG order instead of file position):**
the hook reads the lane's worklog **from HEAD's tree** (not the working
copy — matches Evidence protocol's existing rule) and finds the last
`GATE:` block in that file, by byte position, whose `orch-lane` marker
matches the agreed expected lane — file position is well-ordered and
requires no commit-DAG reasoning, unlike "latest in the range." Zero
such block → BLOCK "no GATE for lane `G<n>` in the worklog." Found →
that single block is validated against §"Evidence protocol"'s
`subject:`-ancestor and evidence-only-tail checks; a **multiple-blocks
in the range** situation (r5's original concern — a review-fix cycle
adds another evidence commit) is not a selection problem at all under
this rule, since file position always names exactly one "last" block —
earlier matching blocks remain in the worklog as history and are simply
not the one checked. A marker mismatching the agreed expected lane is
never trusted on its own, at any position.

**Evidence protocol (r2 — commit-bound, two commits):**

1. Work commits land (plain index commits — see §2.3).
2. Ship phase writes the GATE block into the worklog, subject-bound to
   the last work commit, and commits the worklog (plus BOARD.md until
   v0.10; from v0.10 the board lives on GitHub, §4) — the "evidence
   commit":

```
GATE: subject:<code commit SHA>
regression: <suite verdict ref>
metric:     <before → after vs noise band>
rootcause:  <ruling/ADR ref>
<!-- orch-lane:G142 -->
```

3. At `gh pr create`, the hook reads the worklog **from HEAD's tree**
   (not the working copy) and selects the block per §2.2's Lane binding
   "Selection" rule (r7 — this step previously restated its own "last
   GATE block" rule, which drifted out of sync with Selection across
   r5/r6; there is now exactly one selection rule, defined once, and
   this step only applies it), then verifies: `subject:` is an ancestor
   of HEAD · every commit after `subject` touches only worklog/board/ADR
   paths (evidence-only tail) · all three legs non-empty. Any miss →
   BLOCK naming the leg or the stray commit.

Status: **ENFORCED** for the commit-topology checks; the legs' *truth*
is **ADVISORY** (agent-written worklog — sloppy-agent model).

### 2.3 Evidence-lint — inside `contract-ship-gate.js`'s commit path

(r2 — bound to the actual commit set:) On a commit that flips a
BOARD.md row to `merged` (v0.8–v0.9; from v0.10 the trigger is the
`close-goal` verb, see §4 "Evidence-before-done" — the commit-tree
machinery below stays for the pre-v0.10 window and is otherwise
unchanged), the evidence must be **in the same commit**:
the check runs against the exact staged index (`git diff --cached`;
pathspec commits resolved from the command line), not `staged ∪ dirty`.
A staged merged-flip without a staged worklog ledger line or an artifact
path in the row → BLOCK. Commits with `-a`/pathspec forms that the
parser cannot resolve to a definite set → BLOCK "stage explicitly."

**Tree correctness (r4 — exact `-a`/pathspec semantics, r3's "full
working tree for `-a`" was wrong):** the check must inspect the tree the
commit will actually produce, built with a **temporary index**, never a
literal working-tree snapshot (which wrongly includes untracked files
and wrongly excludes intentionally-unstaged deletions' interaction with
mode changes):

- Plain `git commit` (no pathspec, no `-a`): the real staged index IS
  the would-be tree — `git diff --cached` / `git write-tree` on it is
  exact.
- `git commit -a`: clone the current index into a temp index, then apply
  to that clone exactly what `-a` applies — modifications and deletions
  of **already-tracked** paths, taken from the working tree (mode
  changes included) — leaving already-staged additions and untracked
  files untouched (untracked files are never included; new files must
  already be staged). Run `write-tree` on the temp index and diff that
  against `HEAD`.
- `git commit <pathspec>` (r6 — overlay source is the working tree, not
  the index; r5 still read a matched-and-staged path's *staged blob*,
  which can differ from its current working-tree content if the file
  was edited again after staging): build the temp index from **`HEAD`'s
  tree**, not the current index — `git commit <pathspec>` commits only
  the named paths' changes on top of HEAD, regardless of what else is
  staged. Overlay only paths matched by the pathspec **that are already
  known to git** (tracked in HEAD or already staged) — r7 correction,
  verified against real git: r6 claimed a pathspec implicitly adds a
  matched untracked file; local testing shows the opposite. A bare
  pathspec naming only an untracked path makes `git commit` **error
  outright** ("did not match any file(s) known to git") — no commit
  lands, so evidence-lint never runs against it. A directory pathspec
  matching a mix of tracked and untracked paths **succeeds silently**,
  committing only the tracked matches and leaving untracked ones
  untouched and still untracked — confirmed with a tracked `BOARD.md`
  flip plus an untracked evidence file both under a committed directory
  pathspec: the commit landed with only the tracked change, the
  untracked evidence file was never in the tree. So: for each
  git-known matched path, overlay from **current working-tree content**
  (mode included) — tracked-modified, tracked-deleted (removed from the
  temp index), or already-staged; never from the index alone, since a
  matched path's staged blob can be stale relative to a later unstaged
  edit. Any pathspec match that is untracked is **excluded** from the
  temp index, exactly as real git excludes it from the actual commit —
  this is what makes the check correct: if the evidence file is
  untracked at commit time, the reconstructed tree correctly shows it
  absent, and evidence-lint BLOCKs the merged-flip for lacking evidence,
  matching what actually landed. Every unmatched path, staged or not, is
  left exactly as it is in `HEAD`. Then `write-tree` and diff against
  `HEAD`. Fixtures: (a) stage an evidence edit, make a further unstaged
  edit to the same tracked path, pathspec-commit it — must see the
  unstaged content, not the stale staged blob; (b) directory pathspec
  covering a tracked merged-flip plus an untracked evidence file — must
  BLOCK, since the untracked evidence never lands.
- Pathspec cannot be resolved to a definite, unambiguous file set (glob
  expansion depends on shell state the hook can't observe, e.g. an
  unquoted pattern) → BLOCK "stage explicitly," never fall back to
  index-only comparison.

**Lane-bound, newly-added evidence (r3):** the ledger line or artifact
path must (a) name the row's own lane (`C<n>`) and (b) be new in this
commit's diff — an added line, not merely present from an earlier
commit. A stale reference, or one lifted from another lane's row, no
longer satisfies the check.

Status: **ENFORCED\*** for presence-in-commit on a direct, unwrapped
`git commit` — the shared wrapper/alias/native-API caveat applies here
exactly as it does to every other row in the status table (§ Status
table), not as a special case; this row is not more or less bypassable
than destructive-git or process-kill, so it carries the same label.
Evidence *truth* stays **ADVISORY** as before (agent-written content).

### 2.4 Guard locks

**No weakening:** everything `block-destructive-git.js` blocks today
stays blocked by default — stash mutation, force-push (with-lease
included), `reset --hard` unconditionally. New, **opt-in**, in
`hooks/block-destructive-ops.js`: name-scoped process kills
(`taskkill /im`, `Stop-Process -Name`). Status (r4 — matches the status
table's single taxonomy, not a special case): **ENFORCED\*** for direct
shell syntax, same shared wrapper/alias/native-API caveat as every other
command-interception row.

## 3. Coordination — fleet roster + vehicles

### 3.1 Fleet roster — `<git-common-dir>/orch/fleet.json`

Current-state roster; history lives in the audit log (gains
dispatch/teardown/rebrief entries).

```json
{ "delegates": [ {
  "name": "impl-G142", "lane": "G142", "role": "mid", "vehicle": "native",
  "status": "reserved|running|done|failed|torn-down|expired|rejected",
  "ownerSessionId": "<id>", "agentId": "<runtime id, bound at start>",
  "brief": "tmp/worklogs/G142-HDS.md#brief-4",
  "createdAt": "<iso>", "lastSeen": "<iso>" } ] }
```

(r5 — `status` union completed: `reserved` is the PreToolUse-created
state before `SubagentStart` binds `agentId`; `expired` and `rejected`
from the late-bind rule below are first-class states, not an
undocumented side channel. The **counted-status predicate** used for
`count ≥ fleet.capacity` is exactly `{reserved, running}` — `expired`,
`rejected`, `done`, `failed`, and `torn-down` never count against
capacity.)

- **Concurrency (r7 — PID+start-time liveness gate replaces the fake
  CAS, r6's claimed "compare-and-swap on fence" was not actually atomic:
  ordinary filesystem compare-then-rename has a window between the
  compare and the rename where a takeover can land, and the displaced
  writer's stale-fence write can still slip through in that window; per
  the stated single-host threat model, real distributed consensus is
  unneeded — a correctly non-stealable OS lock is sufficient and
  simpler):** read-modify-write serialized by an exclusive lockfile
  (`O_EXCL` create, bounded retry) containing `{ownerPid, ownerStartTime}`
  — the owning process's PID plus its OS-reported start time, which
  together disambiguate a live process from a dead one whose PID was
  reused (a bare PID check alone cannot). Stale-lock takeover after 30s
  first re-checks liveness: query the OS for a process matching
  `ownerPid` **and** `ownerStartTime` — found and alive → the owner is
  not stale regardless of elapsed time, and takeover is refused
  (bounded, escalating wait instead); not found, or found but with a
  different start time (PID reused by an unrelated process) → the owner
  is genuinely dead, takeover proceeds immediately by deleting and
  recreating the lockfile (`O_EXCL` on the new file is itself the
  atomicity guarantee — no separate CAS mechanism needed). This
  eliminates the race by construction: a live owner's lock is never
  stolen, so there is never a "displaced writer" racing a replacement.
  A lost write from a crash mid-operation (owner dies holding the lock,
  a later reservation waits out the liveness-refused window until
  takeover) is still possible and remains **ADVISORY** per the roster
  state's existing status — this is unrelated to the takeover race,
  which is what this fix closes. Located in the git common dir so all
  worktrees share it.
- **Lifecycle producers (r2):** entry created at `Agent` PreToolUse
  (reservation); `agentId` bound and `lastSeen` initialized by the
  `SubagentStart` hook event; `lastSeen` refreshed and terminal status
  set by `SubagentStop`; session-end hook marks the session's residents
  `torn-down`. Liveness is **stale-heartbeat inference**, never a
  definitive oracle: `running` + `lastSeen` older than
  `fleet.staleMinutes` (default 60) renders as ghost; `/orch:go` step 1
  offers to prune ghosts, and prunes terminal entries when their lane
  merges.
- **Reservation rollback and late-bind (r4):** the `Agent` PreToolUse
  reservation increments the roster count as a precondition of allowing
  dispatch, checked and written atomically under this lockfile —
  refusing outright (never reserving past) `count ≥ fleet.capacity`;
  this is the sole capacity path (§2.1's fleet ceiling defers to it, no
  separate re-check). A reservation that never gets `agentId` bound
  within `fleet.reservationTimeoutMinutes` (default 5) — the tool was
  denied downstream or the agent crashed before `SubagentStart` — is
  treated **`expired`** (not deleted) and excluded from the capacity
  count on the next roster read. If `SubagentStart` arrives late for an
  already-`expired` entry, it must atomically re-reserve (re-check
  `count ≥ fleet.capacity` under the same lock) before binding
  `agentId`; capacity unavailable at that point → the hook records the
  entry `rejected` and the late-starting agent is torn down rather than
  left running untracked over capacity.
- Status: **ADVISORY** state (a lost concurrent update is possible; the
  audit log keeps both events).

### 3.2 Vehicles — `workflow.coordinator: "native" | "herdr"` (default native)

| Work shape | native | herdr |
|---|---|---|
| one-shot | `Agent` throwaway | same |
| resident | background `Agent` + `SendMessage`, worklog as memory | herdr pane (`impl-G<n>`) |
| DAG fan-out | `Workflow` — only with floor `low` AND capacity ≥ 16 (§2.1) | falls back to native |

Herdr delegates register with `vehicle: "herdr"`; herdr launches go
through the shell and bypass the tier gate (**documented, ADVISORY**).
What the herdr vehicle could grow into — role panes (Coordinator /
Architect / Dev / Reviewer), file-carried handoffs and reviews,
role-scoped guardrails — is brainstormed in
`2026-09-04-herdr-five-role-orchestration.md` (not yet design).
Vehicle adapter contract: {runtime id, context/transcript reader or
`null`, status probe, teardown op}; herdr's context reader is `null`.

### 3.3 Config keys

`fleet.capacity` (ceiling, default 6) and `fleet.staleMinutes` — distinct
from the existing `fleetContext.maxAgents` (polling width, default 12,
unchanged). The roster is an **additional** source for
`fleet-context.js` (native entries resolve transcripts via `agentId`);
its existing discovery scan stays.

### 3.4 Waits & escalation — unchanged

Task notifications + the existing fix-loop ladder. `/orch:board` gains a
`FLEET` footer from the roster; ghosts flagged.

## 4. Board on GitHub (r8 — replaces r1–r7's one-way mirror)

GitHub is the board. There is no file. "Truth = issues; nobody moves
cards by hand" — the same convention the operator already runs on the
`istart-dev/Pertasim` project (Pipeline × Milestone; Status; issues are
the record). One Project per repo, same shape, never Pertasim itself.
Status: **ADVISORY** end-to-end (external service; the board script is
an agent-invoked CLI, not a gate hook, so the threat model's
no-network rule for hooks does not apply to it).

### 4.1 Data model (r8b — three levels, matching Pertasim as it is used)

Pertasim's milestones (`C1 SHU-HDS operable`, 60 issues; `C2 …`;
`C3 …`; `backlog` = "not scheduled") are the top level. A `/orch:goal`
BRIEF with its 3–7 route items is not that — it is a **goal inside a
milestone**. orch adopts GitHub's word (r8d — operator's call: "call it
milestone in orch"). Hence:

```
Milestone  = GitHub Milestone "C<n> …"   operator-owned; orch NEVER creates one
  └ Goal   = Issue, label orch:goal      /orch:goal output; BRIEF in the body
      └ Item = sub-issue of the goal      route items, incl. YOU items
             gate: <LABEL>                the item whose completion closes the goal
                                          (was `milestone: <LABEL>` — renamed to
                                          avoid two meanings of "milestone")
```

| orch concept | GitHub object | identity / how |
|---|---|---|
| milestone | pre-existing **Milestone**; `backlog` when none fits | `/orch:goal` asks once which open `C<n>` milestone; never creates |
| goal (was "campaign"/lane) | **Issue** with label `orch:goal`, in that milestone, on the Project | lane id = **`G<issue#>`** (unique, never reused, links to GitHub); BRIEF is the issue body; title = `<name>` |
| route item | **sub-issue** of the goal, same milestone, on the Project | body's last line `<!-- orch-item -->`; label `orch:item` |
| `YOU` item | sub-issue assigned to the owner login, label `orch:you` (+ `orch:item`) | no special lane — rendered as the YOU track across goals |
| bucket (`Now`/`Next`/`Later`) | the Project's existing **`Priority`** single-select on the item | r8c — no new field, no labels: the operator renames Pertasim's `P0/P1/P2` → `Now/Next/Later` once in the UI (option IDs survive, 150 items keep their value); `init` reads whatever options the field has and they ARE the buckets, in field order; `add-item --bucket <option>` |
| track | `Pipeline` single-select on the item | pass-through: `--pipeline <existing option>` (and optional `--feature <existing option>`); `init` creates `Pipeline` from contract domains **only when the field is absent**, never edits an existing one |
| `-> outcome`, `gate:` | body lines `outcome: …`, `gate: <LABEL>` | rendered as today's `= LABEL ✅` |
| blocker | label `orch:blocked` **+** comment `blocked: <text> · owner: <who>` on the item | `clear-blocker` removes the label, comments `unblocked` |
| `needs_attention` | label `orch:needs_attention` on the goal issue | ship phase, work ended without evidence |
| goal status | **derived**, never stored (fold below) | — |
| `Feature` | untouched unless `--feature` is passed | — |

**Redundancy check against Pertasim (r8c, 736 items profiled):** Status
= progress (all items), Priority = ordinal horizon after the rename,
Pipeline/Feature = area, Milestone = the top-level grouping; Start/Target date and
Iteration are unused/absent and stay that way — no schedule axis with
dates (operator's call: Priority is enough). Each field answers one
question; orch adds only labels and sub-issue links.

**Goal-status fold** — one GraphQL query lists every `orch:goal` issue
with its `subIssues` and project field values; per goal, first match:

1. goal issue closed → `merged`
2. any sub-issue `orch:blocked` → `blocked` (blocker = its latest `blocked:` comment)
3. goal has `orch:needs_attention` → `needs_attention`
4. any sub-issue Status `In review` → `review`
5. any sub-issue Status `In progress` → `running`
6. else → `ready`

Nothing is stored twice; `/orch:go`'s phase table reads the fold.
Stale detection (`board.staleDays`) uses each issue's `updatedAt`.
The Project's own `Sub-issues progress` field shows completion for free.

**Lane grammar everywhere else in this spec (§2.1 route record, §2.2
branch prefix and `orch-lane` marker, worklog names):** goals are identified
as `G<issue#>` — `tmp/worklogs/G<n>-<name>.md`, branch `G<n>/<slug>`,
`<!-- orch-lane:G<n> -->`. `C<n>` is reserved for milestone titles.

**Evidence-before-done:** `close-goal` refuses unless (a) every
sub-issue is `Done`/closed and (b) an `evidence:` comment naming
`G<n>` lands on the goal issue first (hard predecessor, r6 rule). §2.3's
evidence-lint at v0.10: the ship-gate hook matches a Bash invocation of
`board-gh.js close-goal G<n>` and requires, from **HEAD's tree** (git
only, no network), a ledger line naming `G<n>` in
`tmp/worklogs/G<n>-*.md`. Script check is ADVISORY; hook check is
ENFORCED\* for presence.

### 4.2 Config and init

`.orch/board.json` (r8b — JSON, not YAML: no YAML dependency exists
and stdlib parses JSON), committed:

```json
{ "owner": "istart-dev", "repo": "i-Start", "projectOwner": "istart-dev",
  "projectNumber": 1, "projectId": "PVT_…",
  "fieldIds":  { "status": "PVTSSF_…", "priority": "PVTSSF_…", "pipeline": "PVTSSF_…", "feature": "PVTSSF_…"|null },
  "optionIds": { "status":   { "Todo": "…", "In progress": "…", "In review": "…", "Done": "…" },
                 "priority": { "Now": "…", "Next": "…", "Later": "…" },
                 "pipeline": { "Authoring": "…", "Engine": "…", "Session": "…", "Infra/Data": "…" },
                 "feature":  { … } } }
```
`buckets` = the keys of `optionIds.priority`, in field order — not a
separate key.

`/orch:board init [--project <number>] [--owner <login>] [--dry-run]`,
idempotent. `--project N` **adopts** an existing Project (Pertasim is
`--project 1` under `istart-dev`); without it, find-or-create the
Project titled `<repo> · orch board`. Then: ensure the four `Status`
options exist; require a `Priority` single-select with ≥ 1 option
(absent → create it with `Now/Next/Later`; present → read as-is, never
rename — the rename is the operator's UI step); `Pipeline` as above;
create labels `orch:goal orch:item orch:you orch:blocked
orch:needs_attention`; write the json. `--dry-run` prints every
intended call and writes nothing. **No silent creation anywhere:**
every other verb refuses with "run `/orch:board init`" when the yml is
missing or its IDs don't resolve. **Authority:** `board.github` from the
**lock file only** (§1 Lock scope) gates whether the GitHub-backed verbs
run at all; project copy is documentation.

### 4.3 Write path — `scripts/board-gh.js`

Verbs: `init · milestones · add-goal · add-item · move · set-status ·
set-blocker · clear-blocker · done · close-goal · read`. Auth = the
operator's own `gh` CLI login; calls are `gh api` (REST + GraphQL) with
argument-array process execution, never shell strings. `milestones`
lists open milestones (`C<n>` first, then `backlog`) — read-only, used
by `/orch:goal`'s one question.

Every mutating verb runs: **repo lock** (§3.1's `O_EXCL` lockfile,
PID+start-time liveness, shared with the roster) → for each sub-effect:
journal intent → GitHub call → journal done. The journal is
`<common-dir>/orch/board-journal.jsonl`; its rules are r6's verbatim —
`{opId, lane, subEffect, desired, status:"intent"}` fsynced **before**
the call; `{opId, subEffect, status:"done", remoteId}` fsynced after;
torn final line treated as absent; `opId` embedded as an HTML comment
in every posted comment as the remote-observable idempotency key.
Sub-effect decomposition:

| verb | sub-effects (ordered) | reconcile-on-resume probe |
|---|---|---|
| `add-goal <milestone#\|backlog> "<name>" --brief <file>` | create goal issue (BRIEF body, `orch:goal`, milestone) · add to project · set Status `Todo` | goal by `orch:goal` + exact title within milestone, open; project item by issue id; field value |
| `add-item G<n> "<text>" [--bucket <Priority option>] [--pipeline <opt>] [--feature <opt>] [--outcome …] [--gate LABEL] [--you]` | create issue (body+labels+milestone) · add sub-issue to goal · add to project · set Status `Todo` · set Priority (default: first option) · set Pipeline/Feature if given | issue by `<!-- orch-item -->` + title among the goal's sub-issues; parent link present; project item; field values |
| `move <issue#> <Priority option>` | set Priority field | field value |
| `set-status` | set Status field · comment | field value; comment by `opId` |
| `set-blocker` | add `orch:blocked` · comment | label present; comment by `opId` |
| `clear-blocker` | comment `unblocked` · remove `orch:blocked` | comment by `opId`; label absent |
| `done` | set Status `Done` · close issue | field value; issue state |
| `close-goal G<n> --evidence "…"` | `evidence:` comment on the goal issue · set goal Status `Done` · close goal issue | comment by `opId` **must be observed done before** close runs (r6 hard-predecessor rule); field; state |

Label reconciliation touches only the `orch:*` namespace (r6 rule
kept). Duplicate identity matches → STOP, mutate nothing. Cross-clone
duplicates remain possible and documented — the lock serializes one
clone.

**Failure:** any GitHub call failing (network, 4xx/5xx, secondary rate
limit) → retry 3× with 2/4/8 s backoff → exit non-zero with the journal
left at `intent`. The calling skill step **fails**; nothing is queued,
nothing is retried in the background. The next invocation of any verb
first replays pending intents (reconciliation above) before doing new
work.

`read [--goal G<n>] [--json]` is the single read path: one query,
outputs `{goals:[{lane:"G142", name, milestone:{number,title}|null,
status, blocker, brief, items:[{issue, bucket, pipeline, feature,
status, text, outcome, gate, done, you, updated}]}], buckets}` where
`bucket` is the item's Priority option name and `buckets` the field's
options in order. `/orch:go` step 1 and `/orch:board` consume this and
nothing else; `board-html.js` takes the same JSON in place of
`docs/BOARD.md`. Goals are ordered by milestone number (none last),
then goal issue number.

### 4.4 Skill changes

- `/orch:goal` Register: `milestones` → ask once which milestone (or
  `backlog`) → `add-goal <milestone#> "<name>" --brief <worklog>` prints
  `G<n>`; worklog is then renamed to `tmp/worklogs/G<n>-<name>.md`
  (the BRIEF is written before the number exists) → one `add-item` per
  BRIEF step (owner steps → `--you`, `--bucket` from the BRIEF's
  ordering: first steps `Now`, the rest `Next`).
- `/orch:go`: step 1 reads `board-gh read`; focus = one **goal** per
  session; "legacy unnumbered rows" write disappears; phase ship =
  `done` per item, commit the worklog, then `close-goal G<n>
  --evidence …`; route record (§2.1) carries `lane: "G142"`.
- `/orch:board`: same ASCII layout (goal tracks grouped under their
  milestone header, YOU track last) from `read` JSON; `html` unchanged
  in output; `init` is its one write verb (announced).
- ship-gate: evidence-lint gains the `close-goal` match (4.1); branch
  prefix rule reads `G<n>/`. `/orch:setup` v0.10 step = run `init`,
  delete `docs/BOARD.md` if present (no import).

## Sequencing, migration & releases

**Activation switch (r3 — decouples data schema from enforcement date):**
r2's rule made `contract.schemaVersion == 2` do double duty as both "the
contract data has tiers" and "hooks now enforce" — since v0.7 ships
`schemaVersion` before v0.8's route records, GATE grammar, and migration
preview exist, upgrading a repo straight to v0.7 would arm enforcement
with none of its supporting machinery in place. r3 splits the two:

- `contract.schemaVersion: 2` marks the contract's **data shape** only
  (tiers/models present) — it ships in v0.7 and by itself changes no
  hook behavior. **One named exception (r7 — was contradicted by the
  "zero behavior change" claim elsewhere in this section):** §1's lock
  failure semantics (already specified, r2) flips existing guards
  (destructive-git included) from fail-open to fail-closed on a
  *corrupt* lock — this is a real, intentional behavior change that
  ships in v0.7 alongside the schema work, not deferred to v0.8's
  `enforcement.*` flags, because it's a bug fix (a corrupt lock silently
  disabling a guard is never correct) rather than new enforcement.
  Every v0.7 install is unchanged for the overwhelmingly common case (no
  lock, or a valid lock) — the only behavior delta is a repo whose lock
  file was already corrupt, which now blocks instead of silently
  degrading. `/orch:setup`'s v0.7 step validates the lock and offers
  repair before this can surprise anyone; CHANGELOG documents the break
  explicitly.
- A separate, lock-file-only (never project-writable) set of booleans —
  `enforcement.tierGate`, `enforcement.prGate`, `enforcement.evidenceLint`
  — is what each v0.8 hook actually checks before enforcing anything.
  All default `false`. `/orch:setup`'s v0.8 migration step is the only
  place that offers to flip them, and only after running the migration
  preview (which lanes lack markers, which worklogs lack GATE blocks) as
  a precondition; in-flight lanes are re-routed (cheap: one route phase)
  as part of that same checklist.
- `enforcement.residentFloor` is a **fourth, later** flag: `/orch:setup`
  may only offer it once the roster-producing hooks (v0.9) are actually
  installed, so `SendMessage` rank-gating cannot be switched on before
  its data source exists — closing the v0.8/v0.9 sequencing gap
  directly (§2.1's SendMessage entry).
- A hook that finds its flag `true` but the state it needs is absent or
  malformed (no lock, corrupt lock, unsupported `schemaVersion` — see §1)
  fails **closed**.

| Release | Ships |
|---|---|
| v0.7.0 | Contract v2 data shape: `schemaVersion`, lock bundle + failure semantics, setup interview, docs. No `enforcement.*` flags exist yet, so no *new* enforcement — the one exception is the named, intentional lock-corruption fail-closed fix above, not a "zero behavior change" release. |
| v0.8.0 | tier-gate (Agent/Workflow), PR gate + evidence protocol, evidence-lint, guard additions — each gated by its own `enforcement.*` flag (default false), offered by `/orch:setup` after the migration preview. `SendMessage` is blocked outright on tiered routes (no roster yet, see §2.1) rather than rank-checked. GATE/marker grammar in go skill. |
| v0.9.0 | fleet roster + lifecycle hooks, vehicles, fleet-context integration, FLEET footer, `enforcement.residentFloor` (offered only now that roster hooks exist) — this is what turns `SendMessage` rank-checking on. |
| v0.10.0 | board on GitHub: `board-gh.js` (init/milestones/add-goal/add-item/move/set/done/close-goal/read + journal), `.orch/board.json`, `board.github` lock key, goal/go/board skills re-pointed, lane id `G<issue#>`, `docs/BOARD.md` retired, evidence-lint `close-goal` match |

## Status table (r3)

One taxonomy rule, applied uniformly (r2's table applied it
inconsistently — e.g. process-kill was ADVISORY for a wrapper-bypass
that destructive-git shared but was marked ENFORCED* for; evidence-lint
claimed "no known bypass" while the Testing section names a bypass test
for it): **every mechanism that intercepts a command is ENFORCED\* for
the exact, narrowly-stated comparison it makes on a direct, unwrapped
invocation, with the same wrapper/alias/native-API caveat — named once
here, not re-derived per row.** ADVISORY marks mechanisms whose
correctness additionally depends on agent-written state (a route
record, a worklog, a roster entry) that a sloppy agent can get wrong
without evading anything.

| Mechanism | Status | Verified input | Known bypass |
|---|---|---|---|
| tier floor vs requested model (direct comparison) | ENFORCED* | locked contract+models, tool_input.model | wrapper/alias invocation (shared caveat) |
| tier gate, end-to-end (routing correctness) | ADVISORY | route record (agent-written) | mis-routed domains, stale `contractRevision` pre-r3, herdr, runtime substitution |
| Workflow refusal on tiered routes | ENFORCED* | locked config, capacity | herdr; wrapper/alias invocation |
| SendMessage resident floor | v0.8: N/A (blocked outright, no roster) · v0.9+: ADVISORY | roster rank at spawn | roster is agent-written state; herdr |
| fleet ceiling | ADVISORY | roster count | herdr (TOCTOU removed r4 — atomic reserve under §3.1's lockfile is the sole capacity path) |
| PR gate: ship rank, commit topology | ENFORCED* | locked contract, git graph | wrapper/alias invocation (shared caveat) |
| GATE legs' truth | ADVISORY | agent-written worklog | invented refs |
| evidence-lint (presence in commit) | ENFORCED* | reconstructed commit tree (§2.3) | wrapper/alias invocation (shared caveat; documented test) |
| review floor | INSTRUCTED | — | any |
| destructive-git guards | ENFORCED* | command text | wrapper/alias invocation (shared caveat) |
| process-kill guards | ENFORCED* | command text | wrapper/alias/native-API invocation (shared caveat) |
| roster state | ADVISORY | lifecycle hooks | lost concurrent update |
| board on GitHub (state) | ADVISORY | journal + `orch-item` markers + labels | cross-clone race; GitHub outage fails the step |
| evidence-lint on `close-goal` (presence) | ENFORCED* | worklog at HEAD | wrapper/alias invocation (shared caveat) |

\* conditional on successful hook execution (see threat model) **and**
on the command reaching the hook directly — a wrapper script, shell
alias, or native API call that never triggers PreToolUse bypasses any
row marked ENFORCED\* the same way; this is one caveat, not twelve.

## Testing

Per-hook ALLOW/BLOCK fixture matrices, grammar contract tests, schema
round-trips, plus fault cases: two concurrent sessions (per-session
markers, roster lockfile, sync lock) · lockfile stale-takeover ·
atomic-write interruption · ghost delegates (no SubagentStop) ·
worktree common-dir resolution · omitted/unknown model params ·
Workflow-on-tiered-route at capacity 6 and 16 · SendMessage to
under-tiered resident · GATE subject not-ancestor / non-evidence tail
commit · `-a` and pathspec commits vs evidence-lint · corrupt lock and
partial lock bundle fail-closed (updating `tests/test-lock.js`) ·
hook-crash-→-exit-2 trap test · wrapper-command bypass
documented-not-blocked · duplicate GitHub issues → STOP · board journal
resume after simulated rate-limit (every verb's sub-effect table) ·
goal-status fold, all six outcomes · `init --dry-run` snapshot ·
missing/unresolvable `board.json` refuses every verb · `close-goal`
refused without evidence comment or with an open sub-issue · argument-array quoting · one live
smoke against a throwaway project under `istart-dev`. Every fail-closed
path gets a test proving it blocks.

## Review provenance

Codex (read-only, fresh context per round):
r1 REWORK (6C/10M/1m) → threat model chosen by operator (sloppy agent,
honest labels), full rework. r2 FAIL (4C/6M/1m on the rework; 9/17 r1
findings RESOLVED, 8 PARTIAL) → per-session route records, SendMessage
gating, commit-bound two-commit evidence protocol, hook-execution
conditionality, lock failure semantics, Workflow/capacity contradiction
stated, roster lockfile + lifecycle hooks, transactional sync journal,
schemaVersion activation switch, anchored matchers, status table.
r3 FAIL (6 Critical/6 High) → activation decoupled from `schemaVersion`
into lock-only `enforcement.*` flags introduced per release (fixes the
v0.7-pre-arms-v0.8 and SendMessage-before-roster sequencing bugs,
C1/C2); strict `schemaVersion` parsing, no v1 fall-through on malformed
values (C3); evidence-lint reconstructs the would-be commit tree for
`-a`/pathspec commits instead of trusting `git diff --cached` (C4);
route records now enforce `contractRevision`, not just record it (C5);
tier values validated fail-closed (C6); PR gate gets a defined
commit-range algorithm and a commit-carried lane marker (H1/H2); status
table relabeled to one consistent taxonomy (H3); roster reservations
roll back on denial/failure via a timeout (H4); board-sync journals
intent before the remote call for true crash-idempotent resume (H5);
merged-flip evidence must be lane-bound and newly-added in the commit,
not merely present (H6).
r4 FAIL (3 Critical/6 High) → this revision: lock file's
`{contract, models, enforcement}` bundle nests under `repos[<toplevel
path>]` instead of applying globally to every repo sharing the lock
file, with legacy single-repo auto-migration (C1); PR gate's base is now
the resolved default/target branch, not the feature branch's own
(post-push-equal-to-HEAD) tracking ref (C2); board-sync journal
reconciliation is action-typed (create/statusChange/close) with
`opId`-stamped remote comments, not existence-only (C3); §1's
`schemaVersion` bullet no longer calls itself an activation switch, and
a fixed 3-step evaluation order (flag → schemaVersion → data validity)
replaces the ambiguity (H1); PR lane binding now derives the expected
lane from a required `C<n>/...` branch-name prefix instead of trusting
an unverified marker alone, and the marker is now part of the normative
GATE grammar (H2); evidence-lint's `-a`/pathspec tree reconstruction
uses a temp-index algorithm matching real git semantics instead of "full
working tree" (H3); `SendMessage`'s `tierGate`×`residentFloor` behavior
is a full 3-row truth table, not two prose cases (H4); fleet-ceiling
TOCTOU-acceptance text removed — atomic reserve is now the sole capacity
path, with an explicit late-`SubagentStart` re-reservation rule (H5);
evidence-lint and process-kill guard prose now carry the same ENFORCED*
label the status table already gave them, instead of contradicting it
(H6).
r5 FAIL (4 Critical/8 High) → this revision: pathspec temp-index now
built from `HEAD`'s tree, not the current index, so unrelated staged
files no longer leak into the reconstructed commit (C1); lock repo key
switched from toplevel path to git common dir so linked worktrees share
one entry instead of silently missing enforcement, plus the full lock
schema enumerated (`fleet.*`, `boardSync.enabled` moved under the repo
entry) and legacy migration moved to an explicit, lockfile-serialized
`/orch:setup` step instead of an unsynchronized first-hook-read write
(C2); PR base resolution now mirrors `gh`'s own local-only target
precedence (`branch.<name>.gh-merge-base`, then cached
`origin/HEAD`) with the network-calling `gh repo view` fallback removed
entirely, restoring the threat model's no-network-calls invariant for
gate hooks (C3/C4); board-sync journal reconciliation now operates on
independently-idempotent sub-effects (open/label/comment/close) each
verified against live remote state via its own `opId`, not on whole
multi-effect actions (H1); `SendMessage`'s truth table is now 4 explicit
rows evaluated `residentFloor`-first, resolving the row-1-vs-prose
contradiction (H2); `schemaVersion` strict-parsing is now explicitly
scoped to run only after its hook's `enforcement.*` flag is already
`true`, so it can never block an unmigrated v0.7 install (H3); PR lane
binding now cross-checks the branch-derived lane against the session's
route-record lane before trusting either (H7 in that finding set);
exactly-one-GATE replaced with latest-GATE-wins supersession so a normal
review-fix-recommit cycle stays shippable (H8); the roster `status`
union now includes `reserved`/`expired`/`rejected` with an explicit
counted-status predicate, and the status table's stale TOCTOU line is
corrected.
r6 FAIL (4 Critical/7 High) → this revision (**final round per operator
cap**): flag-true schema handling now has one unconditional rule (BLOCK
on anything but exact schema 2, no schema-1 no-op branch once the flag
is true), removing the self-contradiction (C1); PR base resolution
drops the `origin/HEAD` fallback entirely — it doesn't reliably mirror
what `gh` actually uses — in favor of `gh-merge-base` or an explicit,
now-grammar-permitted `--base <ref>`, with no other guess (C2); the
`<pathspec>` tree-reconstruction overlay source is now always the
current working tree, never a matched-and-staged blob that can be stale
relative to a later unstaged edit (C3); the PR gate's commit-range scan
is now bounded (`prGate.maxRangeCommits`, `prGate.scanTimeoutMs`) so an
oversized range fails closed instead of risking the hook's own 10s
timeout (C4); the repo lock key now resolves via filesystem realpath
with filesystem-native case handling instead of unconditional
case-folding (H1); `board.sync.enabled` is corrected to the one true
spelling, `boardSync.enabled`, used consistently in both the lock-scope
schema and the Authority rule (H2); the sync journal fsyncs every intent
and completion record and defines torn-tail recovery on resume (H3);
`close`'s evidence-comment sub-effect is now a hard predecessor —
`close` cannot execute or be marked done while it's pending (H4); label
reconciliation is scoped to an `orch:`-namespaced label set, never
touching human-managed labels (H5); "latest GATE" now has exactly one
definition — last matching block by byte position in the worklog at
HEAD — replacing the conflicting commit-DAG-order rule (H6); roster
lockfile takeover is now fenced (monotonic counter, compare-and-swap on
write) so a live-but-slow writer can no longer be raced by its
replacement after a stale-takeover (H7).
r7 FAIL (3 Critical/4 High) → **operator's hard cap reached; no r8**.
The 3 criticals were each traced to an unverified claim about real
`git`/`gh` behavior, confirmed by Codex actually running the commands
rather than reading documentation — the signal that pure spec-text
iteration had hit its ceiling. Instead of an r8 prose round, each was
independently reproduced and fixed against ground truth: (1) **PR base
precedence** — `gh pr create --help` confirms `--base` flag > `branch.
<name>.gh-merge-base` config > server-resolved default, in that order;
r6 had checked config before the flag — corrected, and the flag-first
branch now uses the value directly instead of falling through. (2)
**Range-bound scan** — `git rev-list --count` was confirmed to require
a full traversal before it can be compared against a cap, while
`git rev-list --max-count=N` was confirmed (locally, on this repo) to
return after exactly N regardless of total range size — switched to
the latter; `prGate.maxRangeCommits`/`scanTimeoutMs` also moved into
the repo-scoped lock schema (they were never added, H5). (3) **Pathspec
tree reconstruction** — reproduced both cases locally: a bare pathspec
naming only an untracked path makes the entire `git commit` **error**
("did not match any file(s) known to git"), while a directory pathspec
matching a mix of tracked and untracked paths **succeeds silently**,
committing only the tracked matches; r6's claim that pathspec
implicitly adds untracked matches was false — corrected to exclude
untracked matches from the reconstructed tree entirely, which makes the
check correct (a directory-pathspec commit that silently drops an
untracked evidence file now correctly BLOCKs, matching what actually
landed). The 4 remaining highs were doc-only consistency fixes needing
no external verification: Evidence protocol step 3 now defers to the
single Selection rule instead of restating a second one (H4/H6 overlap
from r6); the roster lockfile's fake "fence CAS" (not actually atomic —
ordinary compare-then-rename has a race window) was replaced with a
non-stealable OS lock gated on PID+process-start-time liveness, which
the stated single-host threat model doesn't need distributed consensus
to solve (H7); v0.7's "zero behavior change" claim was corrected to
name its one intentional exception (the pre-existing lock-corruption
fail-closed fix) instead of contradicting it.

**This revision has not been re-run through Codex** — the fixes above
are believed-correct based on direct verification of the disputed
mechanisms, not an eighth adversarial pass. Before implementation,
treat this as "spec text now matches verified git/gh behavior for the
three previously-wrong mechanisms" rather than "PASS."
