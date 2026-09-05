# Workflow tools — one chosen skill per stage (spec §9, d.32)

Loaded from `/orch:setup` step 6. `workflow.tools` in `.claude/orch.json`
maps a **stage key** to `"<skill>@<version>"` or `null`:

```json
"workflow": {
  "tools": { "tdd": "tdd@1f3a9c0b2d4e", "spec": "to-spec@2.1.0", "iterate": null }
}
```

Resolution, one rule: `tools[stage]` if set and installed at the pinned version → the skill; else the native fallback, and the ledger says which.
`node "<plugin>/scripts/tools.js" check` applies it and prints one line per
stage — `ok · invoke: skill|read · <path>`, `missing → native`,
`mismatch (installed <v>) → native`, or `native`. `invoke: read` means the
skill's frontmatter says `disable-model-invocation: true`: the Skill tool
cannot call it, so the role reads the printed `SKILL.md` and follows it as
its procedure. `<version>` is the plugin version when the skill lives in an
installed plugin, else the first 12 hex of the `SKILL.md`'s sha256 — a
copied skill is pinned by its bytes; an edit or update is a mismatch until
re-pinned. Orch ships only the native column; every other cell is the
operator's choice, recorded as data — no hook reads this map, and the gate
rubric (`review-goal.md`) is extended by the `gate-rubric` pick, never
replaced. The Coordinator has no row. Superpowers stays installed for the
operator's own sessions; orch does not route to it.

Tracker rule: `to-spec`, `to-tickets` and `wayfinder` publish to an issue
tracker. `board-gh` is the only board writer, so `tools.js pin` refuses
them unless `docs/agents/issue-tracker.md` carries the line
`# Issue tracker: Local Markdown` (written by `/setup-matt-pocock-skills`
when the operator picks local markdown; files land under `.scratch/<feature>/`,
gitignored). The Architect turns those files into `add-item` calls.

| key | stage | role | chosen skill | native fallback |
|---|---|---|---|---|
| `define-milestone` | define milestone | Director | `grilling` | three questions |
| `grill` | grill / shape | Architect | `grill-with-docs` (ADRs + glossary → `docs/adr`) | three questions |
| `spec` | spec | Architect | `to-spec` (local tracker) | plan section |
| `split` | split to steps | Architect | `to-tickets` (local tracker → `add-item` per ticket) | plan section |
| `fog` | fog | Architect | `wayfinder` (local map) | fog list in the plan section |
| `domain-model` | domain model | Architect | `domain-modeling` | ADR |
| `tdd` | tdd | Dev | `tdd` | ladder step 1 |
| `debug` · `debug-echo` | debug | Dev | `diagnosing-bugs`; `bug-echo` after the fix (find siblings of the same pattern) | ladder step 1 |
| `iterate` | iterate | Dev | — | hypothesis → change → measure |
| `cleanup` | cleanup | Dev | `safe-refactor` (verification brackets each edit) | de-sloppify prompt |
| `fast` | fast | Dev | `implement` (from the step's ticket) | implement → test |
| `research` | research | Architect, Dev | `research` (findings file in the repo) | web search → grade sources |
| `merge-conflicts` | merge conflicts | Dev | — (`resolving-merge-conflicts` only when the owner says go) | stop, park for owner |
| `gate-rubric` | gate rubric | Gate | `code-review` as the second axis (standards + spec on a fixed range) | `review-goal.md`, **always**, hashed |
| `merge-proof` | merge gate proof | Dev | `verify-and-stop` | full-suite verdict line |
| `handoff` | handoff | every role | `handoff` (brief adds the 40-line cap) | four-line handoff |

Notes per pick: `handoff` saves to the OS temp dir by itself — the brief
overrides that with orch's path (`tmp/handoffs/…`, plan 3) and the 40-line
cap. `code-review` reads `docs/agents/issue-tracker.md` to find the spec;
it publishes nothing. `debug-echo` runs after the fix, in the same pane.
