# BA-223 backend report

## Changed
- NEW backend/src/mastra/assistant-skills.ts: `assistantSkillSources(agentSkills?)`, `assistantSkills(requestContext)` (createSkill per skill, links resolved in instructions and references, sorted by name, agent skill replaces same-named folder skill).
- NEW backend/src/mastra/assistant-skills.spec.ts (folder skill, references without scripts/binaries, agent replaces folder skill).
- NEW backend/src/mastra/testing/mastra-skills.stub.ts + package.json jest `moduleNameMapper` for `@mastra/core/skills` (the real module needs ESM-only p-map, Jest cannot load it); tsconfig.build.json excludes `**/*.stub.ts`.
- backend/src/mastra/agents/assistant.agent.ts: `skills: ({ requestContext }) => assistantSkills(requestContext)`; no skill tools in ALL_TOOLS; `assistantVariant(selection)` only (no agent-skills arg, no overrides-version cache; the prompt no longer depends on skills).
- backend/src/mastra/agents/assistant-prompt.ts: removed skillsSection/escapeXml; `buildAssistantInstructions(tools, selection)`.
- backend/src/mastra/app-skills.ts: added `skillReferences(skill)` (served text files except SKILL.md and scripts/, keyed by path); comments updated.
- backend/src/mastra/agent-skills.ts: removed `/in-app-skills/` paths, CatalogEntry, mergedCatalog, readInAppPath, inAppLocation; kept context key, AgentSkill, agentSkillsFrom, renderSkillDocument.
- Comment-only edits: agent-links.ts, context-blocks.ts, sessions.service.ts.
- Tests updated: assistant.agent.spec.ts (rewritten skills block, tool lists without read_file), assistant-prompt.spec.ts, agent-skills.spec.ts, built-in-skills.service.spec.ts.
- Golden fixture regenerated from the real `assistantAgent.getInstructions()` (temp dump spec deleted).

## Removed
backend/src/mastra/skill-tools.ts, backend/src/mastra/skill-tools.spec.ts.

## Checks (backend)
- npm test: 75 suites, 1249 tests, all pass.
- npm run lint: 0 errors (2 pre-existing warnings in main.ts and retry-fetch.ts). npm run build: ok.

## Mastra 1.66 skill tools and system messages (from dist source, and verified `resolveSkills` on the built agent)
Tools: `skill({ name })`, `skill_search({ query, skillNames?, topK? })`, `skill_read({ skillName, path, startLine?, endLine? })`. (Added at the Agent level by listSkillTools / createSkillTools.)
`skill` description: "Activate a skill to load its full instructions. You should activate skills proactively when they are relevant to the user's request without asking for permission first."
Two system messages are injected (SkillsProcessor) when at least one skill resolves:
1. The catalog:
```
<available_skills>
  <skill>
    <name>curated-knowledge</name>
    <description>Use when the turn carries ...</description>
    <location>inline/curated-knowledge/SKILL.md</location>
    <source>local</source>
  </skill>
</available_skills>
```
2. "IMPORTANT: Skills are NOT tools. Do not call skill names directly as tool names. To use a skill, call the `skill` tool with the skill name as the "name" parameter. If multiple skills share the same name, use the exact location (shown in the location field) instead of the name to disambiguate. The location field identifies a skill for the `skill` and `skill_read` tools; it is not guaranteed to exist on your workspace filesystem, so read skill files with `skill_read` rather than with filesystem tools. When a user asks about a topic covered by an available skill, activate it immediately without asking for permission first."

Notes: reference keys are served by `skill_read` as `references/<key>`, so a key `reference/quarters.md` is read as `references/reference/quarters.md` (keys kept as the file paths, as requested). Skill names must match lowercase/digits/hyphens, up to 64 chars (createSkill throws otherwise; in-app names already follow that rule, folder skills are validated at load by the app).

## Golden prompt size
Fixture file (portable paths): 8,684 chars before, 7,692 after (-992). On the real machine before: 8,729 (paths longer). The diff is exactly the `read_file` tool line and the `## Skills` section.

## BA-222 backend
No backend change needed: the Chat Box reuses `POST /sessions` with `{ agentId, preview: true }` (sessions.controller.ts) and the System Prompt tab saves through `PUT /agents/:id/draft` (agents.controller.ts), both existing.

## Not done / for the gate
Evals, Playwright, check-specs not run (as instructed). specs/ (agents.md 3.9, 3.10, 7.5, Appendix A) still need the matching update by the caller.
