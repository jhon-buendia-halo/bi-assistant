# 1.13.9 — E2E impact analysis (step 6)

Touched: the `assistant` agent's prompt and tools (`assistant.agent.ts`, the new `assistant-prompt.ts` and `skill-tools.ts`), and `app-skills.ts` (catalog, wrapped descriptions). Every assistant call changes, so the full suite re-runs.

| Feature (spec) | Scenario | Decision |
|---|---|---|
| Skills the assistant is given (`assistant-skills.spec.ts`) | The assistant is offered only its own skills | **Update**: the prompt sections, and no `read_file` or framework skill tools |
| | A turn without curated knowledge carries no knowledge rules | Re-run as-is |
| | A turn with curated knowledge carries the rules right after the block | Re-run as-is |
| | A user-level skill is offered to the assistant on demand | **Update**: the app's own catalog in `## Skills`, with the `SKILL.md` path; `read_file` instead of `skill`/`skill_read` |
| | The assistant reads a skill's files with read_file, and only those | **Add** |
| | A user-level override of the curated-knowledge skill reaches the turn | Re-run as-is |
| Agents (`agents.spec.ts`) | Opens an agent … (the Prompt tab starts with the identity) | Re-run as-is |
| Agent skills, designer skills, deep analysis, chat and visuals, knowledge, evals | all | Re-run as-is (full suite) |

## Scope extension: `curated-knowledge` on demand (acceptance gate, 2026-10-14)

Touched: `app-skills.ts` (`AGENT_SKILLS` / `HARNESS_SKILLS`), `context-blocks.ts` (`knowledgeContext` sends the block alone), the assistant's prompt (now always with `## Skills` and `read_file`). Every assistant call changes again.

| Feature (spec) | Scenario | Decision |
|---|---|---|
| Skills the assistant is given (`assistant-skills.spec.ts`) | The assistant is offered only its own skills | **Update**: `## Skills` present, catalog is `curated-knowledge` with an existing `SKILL.md` location, `read_file` offered |
| | A turn without curated knowledge carries no knowledge rules | Re-run as-is |
| | A turn with curated knowledge carries the block, and the rules stay on demand | **Update** (was "…carries the rules right after the block"): the block alone, no rules, `curated-knowledge` in the catalog |
| | A user-level skill is offered to the assistant on demand | **Update**: catalog is `curated-knowledge` and `sql-style` |
| | The assistant reads a skill's files with read_file, and only those | Re-run as-is |
| | A user-level override of the curated-knowledge skill is the one the model reads | **Update** (was "…reaches the turn"): the catalog points at the user folder and `read_file` returns the override |
| Agent skills (`agent-skills.spec.ts`) | A user skill and a project override reach the assistant | **Update**: `curated-knowledge` shows "On demand" |
| | the other scenarios | Re-run as-is |
| Agents (`agents.spec.ts`), agent sessions (`agent-sessions.spec.ts`), chat and visuals (`chat-and-visuals.spec.ts`), World Cup workflow (`world-cup-workflow.spec.ts`) | all | Re-run as-is: they show the assistant's prompt or run assistant turns |

## BA-208 (lint, format, types; no behaviour change)

Production files touched only in types and formatting: `assistant.evals.ts`, `visualization.service.ts`, `visualization-document.ts`, `visual-spec.ts`, `result-compare.ts`, `sessions.service.ts`, `sessions.controller.ts`, `agents.service.ts`, `eval-report.ts`, `knowledge.service.ts`, `postgres.connector.ts`, `mastra.service.ts`, `clarification.tool.ts`, `visual.tools.ts`, `zip-archive.ts`. Re-run as-is: the spec files that drive them.

- Web: `chat-and-visuals`, `designer-skills` (visualization service and document), `agents`, `agent-sessions`, `agent-editor` (agents service, eval report), `diagnostics` (zip archive), `world-cup-workflow` (Postgres connector).
- Org: `org-isolation` and `org-permissions` (sessions controller).

Not re-run, because they touch none of these files: `appearance`, `layout-accessibility`, `navigation`, `llm-settings`, `local-sign-in`, `developer-*`, `agent-hub`, and the other org specs.
