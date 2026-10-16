# 1.15.2 (BA-235) — E2E impact analysis (step 6)

Touched: the agent registry (`mastra/index.ts`, `showcase-catalog.ts`, `showcase.agents.ts`, `shipped-agent-prompts.ts`), `AgentsService` (catalogue), `SessionsService.createFromAgent` (refusal), and in the frontend the agent card (Showcase chip), the hub (Official section shows every card; showcase agents last), the agent page (no Chat Box, reason text) and the New conversation picker.

| Scenario (spec file) | Decision | Why it fails on `main` |
|---|---|---|
| Agent Hub / The showcase agents are Official cards that cannot chat yet (`agent-hub.spec.ts`) | Add | no showcase agents on `main` |
| Agent Hub / A showcase agent's page shows its description and System Prompt (`agent-hub.spec.ts`) | Add | no `lad-coe` agent |
| Agent Hub / Filters limit the hub to one kind of agent (`agent-hub.spec.ts`) | Update: six Official cards, showcase last, no Official "Show more" | `main` has two Official agents |
| Agent Hub / Shows the built-in agents and mine in sections, and the accessibility scan (`agent-hub.spec.ts`) | Re-run as-is (they failed on the branch only while the Official section had its own "Show more (2)"; it now shows every card) | — |
| Session management / The Agent field lists the showcase agents disabled (`session-management.spec.ts`) | Add | no showcase agents |
| Agents (`agents.spec.ts`), Built-in agent prompts (`builtin-agent-prompts.spec.ts`), Agent skills (`agent-skills.spec.ts`), Sessions started from an agent (`agent-sessions.spec.ts`), the rest of Session management | Re-run as-is (catalogue and picker consumers) | — |
| Backend: refusal of a showcase session and the catalogue entry | Unit tests (`builtin-agent-sessions.spec.ts`, `agents.service.spec.ts`); backend API e2e re-run as-is | — |

No eval gate: the Assistant's and the RFP Builder's prompts, tools and skills are unchanged, and the showcase agents never run.
Desktop: not run (no desktop-only scenario touched).
