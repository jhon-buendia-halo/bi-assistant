none

Frontend of BA-215/BA-216 implemented per ui.md/agents-evals. Assumptions: agent detail draft/live carry `skills: string[]` (ids); POST/PUT /skills answers include `skill.agents`. Skills missing from the library are filtered out of the editor form and saved snapshot after load.
