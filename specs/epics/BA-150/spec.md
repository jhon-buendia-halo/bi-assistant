# BA-150 — Agent Hub

- **Jira:** [BA-150](https://halo-powered.atlassian.net/browse/BA-150) · **Roadmap:** Milestone 1.9 · **Status:** Confirmed

## Goal

Users can build their own data agents and find them again. An agent is a named, described assistant with its own instructions, the datasets it may query, starter questions and, optionally, its own model. Users build one, test it as a draft, publish it, pin the ones they use most and start a chat from any of them. The Agents screen becomes this hub: a searchable grid of agent cards with filter pills. The app's own assistant appears as the Official agent.

Today, every session starts from the same general assistant, so a user re-explains the same context ("answer only about the 2026 health plan, cite the policy table") in every session. An agent captures that context once.

Visual reference: the "Agentic Hub — Agents" mockup shared on 2026-10-09. Its look comes from [BA-141](https://halo-powered.atlassian.net/browse/BA-141).

## Scope

- **Agent definitions.** A user-built agent has a name, a description, instructions, datasets, starter questions and an optional model or reasoning-effort override. It is stored locally like every other app document. Decision: ADR-0008 in [architecture.md](../../system/architecture.md).
- **Runs on the assistant.** A user agent is a configuration of the existing assistant, not a new runtime agent. It keeps the same tools, read-only SQL guard, grounding rules, trust signals and visuals. Its instructions are added to the assistant's context and never replace the base prompt.
- **Lifecycle: Draft → Live.**
  - A new agent is a **Draft**: it can be edited and tested in a preview chat, but can't start sessions.
  - **Publish** makes it **Live**.
  - Editing a Live agent creates a new draft. The Live version keeps serving its sessions until the draft is published.
- **Start a chat.** "Start chat" on a Live agent creates a session bound to it and to its datasets. An empty session shows the agent's starter questions, and the session list shows the agent's name.
- **The hub screen** replaces the Agents list:
  - a search over name and description;
  - filter pills **All**, **Pinned**, **Official** and **Mine**;
  - sections of cards, each with **Show more**.
  - Each card shows the name, the description, the owner ("You" or "Official"), a **Pin** / **Pinned** control and a **Draft** / **Live** chip.
  - Empty, loading, error and no-match states.
- **Built-in agents.**
  - The assistant is the only **Official** agent, and it can start a chat.
  - The helper agents (SQL Fixer, SQL Verifier, Interactive Visual Designer, Knowledge Bootstrap, Assistant Eval Judge) appear in a **System** section. They are read-only and can't start a chat.
  - Built-in agents can be pinned but not edited or deleted.
- **Detail view.** Clicking a card opens the agent's detail view, which keeps today's tabs (Prompt template, Tools, Memory, Model, Evals). A user agent's detail view also offers Edit, Publish, Start chat and Delete.
- **Editor.** **New agent** and **Edit** open a form for every field, with a preview chat for the draft. The preview is not saved to the session list. Delete asks for confirmation.

## Out of scope

- **People and sharing:** "My team", "Whole org", team or person owners, and any sharing or syncing of agents between machines. The app stays local-first with no accounts ([vision.md](../../product/vision.md), *not multi-user*). This needs its own epic and an ADR on a sharing backend.
- Evals for user agents. Only the assistant keeps eval sets.
- Duplicating an agent, and making a user agent from a built-in one.
- Custom tools, or tools beyond the assistant's own.
- Version history of an agent beyond its one draft and one Live version.
- Switching agents inside an existing session.
- The visual restyle itself, which is [BA-141](https://halo-powered.atlassian.net/browse/BA-141).

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-151](https://halo-powered.atlassian.net/browse/BA-151) | ADR, epic spec and roadmap | 1.9.1 |
| [BA-152](https://halo-powered.atlassian.net/browse/BA-152) | Agent definitions: storage and API | 1.9.2 |
| [BA-153](https://halo-powered.atlassian.net/browse/BA-153) | Start a session from an agent | 1.9.3 |
| [BA-154](https://halo-powered.atlassian.net/browse/BA-154) | Agent Hub screen | 1.9.4 |
| [BA-155](https://halo-powered.atlassian.net/browse/BA-155) | Agent editor: create, test, publish and delete | 1.9.5 |

All stories are built on one branch, `feat/BA-150-agent-hub`, and ship as one PR.

## Specs touched

- [system/architecture.md](../../system/architecture.md): ADR-0008 (BA-151).
- [system/data-model.md](../../system/data-model.md):
  - a new `agents` collection holding a draft and a Live version, and the pin state;
  - pin state for built-in agents;
  - the session's optional agent reference (BA-152, BA-153).
- [system/api.md](../../system/api.md): agent create, update, publish, delete and pin endpoints, and creating a session from an agent (BA-152, BA-153).
- [system/agents.md](../../system/agents.md): how a user agent's instructions, datasets and model override are applied to an assistant turn (BA-153).
- [system/ui.md](../../system/ui.md): the hub screen, cards, filters, the System section, the editor and the preview chat (BA-154, BA-155).
- [capabilities/agents-evals/spec.md](../../capabilities/agents-evals/spec.md): the agent catalogue rules R1–R9 are rewritten for the hub. New rules and Gherkin cover user agents, the lifecycle, pins, search and filters (BA-152, BA-154, BA-155).
- [capabilities/sessions-chat/spec.md](../../capabilities/sessions-chat/spec.md): rules and Gherkin for sessions started from an agent and for starter questions (BA-153).
- [product/glossary.md](../../product/glossary.md): *user agent*, *official agent*, *system agent*, *draft*, *Live*, *pin* (BA-152, BA-154).

## Acceptance

- A user creates an agent, tests it as a draft, publishes it, and starts a chat in which the answers follow its instructions and query only its datasets.
- Editing a Live agent leaves its sessions on the Live version until the draft is republished.
- Search, the four filters, pin and unpin, and Show more work on the hub. Pins and agents survive a restart.
- The assistant appears as Official. The helper agents appear only in the System section, and their detail view is unchanged.
- Deleting an agent asks first. Its sessions remain and continue with the plain assistant.
- The read-only SQL guard and grounding rules hold for every user agent. User instructions can't switch them off.
- Every new or changed Gherkin scenario has a passing Playwright spec, and the existing Agents and eval flows still pass.

## Dependencies, risks and open questions

- **Depends on BA-141** for the cards, filter pills, status chips and the icon rail. Building 1.9.4 and 1.9.5 before BA-141's shared components (1.8.4) land would mean restyling them twice. 1.9.2 and 1.9.3 are backend-led and can start first.
- **Timing.** This epic is inside the 1.0 Beta (due 2026-10-31) and competes with BA-141 and milestones 1.1–1.7 for the same window. If the window closes, the fallback is to ship 1.9.2–1.9.4 and move the preview chat (part of 1.9.5) out.
- **ADR numbering.** BA-141's unmerged branch claims ADR-0007, so this epic uses ADR-0008. Whichever merges second keeps its number.
- **Prompt injection by design.** User instructions go into the assistant's context. They SHALL be placed after the base rules and labelled as user-supplied, and the guard and grounding checks stay in code, not in the prompt. Eval coverage of a user agent is out of scope, so a user agent's answer quality is not measured.
- **Dataset references are by name** ([data-model.md](../../system/data-model.md) §3.12). Renaming or deleting a dataset leaves an agent pointing at a missing name. The hub should flag such an agent rather than fail at chat time.
- **Open: who owns a user agent?** Every user agent reads "Owner: You" until there is a sharing backend. The mockup's team owners ("Claims Analytics", "Platform") are deferred with *My team* and *Whole org*.
- **Open: the Official owner label.** The mockup has no Official card. "Official" is proposed.
- **Related:** [BA-82](../BA-82/spec.md) Agent Routines (still undefined) may later run user agents on a schedule.
