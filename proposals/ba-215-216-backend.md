# Proposed spec wording changes, BA-215 / BA-216 backend

The contract was implementable as written. These are gaps the code had to decide; each proposal states the behaviour that shipped.

1. **api.md 96, body check.** Add: "The check covers the `reference/<name>.md` paths the body names, found the way a folder skill's body is checked (agents.md 7.3, `phases|reference(s)/….md`); a body that names `reference/data.csv` is not checked." The data-model 3.10.1 row says "every `reference/…` path", which the shipped regex narrows to `.md` names.
2. **api.md 41/42, order.** Add: "`Unknown skill` is checked after the name checks and before `at most 10 skills`; ids are de-duplicated first, so the count is of distinct ids."
3. **api.md 94, `agents`.** Say the names are the agents' current draft names (not the Live name) when an agent's draft or Live version names the skill.
4. **api.md 43 / data-model 3.10, publish.** Add: "`live.skills` keeps only the ids that still have a skill to copy; `liveSkills` is `[]` after a republish that drops every skill, and absent for an agent that never had one."
5. **data-model 3.10, transfer.** Add: "Only skills the draft names are copied. An id that only `live.skills` / `liveSkills` names (the draft dropped it) keeps its old id, since its `liveSkills` copy is self-contained. A copied name that would pass 64 characters is truncated before the `-2` suffix."
6. **agents.md 7.3, replacement.** Say an agent skill replacing a same-named user or project skill removes it from the call's catalog only; `read_file` still reads that user or project skill's folder by its absolute path (the allow-list is the assistant's startup catalog). If it must be unreadable, say so and the allow-list needs the call's catalog.
7. **api.md 34a.** The in-app skills are appended after the assistant's, sorted by name among themselves (not merged into one sorted list), matching "followed by".
8. **agents.md 2.1 / api.md 33 (`GET /agents/:key`).** The detail's `instructions` for a user agent is the assistant's prompt for its tool selection only; it does not include the `## Skills` entries of the agent's in-app skills. Either accept that, or the detail should carry `agent-skills` too (small change in `AgentsService.toolSelectionContext`).
9. **agents.md 4.2, `agent-skills`.** The prompt for a call with skills is rebuilt per call and not memoised (the tool set is the cached base variant, unchanged); say so in the memoisation sentence.
