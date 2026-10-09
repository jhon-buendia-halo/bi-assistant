# 1.8.6 — Restyle feature screens (BA-147)

Web target, 2026-10-09, isolated compose project `qti-ba-141` on port 55433.

| Artifact | Shows |
|---|---|
| [e2e-results.txt](e2e-results.txt) | The full web suite: 44 passed, 2 skipped (desktop only). It includes `layout-accessibility.spec.ts` › "has no automatically detectable accessibility violations on any screen in either theme" (new): axe across Datasets, the dataset editor, Agents, an agent's detail, Knowledge, Sessions, the composer and all five Settings sections, in Light and in Dark. `developer-settings.spec.ts` now asserts the token classes `text-on-success-soft` / `text-on-danger-soft`. |
| `datasets-*`, `dataset-editor-*`, `agent-detail-*`, `knowledge-*` | The data screens in both themes. |
| `settings-{datasources,llm,testing-data,developer}-*` | The settings forms in both themes. |

How the restyle was checked: two subagents converted the templates in parallel. A script then stripped every `class` / `[class…]` attribute and compared each template with HEAD: 0 differences, so no text, label, test id or binding changed. A grep for hex colours, palette shades and white/black alpha over `frontend/src/app` returns nothing.

**Desktop not run:** the 2 desktop-only scenarios listed in [../1.8.5/README.md](../1.8.5/README.md).
