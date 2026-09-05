# research — shaping recipe

Fits: knowledge gap — facts the agent can neither derive from the repo nor verify from training. Runs before the BRIEF or inside a step's stage; never on a step as its recipe.
Stages: search → grade sources → findings note
Skill: stage `research` (chosen `research`: a background agent, findings file in the repo; native: web search → grade sources).

## Stages

1. **search.** Primary sources only — official docs, source code, specs, first-party APIs; follow each claim to the source that owns it.
2. **grade sources.** Per claim: `primary | vendor | secondary | unverified` plus a confidence; conflicts listed, not resolved by preference.
3. **findings note.** One markdown file where the repo keeps such notes (else `docs/research/<slug>.md`), cited from the worklog's `research:` section and by the BRIEF.

Ledger: `skill: research=<name>`.

## Gate rubric adds

- sources cited and graded; no code — the diff touches only the findings note and the worklog.
