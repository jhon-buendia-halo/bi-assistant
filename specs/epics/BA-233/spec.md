# BA-233 — US Health demo

- **Jira:** [BA-233](https://halo-powered.atlassian.net/browse/BA-233) · **Roadmap:** Milestone 1.15 · **Status:** Confirmed (by the user on 2026-10-15)

## Goal

The app can be shown to the US Health practice as its own hub: the banner names it the "US Health Agentic Hub", and the Agent Hub presents, next to the assistant and the RFP Builder, three further use cases the practice recognises (an employee benefits survey, the Life, Absence and Disability Center of Excellence, and a multi-year health and benefits strategy). The three showcase agents are there to be seen and discussed: each has a description and a system prompt that can be read and edited, but none can chat yet, and the app says so wherever a chat could start.

## Scope

- **Banner.** The top banner, the page's only level-one heading, reads "US Health Agentic Hub" instead of "Agentic Hub". Nothing else is renamed (see Out of scope).
- **Showcase agents.** Three built-in Official agents registered in the agent registry: `survey` (id `survey-agent`, "Survey Agent"), `lad-coe` (id `lad-coe-agent`, "LAD COE Agent") and `strategy` (id `strategy-agent`, "Strategy Agent"), each with a description and a shipped prompt, and with no tools, dataset, skills or evals. They are never run; the model is resolved like every agent's but never called.
- **Where they show.** The Agent Hub's Official section and Official filter, with a `Showcase` chip and **Start chat** always disabled with the reason `Showcase agent: not available to chat yet.`; their detail page with the description and an editable System Prompt (the built-in prompt override, ADR-0026); the New conversation Agent picker, listed disabled with the reason.
- **Refusal.** Creating a session from a showcase agent's key is refused with the same reason and creates nothing.

## Out of scope

- A working chat for the showcase agents (tools, datasets, sessions, a chat turn).
- Datasets, skills or eval sets for them.
- Renaming the product: the window and document title, the drawer label, the welcome heading "Welcome to Agentic Hub", the Settings build identity "Agentic Hub v…", the operating-system app name and the installers stay as they are.
- Any change to the assistant's or the RFP Builder's prompts, tools or skills.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-234](https://halo-powered.atlassian.net/browse/BA-234) | Banner reads "US Health Agentic Hub" | 1.15.1 |
| [BA-235](https://halo-powered.atlassian.net/browse/BA-235) | Showcase agents: Survey, LAD COE and Strategy | 1.15.2 |

## Specs touched

- [capabilities/app-shell](../../capabilities/app-shell/spec.md): R7 (the banner text, and that only the banner carries "US Health"), the description line, and the "Shows the product name" scenario's heading step.
- [capabilities/agents-evals](../../capabilities/agents-evals/spec.md): new rule R106 (showcase agents); R1, R2, R48, R53, R90 and R97-R101 name the showcase agents where they enumerate the Official agents or the plain-text prompt editor; the Agent Hub Feature gains two scenarios and its Official section now needs "Show more (2)".
- [capabilities/sessions-chat](../../capabilities/sessions-chat/spec.md): R52 (the refusal), R64 (the picker lists them disabled) and a Session management scenario.
- [system/agents.md](../../system/agents.md): ten registered agents (1.2), new section 2.9 with each agent's key, id, name, description and prompt, the skills table (7.4) and the catalogue (9).
- [system/api.md](../../system/api.md): `AgentSummary.showcase` and the showcase `chatRequirement` (33), `linksAllowed` and the prompt refusals (34, 103), the `POST /sessions` refusal (3).
- [system/ui.md](../../system/ui.md): the banner copy (1.1, 1.2, the copy table, landmarks, the shell baseline), the `Showcase` chip and disabled Start chat on the card (4.4), the picker (4.7).
- [product/glossary.md](../../product/glossary.md): "Showcase agent"; Agent, Agent Hub and Official agent updated.

No ADR: the showcase agents are ordinary registry entries and change no container, data flow or persisted shape (their prompt overrides use the existing `agent_prompt_overrides` collection).

## Acceptance

- The banner reads "US Health Agentic Hub", and the window title, document title, welcome heading and Settings build identity still read "Agentic Hub"; the application-shell visual baseline is refreshed at the acceptance gate.
- The Agent Hub shows the three showcase agents in the Official section with the `Showcase` chip and a disabled Start chat whose title is the reason; a showcase agent's page shows its description and System Prompt, and the prompt can be edited and reset.
- The New conversation Agent picker lists them disabled with the reason, and `POST /sessions` with a showcase key is refused with it.
- The impacted Playwright scenarios pass on the web target; `python3 scripts/check-specs.py`, backend and frontend unit tests, lint and builds are green. No eval gate: nothing the assistant or the RFP Builder receives changes.

## Dependencies, risks and open questions

- **Depends on** the Agent Hub (Milestone 1.9, ADR-0008) and built-in prompt overrides (ADR-0026, Milestone 1.14).
- **Risk:** the application-shell baseline image (`application-shell-web-linux.png`) changes with the banner text and must be regenerated with `npm run test:e2e:update`, only for that intended change. The desktop baseline is not regenerated unless a desktop run is requested.
- **Risk:** the Official section grows from two cards to five, so Agent Hub steps that click "Show more (2)" must name their section (Official or System).
- **Open question:** "LAD" is read as Life, Absence and Disability (the LAD COE Agent's description and prompt say so); to be confirmed with the US Health practice.
