# BA-218 backend: spec proposals

- api.md 34a: add `modified?: boolean` to each `skills[]` entry of `AgentSkillsView` (present and true only when an in-app override of a built-in is served; absent otherwise). Such an entry keeps `level: 'built-in'`, `loading` and `agents` of the built-in, and `overrides` lists the user/project levels that also held the name; `files[].size` is the override's served size.
- data-model 3.10.2 `baseHash`: define it as SHA-256 hex of `JSON.stringify([description, body, [[path, content], ...files sorted by path]])` of the shipped built-in (files = its `phases/`, `reference/`, `references/` files).
- api.md 101: files are stored in the built-in's file order; a path given twice keeps its first occurrence for the checks. `updatedBy` falls back to `local` when no user is signed in.
- api.md 102 success message for reset is `Built-in skill "<name>" reset` (as spec'd); no `skill` in the response.
