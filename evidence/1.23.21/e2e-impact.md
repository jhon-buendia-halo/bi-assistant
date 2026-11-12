# 1.23.21 — E2E impact (step 6)

> **Draft to review.** Written by `node scripts/qa.mjs 1.23.21 --draft-impact` from the diff against `a7f9e89`. Check every decision, fill in the scenarios and add the specs the diff mapping missed (shared helpers, fixtures) before the gate.

> **Reviewed 2026-11-12 (step 6, epic M1-23).** The draft maps the whole epic diff, so the decision is an epic-wide re-run of the full web suite and every backend e2e spec (the gate's `qa.mjs --wave` over all M1-23 stories). Each story's own scenario was written in its story lane (`@story-<id>`); specs that no longer exist were removed from this list.

| Spec | Decision | Scenarios |
|---|---|---|
| `frontend/e2e/agent-editor.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/agent-hub.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/agent-panel.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/agent-sessions.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/agent-skills.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/agents.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/appearance.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/assistant-skills.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/builtin-agent-prompts.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/chat-and-visuals.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/chat-clarification.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/data-readiness.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/dataset-ontology.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/dataset-schema-notes.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/deep-analysis.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/designer-skills.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/developer-observability.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/layout-accessibility.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/llm-copilot.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/llm-custom-endpoint.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/llm-settings.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/monitoring.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/navigation.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/rfp-builder.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/runs.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/skill-library.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/synthetic-data.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/visual-tailoring.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/workflow-runs.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/workflows.spec.ts` | re-run | all (epic-wide re-run) |
| `frontend/e2e/world-cup-workflow.spec.ts` | re-run | all (epic-wide re-run) |
