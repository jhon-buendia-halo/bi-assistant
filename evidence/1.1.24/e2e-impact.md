# 1.1.24 and 1.1.25 (BA-188) — E2E impact analysis (workflow step 6)

One acceptance gate for both features, run on 2026-10-26 after the user accepted them. It covers what changed from the last push of PR #81 (`938c6a2`) to `61256b8`:

| Module | Change | Feature | Who sees it |
|---|---|---|---|
| `backend/src/mastra/evals/checks/uses-entities.ts`, `sample-views.ts` (new), `eval-check-scorers.ts`, `checks/check.ts` | `check-uses-entities` counts the tables a sample's view reads (agents-evals R124) | 1.1.24 | eval results |
| `backend/src/mastra/evals/checks/numbers-grounded.ts` | `check-numbers-grounded` ignores the number of a stage name (R115) | 1.1.24 | eval results |
| `backend/src/mastra/evals/sets/finance.json`, `world-cup.json` | `non-performing-loans` matches its statuses in any case; `matches-by-stage` asks for both tournaments together | 1.1.24 | the question bank, the Evals tab's question text |
| `backend/src/modules/testing-data/fixtures/knowledge/marketing-analytics.ts` (new), `fixtures/registry.ts` | the Marketing Analytics knowledge seed, created when the sample loads (testing-data R26) | 1.1.25 | Knowledge, after a load; the model, through the knowledge block |
| `backend/src/mastra/agents/assistant-prompt.ts` | working rule A4: a question that names its measure computes every reading before it asks how to compare (loop round 16) | 1.1.25 | the model; the agent editor shows the shipped prompt |

No Gherkin step names a check's verdict, the wording of a bank question, a sample's seed entries or the text of a prompt rule. Each is pinned by unit tests instead: `uses-entities.spec.ts`, `sample-views.spec.ts`, `numbers-grounded.spec.ts`, `eval-check-scorers.spec.ts`, `eval-set-files.spec.ts`, `knowledge-seeds.spec.ts`, `testing-data.service.spec.ts`, and `assistant.agent.spec.ts` with the prompt fixture `assistant-prompt.full.txt`. The scenario "Loads a domain sample with its knowledge seed" (testing-data) states the rule with Health Insurance as its example, and R26 now lists Marketing Analytics; the scenario is not automated. Rounds 15 and 16 loaded the sample with its seed into the loop's data dir and ran on it. So no scenario is added, updated or deleted.

## Re-run as-is

| Spec | Why |
|---|---|
| `agents.spec.ts` | the Evals tab: the question banks and checks feed its sets, counts and results |
| `builtin-agent-prompts.spec.ts` | the shipped assistant prompt in the agent editor, which now holds the longer A4 |
| `assistant-skills.spec.ts` | the prompt's `## Working rules` section, where A4 sits |
| `chat-clarification.spec.ts` | a clarification with its options, the behaviour A4 governs |
| `testing-data.spec.ts`, scenario "Lists the bundled samples and what is loaded" only | the samples registry changed for Marketing Analytics. The spec's Intellify scenarios load into the shared Postgres on 55432, which other sessions use, and they do not touch this change, so they were not run |

Desktop not run (web target only, as the Test target convention says).

Commands and counts: [checks.txt](checks.txt) and [e2e-results.txt](e2e-results.txt).
