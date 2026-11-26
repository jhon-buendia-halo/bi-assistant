---
name: agent-change
description: Use when adding an agent, or changing what an agent receives (its prompt, skills, tools, context blocks or model routing). Classifies the agent and picks its tools from the shared kits, prints the agent inventory (scripts/agent-inventory.mjs), decides whether its evals must run (hash base vs branch), keeps its answers on the shared query inspector layer, and runs the evals base against branch.
---

# Agent change

A new agent, or a change to what an agent receives: its prompt, skills, tools, context blocks or model routing. Each step below fills the workflow step named in brackets.

The inventory is the lever for steps 1, 2 and 6. Build the backend (`npx nest build` in `backend/`), then run `node scripts/agent-inventory.mjs`. It prints each agent's classes, tools, skills, memory, model policy, prompt size and a hash of what the model receives, then the tool matrix and the class check. To compare with the base:
- build the base in its own worktree (lessons.md, *Evals and agents*);
- run `node scripts/agent-inventory.mjs --root <base> --json > .context/agents-base.json`;
- on the branch, run `node scripts/agent-inventory.mjs --compare .context/agents-base.json`, which names the agents whose evals must run.

1. **[Understand]** Print the inventory and name what the agent receives that changes. Equal hashes on the base and the branch mean the evals need not run ([lessons.md](../../../lessons.md), *Evals and agents*).
2. **[Understand]** Measure before designing: prompt sizes come from the compiled agent (the inventory's *prompt chars*, `getInstructions()`), not from the source text ([lessons.md](../../../lessons.md), *Process and hand-over*).
3. **[Clarify]** **Classify the agent and pick its tools.** Classify it first; an agent can be more than one:
   - `person`: a person talks to it (a chat, a run, a bound session);
   - `data`: it answers from the session's datasets;
   - `orchestrator`: it calls other agents as its tools;
   - `single-step`: the code calls it once with a contract.

   Declare them in the agent's spec (`classes` in `defineBuiltinAgent`, `backend/src/mastra/agent-factory.ts`); the inventory reads them from the build, and an agent with none fails it. The class decides the tools:
   - `person` → `ask_clarification`. An agent that answers to another agent (Clara to Avery) is not `person`.
   - `data` → the whole data kit: `list_entities`, `describe_entity`, `run_readonly_sql` and `explore_result`, with `sample_rows` when it needs raw rows. Its answers then reach the query inspector (step 4).
   - `orchestrator` → the agents it calls, as tools with a per-run call limit and a reply written quietly, the way `answer_from_data` and `build_dashboard` are (`mastra/tools/orchestrator.tools.ts`, agents.md 5.23).
   - Deliverables (`show_in_panel`, `submit_dashboard`, `export_conversation`, `create_visual` / `update_visual`, `update_workflow`) → only the roles that produce them, behind the run's gates.
   - `single-step` → no tools: a structured-output contract (agents.md 1.1).

   Never add tools the model would use to run checks (the SQL verifier, the figure check and the result guards run in code), file tools beyond the session workspace's, or a "decisions" lookup the curated-knowledge block already covers.

   After the change, the class check lists no new gap. A gap that stays is either fixed or justified in the agent's `agents.md` entry. The known gap today: `bi-analyst` misses `explore_result`.
4. **[Implement]** **Query inspector.** Every agent that answers from data shows its evidence the same way (existing agents, new ones and user agents alike). Each figure in an answer links to the query behind it. Each query is explained step by step in business words, with the rows at each stage and a coverage label (whole table, top N after ranking, sample, partial result), and any `LIMIT` or row cap is explained in plain words. The full result is one click away. Build it once in the shared layer (the `run_readonly_sql` bridge, the captured tool data, the answer view), never in one agent's prompt or screen, so an agent gets it by using the dataset tools. When you add or change an agent, check that its answers pass through that layer; an agent that cannot use it says why in its spec. Rules: [agent-answers](../../../specs/capabilities/agent-answers/spec.md), *Query inspector*. A host turns it on with the answer view's `queryInspector` input and provides `QUERY_EVIDENCE_API`; today the hosts are the Run panel and the run detail page, for every workflow run whose answer ran queries, plus past chats and Try it. Connect another host to it rather than add another way of showing an agent's queries.
5. **[Implement]** A new agent follows the backend code rules in [`workflow-implement`](../workflow-implement/SKILL.md) (its file, built with `defineBuiltinAgent`, its registration, its `agents.md` entry). A new instruction goes last in the agent's instructions and fires on a cue the request itself carries ([lessons.md](../../../lessons.md), *Evals and agents*).
6. **[Checks]** Rebuild the backend and run the inventory with `--compare` against the base. It must exit 0, and the class check must show no new gap. When the comparison names agents, their evals run: run them as [`verify`](../verify/SKILL.md), *Evals*, says. For a failed case, read its `toolCalls` before touching code.

**Reply:** the agent's classes and its tools against its kits, what it receives now that it did not before (the inventory's comparison), and each eval case's pass rate on the base and on the branch.
