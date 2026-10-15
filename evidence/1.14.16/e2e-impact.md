# 1.14.16 (BA-229) — E2E impact analysis (workflow step 6)

Commit `cac3cf8` (`feat(BA-229)`). Touched: `export_rfp_package` / `export_rfp_draft` (`mastra/tools/rfp.tools.ts`), `modules/rfp-packages/rfp-packages.service.ts` (workspace `rfp/<rfpId>/` and `rfp/<rfpId>/draft/`, the #105 download), the Intellify package route's `draft=true` (`package.controller.ts`, `package.service.ts`, `document.ts`, `common/markdown-pdf.ts`), the eval clean-up of I29 (`rfp.repository.ts`, `rfp.rules.ts`, `rfp.service.ts`), the session chat's package card (`session-chat.html/.ts`) and `testing-data.spec.ts` (+1 SAMPLES row, see 1.14.13).

| Feature (spec file) | Scenario | Decision | Why it fails without the story |
|---|---|---|---|
| RFP builder (`frontend/e2e/rfp-builder.spec.ts`) | The package is downloadable from the chat | **Add** | on `origin/main` there is no RFP Builder, tool or card |
| RFP builder | I export a draft before the review | **Add** | `export_rfp_draft` does not exist before `cac3cf8`: no draft card, no `DRAFT — ` title, no `draft`/`stage` in the manifest |
| RFP builder | A draft never replaces the final package | **Add**, with a new Gherkin scenario (R16 "never overwrites the final package" had none) | before `cac3cf8` there is no draft folder or draft card |
| Intellify RFP API (`backend/test/intellify-api.e2e-spec.ts`) | A draft package is marked DRAFT and carries its stage | **Add**, new Gherkin scenario | **proven**: run against a `git archive` of `cac3cf8^`, it fails with `Expected "# DRAFT — Orchard Manufacturing — 2027 benefits RFP", Received "# Orchard Manufacturing — 2027 benefits RFP"` |
| Intellify RFP API | An eval run's records are deleted whatever their status (I29) | **Add**, new Gherkin scenario | **proven**: on `cac3cf8^` it fails with `Expected 2, Received 1` (only the draft was deleted) |
| Chat and visuals, Sessions started from an agent | (session-chat template changed around the answer cards) | Re-run as-is, listed under 1.14.15 | — |

Totals: Add 5 (3 Playwright, 2 API-level), Update 0, Delete 0, Re-run as-is 2 spec files (shared with 1.14.15; results in `../1.14.15/e2e-rerun-results.txt`, 73/73 passed).

The stub scripts the RFP Builder's tool calls per turn (decided from the request's last user message and the tool results since it); the tools run for real against the embedded Intellify RFP API over the shared `intellify_mercer_demo`. Records the spec creates are deleted by id after each test.

Results: `e2e-results.txt`. Screenshots: `rfp-package-card.png`, `rfp-package-draft-card.png`. Artifacts: `manifest.json` (final) and `manifest-draft.json` (draft at stage 3, `"draft": true, "stage": 3`), taken from the zips the chat downloaded.

## App bugs found (step 9) — the tests keep asserting the specified behaviour

The two failing scenarios fail only on these soft assertions; every other assertion in them passes.

1. **The zip downloads under the RFP's id, not its title.** R9 and the Gherkin ("a file named `rfp-<title>.zip`"), api.md #105 (`rfp-<slug>.zip`, draft `rfp-<slug>-draft.zip`). Received `<rfpId>.zip` and `<rfpId>-draft.zip`. The server's `Content-Disposition` is right; `downloadRfpPackage` in `frontend/src/app/features/sessions/components/session-chat/session-chat.ts` sets `link.download = \`${pkg.rfpId}${pkg.draft ? '-draft' : ''}.zip\``, which wins over it. Fix: name the blob from the response's `Content-Disposition` (observe the response) or compute `rfp-<slug(pkg.title)>[-draft].zip` with #14's slug.
2. **The card links `manifest.json`.** ui.md 4.12 ("`manifest.json` is only in the zip") and R9 ("a link per file (the document in Markdown and PDF, each exhibit)"). The card shows seven links; `session-chat.html` loops over every `pkg.files`. Fix: skip `manifest.json` in the `@for` (the `· 7 files` count stays, as specified).
3. **A draft download toasts `RFP draft downloaded`.** R16 and ui.md 4.12: "the toast is the same", `RFP package downloaded`. `session-chat.ts` `downloadRfpPackage` picks `'RFP draft downloaded'` when `pkg.draft`. Fix: always toast `RFP package downloaded` (or change R16 and ui.md if the new copy is wanted).
