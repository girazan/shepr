# 🎛️ orch

**You decide once which decisions are yours. The AI handles the rest — and
can't ship past the line you drew.**

You have intent and judgment, but only inside your specialty. Frontier AI
now thinks and judges too, but every model has a budget and a price. orch
splits work along both limits: you write down which domains are really
yours, and in the ones that aren't, a *second* AI — different model, fresh
conversation — stands in as the judge, because two independent readers beat
one human nodding at code they can't evaluate. Frontier plans and rules,
high-end reviews, mid-tier executes, cheap does the mechanical work.

*The map of who's specialized in what is the contract.*

## 📦 Install

```
/plugin marketplace add girazan/orch
/plugin install orch@orch
```

## 📜 The contract

One file, `.claude/orch.json`, at your repo root:

```json
"contract": {
  "version": 1,
  "domains": {
    "numerics": { "paths": ["src/Solver/**"],  "expertise": "physics, units — mine",
                  "decide": "human", "ship": "none" },
    "web-ui":   { "paths": ["src/Hmi.Web/**"], "decide": "ai", "ship": "push" },
    "tests":    { "paths": ["tests/**"],       "decide": "ai", "ship": "commit" }
  }
}
```

- A domain is a **territory of expertise**, not a risk tier. `numerics` is
  `decide: human` because your judgment is real there; making you sign off
  on `web-ui` would be theater.
- `ship` is a ladder: `push` ⊃ `commit` ⊃ `none`. **Omission never grants** —
  anything matching no domain parks for you, and the AI drafts an amendment
  (an ADR) that only you can ratify.
- Mirror it into `~/.claude/orch-lock.json` and the locked copy *replaces*
  any project copy — the project file is agent-writable, the lock file
  isn't. Since v0.7.0 the mirrored contract lives under
  `repos[<this repo's git common dir>]` in the lock file, not the lock's
  top level — so one lock file safely holds different contracts for
  different repos. `/orch:setup` handles this automatically; existing
  locks migrate via `node scripts/migrate-lock.js` (safe to re-run).
- Domains may optionally carry `tiers: { work, review }` floors (schema 2, `schemaVersion` field required).
  `work` is the minimum tier a delegate may implement at in that domain (advisory only in v0.7.0 —
  no hook enforces it until the v0.8.0 tier gate); `review` is what the `go`
  skill applies at verdict time — a hook cannot tell a work brief from a review brief, so it's
  INSTRUCTED behavior, not a hook. Roles are
  `low`, `mid`, `high`, and `frontier` (never mixed with other terms). Locking a tiered contract requires locking
  the models map: a locked `contract` now replaces the bundle `{contract, models}` wholesale.

## ⌨️ Five commands — three act on work, one on scope, one looks

| Command | When | What |
|---|---|---|
| 🔐 `/orch:setup` | once per repo | interviews you into a contract, offers lock mirroring, pins `workflow.tools` (one skill per stage of work, native fallback otherwise), ratifies ADRs |
| 🏁 `/orch:milestone` | scope, Director only | `define` (three questions → `M<n> · <objective>` with `target:` and `done:`), `split` (proposes goals from the Feature options, creates nothing), `prioritize` (`move G<n> …`), `close` (all goals merged, summary acknowledged). Refuses in any pane with `ORCH_ROLE` — a guardrail, not a credential. |
| 🎯 `/orch:goal` | per piece of work | shapes a one-page brief: goal, metric, done-condition, kill criteria |
| 🚦 `/orch:go` | every session after | reads the board and contract, picks its own phase (route → work → ship, or a whole unattended loop), stops only where your contract says |
| 📊 `/orch:board` | set up once, then read | board lives on GitHub: Milestone (top level) → goal `G<n>` (orch:goal issue) → items (sub-issues, one marked `gate: <LABEL>` for done-condition). Init: `/orch:board init [--project N] [--owner <login>] [--dry-run]` — `--project N` adopts existing Project; `--owner <login>` when Project owner ≠ repo owner; `--dry-run` prints, writes nothing. Reads the Project's existing `Priority` options as the buckets — rename `P0/P1/P2` → `Now/Next/Later` in the Project settings first if you want those names. Fsyncs journal. Read-only after, plus `sync` (mirrors Feature options from the contract); requires GitHub. `html` for shareable page. |

There is no bare `/orch` — always one of these five. [Architecture diagram →](docs/orch-architecture.html)

## 🧱 Eleven hooks — enforced, not remembered

| Hook | Plain meaning |
|---|---|
| 🚢 `contract-ship-gate` | Deny-by-default git surface: every command is refused unless it's read/local or a `commit`/`push` your contract covers — judged by what's actually in your repo, never by the command's arguments. Evidence lint at `board-gh done --goal --step` / `close-goal`: the round manifest chain under `docs/reviews/` is re-derived from git and the locked contract (enforced with a lock entry, advisory without). Worklogs, reviews and ADRs carry a built-in `commit` grant; `git worktree add --detach`/`remove` are allowed only under `<git-common-dir>/orch/wt/` (the review script's test worktrees). |
| 💣 `block-destructive-git` | No `push --force`, `reset --hard`, branch deletion, `gh pr merge`, or mutating `gh api`. |
| 🔒 `block-protected-dirs` | Folders you declare untouchable stay untouchable. |
| 🔍 `read-before-write` | First edit to a critical file is refused until the AI states callers, the test that'd catch a mistake, and the number justifying it. |
| 🧹 `session-hygiene` | No clocking out of a heavy session without writing down what happened. |
| 📡 `fleet-context` | Watches your *delegates'* fuel gauges, not just your own: one alert per band as an agent burns context, telling you to bank its state before autocompaction takes the choice away. Point it at any fleet CLI. |
| ⛽ `context-monitor` | Low-fuel gauge: one "finish up" warning, one "save state now". Each fires once. |
| 🔄 `run-on-commit` | Re-runs a command you choose after each commit, so derived artifacts never go stale. |
| 🎭 `role-guardrails` | With `ORCH_ROLE` set on a pane: a reviewer edits only `docs/reviews/`, nobody else writes there, the coordinator reads only handoffs/reviews/config/its goal's worklog, the architect writes no contract-domain path, the dev never rewrites the worklog's BRIEF. Advisory — the role is an environment variable. |
| 🪪 `session-start` | Turns a pane's `ORCH_ROLE`/`ORCH_IDS` into a session marker so the other two know who is working on what since when. |
| 📝 `stop-handoff` | A roled pane that edited anything may not stop until its handoff file exists (`tmp/handoffs/…`), once; over-budget handoffs and plan sections get one advisory line. |

⚠️ **What that costs, honestly:** the AI can't `pull`, `merge`, `rebase`,
`cherry-pick`, `revert`, `tag`, `commit --amend`, use an alias, or touch
`remote`/`config`/`submodule`/`clone` — while a contract is active. It also
can't commit while a domain you reserved is dirty, or make a branch's first
push before you run `git remote set-head origin -a` once — the gate never asks the remote. Every block names you as the
override. And it is **not a sandbox**: it reads the commands the AI types,
so a script that runs `git` from inside is out of its sight.
Role guardrails (`ORCH_ROLE`) are **advisory** by design — the role is an environment variable any pane can set, and a `cat` inside a script is a read no hook sees.
And until `/orch:setup` mirrors your contract into `~/.claude/orch-lock.json`, every contract-keyed guard reads the agent-writable `.claude/orch.json`: enforced in mechanism, advisory in fact. Each audit line says which it read (`contract: locked|unlocked`).

## 🧾 What it leaves behind

`.claude/orch-audit.jsonl` — one machine-written line per gate decision ·
`Ruling:` lines — one per autonomous call, with what it costs if wrong ·
`docs/adr/` — structural decisions, filed `proposed` when the AI decides
alone, surfacing every session until you ratify or reject them.

## ⚙️ Configure

Everything in `.claude/orch.json` is optional; hooks with no config no-op.
`block-destructive-git` and `context-monitor` are on by default;
`contract-ship-gate` activates with a `contract` block — except that a
corrupt `orch.json` blocks shipping until fixed, since a broken config must
never silently disable a guard.

```json
{
  "contract": { "...": "see above" },
  "workflow": { "tools": { "research": "your-deep-research-tool" } },
  "models": { "frontier": "opus", "high": "opus", "mid": "sonnet", "low": "haiku" },
  "protectedDirs": ["acceptance"],
  "board": { "staleDays": 3 },
  "readBeforeWrite": { "pathRegex": "(Solver|Kernel)", "facts": ["Every caller (grep, not memory).", "The red test.", "The reproduced number.", "Units."] },
  "sessionHygiene": { "trailPaths": ["tmp/worklogs"], "minEdits": 8 },
  "contextMonitor": { "window": 200000, "preAlarm": 0.40, "trip": 0.25 },
  "fleetContext": { "listCmd": "herdr agent list --json", "readCmd": "herdr agent read {name} --source visible", "pattern": "ctx:([0-9]+)%", "threshold": 40 },
  "runOnCommit": { "command": "graphify", "args": ["update", "."] },
  "destructiveGit": { "extraPatterns": [{ "pattern": "taskkill\\s+/f\\s+/im", "name": "mass process kill" }] }
}
```

## 📖 Glossary

**goal** one finite deliverable (`G<n>` issue), an orch:goal issue on the board · **milestone** GitHub's top-level Milestone: `M<n> · <objective>` with `target:` and `done:` in its description — created only by the Director via `/orch:milestone`; legacy `C<n>` titles still sort · **feature** the Project's Feature options are the contract's domain names — the workstream a goal belongs to, never part of an id · **board** the status
table, one row per goal (kanban, GitHub Issues + Projects v2) · **worklog** a goal's running notebook ·
**ledger line** one-line summary of one work round · **review ladder**
staged checking, cheap → expensive (quality gates) · **merge gate** the
three questions before keeping a change (definition of done) · **noise
clause** moved less than the usual wobble = not an improvement (statistical
significance) · **guardrails** rules enforced by programs, not by asking
nicely (policy-as-code) · **contract** your map of who decides and who
ships (decision rights / RACI) · **ADR** architecture decision record ·
**ship grant** how far the AI may push on its own (deploy permission) · **handoff** a role's ≤40-line exit note under `tmp/handoffs/` (scratch; the worklog is the record) · **session marker** `{role, milestone, goal, step, startedAt}` per pane, in the git common dir — what the role hooks key on · **recipe** the named stage sequence between a step's brief and its gate — `tdd · debug · iterate · cleanup · fast` on steps, `spec · research` for shaping; one page each under `skills/go/recipes/`, hashed into the review manifest · **stage** one named phase of a recipe; `workflow.tools` maps a stage to one chosen skill pinned by version (`tdd@<sha12>`, `to-spec@2.1.0`), orch's native fallback otherwise — data, never read by a hook · **round manifest** `docs/reviews/M<n>.G<k>.S<j>.R<r>.md`, the gate's verifiable verdict header (range, paths, rubric hashes, slots) · **evidence lint** the ship-gate check that re-derives a manifest chain from git alone.

**Renamed in v0.4.0** (if you saw the earlier version): front → goal ·
dossier → worklog · hook wall → guardrails · judge independence → independent
reviewer · fact-force → read-before-write (config key `factForce` still
works, with a notice).

## 🧪 Development

`npm test` runs every suite in `tests/` (plain Node, no dependencies);
`node tests/test-<name>.js` runs one. See `CHANGELOG.md` for release
history.

## 🙏 Lineage

Ideas adapted, with thanks: fresh-context re-review loops (Kenton Varda) ·
dual-reviewer convergence and delivery gates (affaan-m/ECC) · test-quality
audit and context monitoring (gsd-build/get-shit-done) · ledger lines and
the simplicity criterion (karpathy/autoresearch) · routing pipelines and git
guardrails (mattpocock/skills) · `Ruling:` lines (obra/superpowers).

MIT
