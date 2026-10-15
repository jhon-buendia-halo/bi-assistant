# 1.14.4 Assign skills to an agent (BA-216): E2E impact (step 6)

Base commit: `origin/main` (`ed2069b`); base probes in [../1.14.6/base-probes.txt](../1.14.6/base-probes.txt) (`/skills` is 404 on base).

## Touched → scenarios

| Touched (commit `0f3a14e`, later `aa6a4e8`) | Scenarios |
|---|---|
| `mastra/agent-skills.ts`, `assistant.agent.ts` (the agent's skills per call), `sessions.service.ts` | Agent editor: *A linked skill reaches the preview, and the Live agent keeps its copy*; Sessions started from an agent: *The agent's tool selection and skills apply to every turn* |
| `user-agents.service.ts` (publish copies the skills into `liveSkills`, unpublished changes when a skill changes) | Agent definitions (API): *Publishing copies the skills and a later skill edit leaves the Live copy*; Agent Hub: *Publishing a draft makes it Live* |
| agent detail Skills tab for user agents | Agent skills: *A user agent's Skills tab is its inline library* (made inline by 1.14.9, held there) |
| admin transfer of skill references | none: the admin area and transfers were removed by 1.14.19 (BA-232) |

## Decisions

| Decision | Scenario | Spec file | Why it fails on base |
|---|---|---|---|
| Add | Agent editor: A linked skill reaches the preview, and the Live agent keeps its copy (shared with 1.14.6 for the `/` pick and 1.14.10 for the skill tool) | `frontend/e2e/agent-editor.spec.ts` | `POST /skills` is 404 on base; base has no catalog entry for in-app skills and no `skill` tool |
| Add | Agent definitions (API): Publishing copies the skills and a later skill edit leaves the Live copy | `backend/test/user-agents.e2e-spec.ts` | no `/skills` route, no `liveSkills` |
| Shared | Sessions started from an agent: The agent's tool selection and skills apply to every turn | held in [../1.14.2/](../1.14.2/) | — |
| Re-run as-is | Agent Hub: Publishing a draft makes it Live; Agent editor: Editing a Live agent keeps its sessions on the Live version | `agent-hub.spec.ts`, `agent-editor.spec.ts` | — |
| Delete | none. The planned `read_file` over `/in-app-skills/` scenario was never written: 1.14.10 replaced `read_file` with the framework's skill tool, and the Live-copy check now loads the skill with that tool. | — | — |

Counts: Add 2 (1 Playwright, 1 API), Re-run as-is 2, Delete 0.

Results: [e2e-results.txt](e2e-results.txt). Desktop not run.
