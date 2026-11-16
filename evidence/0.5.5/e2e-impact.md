# 0.5.5 — E2E impact (step 6)

`@floating-ui/dom` becomes a direct frontend dependency (same version, 1.8.0, already in the lockfile as the peer of `@tiptap/suggestion`). The only code that uses it is the prompt editor's mention suggestions (`frontend/src/app/features/agents/components/prompt-editor/prompt-editor.ts`), so its spec is re-run. `bootstrap.mjs`, `setup-local.mjs` and `.conductor/settings.toml` are developer scripts with no app flow.

| Spec | Decision | Scenarios |
|---|---|---|
| `frontend/e2e/builtin-agent-prompts.spec.ts` | re-run | all; in particular "the shipped assistant prompt shows its tools and skill as chips and the model reads plain mentions" |
