# CLAUDE.md section map (0.4.1, BA-236)

Where each section of CLAUDE.md on `main` (`fbe32e3`) lives after the split. Moved sections are verbatim; only relative links are re-rooted (`../../../`) and a cross-reference to a convention in another skill names that skill.

| Section on `main` | Now in |
|---|---|
| Header, layout, *Process documents* | CLAUDE.md (pointers now name skills) |
| *Workflow*: mandatory first action, intro, *When the steps run* | CLAUDE.md |
| Steps 1–2 (full text) | `workflow-understand`; CLAUDE.md keeps a one-line summary per step |
| Step 3, *Planning convention*, *Epic gate*, *Branching convention* (name, worktree, bugs, commit scope, adopted) | `workflow-plan` |
| Step 4, *Architecture convention* | `workflow-architecture` |
| Step 5, *Spec convention* | `workflow-specs` |
| Steps 6–7, *E2E test convention*, *Test target convention* | `workflow-e2e` |
| Step 8, *Code rules* (Frontend, Backend), *Worktree deploy convention* | `workflow-implement` |
| Step 9 | `verify` (new top section; its running-app checks follow) |
| Step 10, *Logging convention*, *Evidence convention*, *Branching* (PR title and description, review, cleanup) | `workflow-ship` |
| Step 11, *Retrospective convention* | `workflow-retrospective` |
| *Code rules → Versioning* | CLAUDE.md, *Hard gates → Versioning* |
| *Model usage* | CLAUDE.md (planning model changed to Opus 5.5 at high effort, at the user's request) |
| Headline rules of Epic gate, Branching (never on `main`), Spec (same branch), Worktree deploy | CLAUDE.md *Hard gates* (one-line summary each; the rule stays in its skill) |

## Line check

Every non-blank line of `main:CLAUDE.md` searched verbatim (after link re-rooting) in the new CLAUDE.md and every `SKILL.md`. The 11 lines not found verbatim are: 8 pointer lines reworded in the core (lines 11, 15–19, 25, 45: process documents, the workflow intro, the versioning note); lines 131 and 144, where `jira.sh issue` became the `get_issue` tool (0.4.2, BA-237); and line 179, the planning model (Opus 5.5 at high effort, at the user's request). The 2 lines "in more than one place" are ```` ```bash ```` fences.

```
140 non-blank lines; 129 found verbatim; 11 not verbatim; 2 in more than one place
MISSING 11 **What the app does and how it works is specified in [specs/](specs/README.md), not here.** Start there for an
MISSING 15 - [roadmap.md](roadmap.md) — pre-implementation plan for all work. See **Planning convention**. Longer-form ph
MISSING 16 - [changelog.md](changelog.md) — running log of every change. See **Logging convention**.
MISSING 17 - [specs/](specs/README.md) — the product, system, capability and epic specs; an LLM given only this folder ca
MISSING 18 - [retrospective.md](retrospective.md) — what went well and wrong on each completed change. See **Retrospectiv
MISSING 19 - [evidence/](evidence/) — verifiable artifacts for each shipped change, linked from the changelog. See **Evid
MISSING 25 Every meaningful change follows this eleven-step workflow. Do not skip a step. The steps run in two loops, a *
MISSING 45 Versioning stays automatic (see **Versioning** under **Code rules**): the changelog is the human-readable reco
MISSING 131 - The change maps to an epic when its Jira issue (the Story or Bug being worked on) has an Epic as its `parent
MISSING 144   - `<EPIC-ID>` is the key of an **existing** Jira Epic in project BA, uppercase as Jira shows it (e.g. `BA-11
MISSING 179 For planning purposes, Fable creates the plan.
DUP 149 ['intellify-api', 'workflow-plan', 'workflow-ship']   ```bash
DUP 162 ['intellify-api', 'workflow-plan', 'workflow-ship']   ```bash
```
