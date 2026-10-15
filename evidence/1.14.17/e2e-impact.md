# E2E impact analysis — 1.14.17 (BA-230)

Workflow steps 6, 7 and 9 for roadmap 1.14.17: visuals follow the Light/Dark theme, the welcome page, the New conversation Agent picker, the Sessions page, the compact chrome, 14/22 px chat text and the smaller banner. Code: commit `ba491d7` (and the BA-230 parts of `d4faa5b` in the specs). Web target only; desktop not run.

## Components touched and the scenarios that exercise them

| Component (commit `ba491d7`) | Scenarios (capability spec → Feature) |
|---|---|
| `backend/src/modules/sessions/visualization-document.ts`, `visual-runtime.ts` (frame tokens, `data-theme`, `qti-theme` bridge, chart label colours) | visuals → Visual tailoring: "The visual follows the app's theme", "An older visual opens in the current theme"; sessions-chat → Chat and visuals: "Renders a deterministic interactive visualization…" |
| `frontend/.../interactive-visual-panel` (`withVisualTheme`, frame theme sync) | the same three |
| `backend/src/mastra/agents/visualization.agent.ts`, `interactive-visuals/reference/{freeform,spec-mode}.md` | visuals → Skills the designer is given (both scenarios) |
| `frontend/src/app/app.html` / `app.ts` (Sessions page, composer Agent picker, rail and drawer, compact chrome, banner) | app-shell → Navigation rail (all 9), Layout and accessibility (all 4), Appearance (all 7); sessions-chat → Session management (all); llm-settings → "Sets the reasoning effort from the new-session composer", "Shows that no model is configured"; datasources → World Cup workflow (creates sessions through the Sessions page) |
| `features/home/components/welcome` | app-shell → "The start page explains how the product works" |
| `features/sessions/components/sessions-list`, `session.model.ts` (row subtitle, agent chip, activity) | sessions-chat → Session management: delete, cancel, the Sessions page search |
| `features/agents/services/agent-hub.util.ts` (`newSessionAgentOptions`) | sessions-chat → "I start an RFP Builder session from New conversation", "The Agent field disables an agent that cannot start" |
| `session-chat.scss`, `styles.scss`, `styles/components.css` (14/22 px text, compact tokens) | app-shell → "Matches the stable application-shell visual baseline", both axe scenarios |
| `agent-detail`, `agent-editor`, `builtin-skill-editor`, `knowledge-list` templates (page titles) | layout-accessibility axe scan (Agent detail, Knowledge); the agents Features belong to other stories' spec files |
| `POST /sessions` with `agentId` and an optional typed `name` (api.md 2.1 #3, R64) | backend `test/agent-sessions.e2e-spec.ts` |

## Decisions per scenario

| Spec file | Scenario | Decision | Why it fails on `origin/main` |
|---|---|---|---|
| `visual-tailoring.spec.ts` (new) | The visual follows the app's theme | **Add** | On main the frame is always `#171717` and has no `data-theme`; the test asserts a white frame (`#ffffff`, title `#001f52`) in Light, then `data-theme="dark"`, `#12233a` and `#eef4fc` after the switch, a window variable set before the switch still there (no reload), and a changed chart label fill. |
| `visual-tailoring.spec.ts` (new) | An older visual opens in the current theme | **Add** | The stored visual is rewritten as a legacy bundle (index.html only, own styles hardcoding `#171717`); main shows it dark grey with no tokens, the test asserts `data-theme="dark"` and `#12233a`. |
| `navigation.spec.ts` | The start page explains how the product works | **Update** (now clicks each step's button and Explore agents) | Main has no welcome page (empty placeholder composer). |
| `navigation.spec.ts` | Moves between areas from the rail; Expands the rail into a drawer with labels | Re-run as-is (updated in `ba491d7`) | Main lists sessions in the drawer. |
| `navigation.spec.ts` | the other 6 | Re-run as-is | — |
| `layout-accessibility.spec.ts` | Matches the stable application-shell visual baseline | **Update baseline** (`--update-snapshots=all -g`) | The committed baseline still had the menu button alone above the logo; the app now puts it beside "Agentic Hub" in the drawer (inside the 1 % tolerance, so the old image passed; regenerated on purpose and checked by eye: 52 px banner, 208 px drawer, menu beside the title, welcome page). |
| `layout-accessibility.spec.ts` | the 3 other scenarios | Re-run as-is (screens list updated in `ba491d7`) | — |
| `appearance.spec.ts` | all 7 | Re-run as-is | — |
| `session-management.spec.ts` (new; shared with 1.14.18) | Create stays disabled…; Shows guidance when there are no datasets; A new session opens on its welcome block; Deletes a session after confirmation; Cancelling the delete confirmation keeps the session | **Add** (Feature was `E2E: none yet`; steps changed to the Sessions page) | Main has no "Start New Conversation" on a Sessions page and no "Options for <name>" on page rows. |
| `session-management.spec.ts` | I start an RFP Builder session from New conversation | **Add** | Main has no Agent field. Asserts the listbox (`aria-expanded`, options with name and description, Assistant selected), the agent's dataset chips replacing the cards, the toast, the header and the page row (dataset under the name, `RFP Builder` agent chip, R63). The sample is stood in for by a dataset named "Intellify RFP API". |
| `session-management.spec.ts` | The Agent field disables an agent that cannot start | **Add** | Main has no Agent field. Asserts `aria-disabled`, the reason text, and that a click keeps Assistant. |
| `session-management.spec.ts` | The Sessions page finds a session by name or ID | **Add** (new Gherkin, R63) | Main has no Sessions page. Asserts 10 per page, `1–10 of 12`, `Page 1 of 2`, Next page, case-insensitive name and id search, the row's datasets, agent chip and `ID <8>`, the no-match text, and opening a row. |
| `session-management.spec.ts` | The conversation and its history survive a restart | none yet (unchanged; covered by the datasources World Cup workflow) | — |
| `llm-settings.spec.ts` | Sets the reasoning effort from the new-session composer; Shows that no model is configured | **Add** | Steps go through Sessions → Start New Conversation, which main lacks. |
| `llm-settings.spec.ts` | the 7 other automated scenarios | Re-run as-is | — |
| `chat-and-visuals.spec.ts`, `chat-clarification.spec.ts`, `world-cup-workflow.spec.ts`, `developer-observability.spec.ts`, `designer-skills.spec.ts` | all | Re-run as-is | — |
| `backend/test/agent-sessions.e2e-spec.ts` | "creates a session from the Live agent…" | **Update** (no longer sends a name) | — |
| `backend/test/agent-sessions.e2e-spec.ts` | a typed name names the session; a blank one takes the Live name | **Add** | Main ignored the body's `name` (the old test asserted exactly that, and failed on the branch). |
| Other stories' files: `agent-sessions.spec.ts`, `agents.spec.ts`, `agent-hub.spec.ts`, `agent-editor.spec.ts`, `testing-data.spec.ts` | "Sessions started from an agent" steps changed (Sessions page) | Re-run by their owners (1.14.2-11, 1.14.12-16, 1.14.18) | — |

Counts: 12 Playwright tests added (visual tailoring 2; session management 8, one of them for the new Gherkin scenario; llm-settings 2), 1 updated, 1 visual baseline updated, 1 backend API test added and 1 updated, 0 deleted; every other scenario of the listed files re-run as-is.

## Gherkin added

`specs/capabilities/sessions-chat/spec.md`, Feature "Session management": Scenario "The Sessions page finds a session by name or ID". E2E lines set: Session management (sessions-chat), Visual tailoring (visuals), LLM settings (llm-settings).

## Spec inconsistencies found (not app bugs; for the spec owner)

- sessions-chat, "I start an RFP Builder session from New conversation", last step: `the "Sessions" list shows it with "RFP Builder · Intellify RFP API" under its name` contradicts R63 (datasets under the name, agent as a chip). The test asserts R63. Same pattern in "Sessions started from an agent" (`"Cup historian · World Cup Core" under its name`).
- app-shell has two rules numbered R50 (the drawer's remembered state, and "Single user").

## Desktop not run

`developer-settings.spec.ts` "the desktop app offers to restart the backend…" and `diagnostics.spec.ts` "captures live renderer failures…" are `desktopOnly()` and were skipped on web.

## Screenshots

`visual-light-theme.png`, `visual-dark-theme.png` (same visual after the switch, hover tooltip kept), `visual-older-opens-dark.png`, `welcome-page.png`, `sessions-page.png`, `new-conversation-agent-picker.png`, `new-conversation-agent-disabled.png`.
