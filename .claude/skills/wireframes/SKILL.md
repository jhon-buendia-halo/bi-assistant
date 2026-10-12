---
name: wireframes
description: Co-design and maintain the Agentic Hub wireframes in design/wireframes/ — HTML pages, one 1440×960 screen each, built from the app's own tokens and component classes. Use when the user wants to sketch, mock up, wireframe or co-design a new or changed screen or flow ("proposed" wireframes for an epic), when a change alters the UI and the "as-built" wireframes must be brought back in line with the app, when asked to render or review wireframes, or to get them into Figma.
user-invocable: true
disable-model-invocation: false
---

# Wireframes

The wireframes live in [design/wireframes/](../../../design/wireframes/README.md). Read its README first: it has the folder layout, the page contract and the index. This skill is the procedure.

There are two kinds of page:

- **As-built** (`as-built/<role>/`): what the shipped app shows today, one folder per role (`user`, `maker`, `admin`). The app is the truth. When the app changes, these pages change in the same PR.
- **Proposed** (`proposed/<EPIC-ID>/`): screens being co-designed for an epic before they are specified. The user is the truth. When the epic ships, they are folded into as-built and the folder is deleted.

The rule that makes this mandatory is the *Wireframe convention* in [CLAUDE.md](../../../CLAUDE.md).

## Tools

| Command | What it does |
|---|---|
| `node .claude/skills/wireframes/scripts/render.mjs [--out DIR] [--theme dark] [--no-notes] [pages…]` | Screenshots pages at 1440×960 with the frontend's Playwright. With no pages, renders all of them to `design/wireframes/_renders/` (git-ignored). Prints `WARN` for missing icons or console errors and exits 1. |
| `node .claude/skills/wireframes/scripts/build-icons.mjs` | Regenerates `_kit/icons.js` with every lucide icon the pages use, from the app's `lucide-angular`. Run it after adding a `data-lucide` name. |
| `python3 scripts/check-specs.py` | Check 9 fails when a page lacks its metas, sits in the wrong folder or is missing from `index.html`. CI runs it on every PR. |

Both node scripts need `frontend/node_modules`. In a worktree without it, symlink the main checkout's: `ln -s <main-checkout>/frontend/node_modules frontend/node_modules` (git-ignored).

**Look at every render** with the Read tool before showing it to the user or calling the work done. The frame is fixed at 1440×960, so check for clipped text, overlap and content pushed off the bottom.

## Mode 1 — Co-design proposed wireframes (new UI)

Use this at workflow step 2–5, after the epic exists and before the specs are written.

1. **Start from what exists.** Find the as-built pages for the screens the epic touches: grep `wf-spec` and titles in `design/wireframes/as-built/`. Copy them into `proposed/<EPIC-ID>/`, keeping the file name and changing the title prefix to the epic (`BA-123 · …`). A brand-new screen starts from the closest page, so it keeps the shell.
2. **Change only what the epic changes.** Use the app's classes (`btn`, `chip`, `card`, `field`, `list-row`, `filter-pill`, …) and its copy style (ui.md §7). Invent no colours or components; if a new component is needed, build it from the tokens and say so in a note.
3. **Write the decisions down on the page.** Every open question, assumption or behaviour that the picture can't show gets a numbered note: `<div class="wf-overlay"><div class="wf-note" data-n="1" style="left:…;top:…">…</div></div>`. Notes are what the user reacts to; keep them short.
4. **Show, ask, iterate.** Render the pages, look at them, then send the PNGs to the user (SendUserFile, or name the paths). Ask the open questions from the notes. Change the pages and render again until the user confirms. Record each answer by editing or deleting its note.
5. **Hand off to the specs.** Once confirmed, the pages are the input to step 5: the ui.md screens and copy, and the Gherkin scenarios in the capability spec, describe what the pages show. Set each page's `wf-spec` to the ui.md section it will become. Add the pages to `index.html` under the epic's heading.
6. **On ship (step 10):** for each proposed page, update or create the matching as-built page so it matches what was really built, which may differ from the proposal. Then delete `proposed/<EPIC-ID>/` and its index section. Git history keeps the proposal.

## Mode 2 — Sync as-built wireframes after a UI change

Use this in any change that alters what a user sees: Angular templates or styles under `frontend/src/app/` or `frontend/src/styles/`, `frontend/public/brand/`, or screen and copy sections of `specs/system/ui.md`.

1. **Find the affected pages.** List what changed, `git diff --name-only main... -- frontend/src specs/system/ui.md`. Map each change to its screens: the ui.md section it touches against the pages' `wf-spec`, the visible copy (grep the old string in `design/wireframes/`), and the permission matrix (ui.md §1.6) for which role folders show it.
2. **Update each page to match the running app,** not the spec text alone. Prefer a screenshot of the app from this change's evidence (`evidence/<feature-id>/*.png`) or the E2E run. Keep the example data consistent with the other pages.
   - New screen or state: add a page in every role folder that can reach it, with the next free id (`CU8`, `CM5`, `CA8`), and add it to `index.html`.
   - Screen removed: delete the page and its index entry.
   - Role visibility changed: add or remove the page or control in each role folder.
3. **Set `wf-version`** on each touched page to the story key while unreleased (`BA-172 (unreleased)`). At release the version is known; the next sync on `main` replaces it with `vX.Y.Z`.
4. Token or component class changes need no page edits. `hub.css` imports `frontend/src/styles/tokens.css` and `components.css`, so a re-render picks them up. Re-render and look anyway.
5. Run `build-icons.mjs` if icons changed, then `render.mjs` on the touched pages and `python3 scripts/check-specs.py`. Save the renders of the touched pages into the change's `evidence/<feature-id>/wireframes/`.

If a change touches the UI and no page needs updating, say so in the PR ("Wireframes: no visible change on any page").

## Mode 3 — Get wireframes into Figma

The Figma board for the product is `https://www.figma.com/board/S3DMKrgzGHMl65c5bzvabR`. Figma MCP calls are rate-limited on Collab seats, so the default path uses no MCP calls:

1. **html.to.design** (Figma plugin and Chrome extension): open the page in Chrome (`file://…/design/wireframes/as-built/user/CU2-agents-hub.html`, or serve the folder with `npx http-server design/wireframes`), add `?notes=0` to drop the notes if wanted, and import with the extension. Fonts map to Noto Sans in Figma. Imports land in a Figma design file. To show them on the FigJam board, copy the frames across or use the PNGs.
2. **PNG renders**: `render.mjs` output can be dragged onto the board. With a Figma seat that allows MCP calls, `upload_assets` places a batch of PNGs in one call.

Keep the board's sections in step with the folders: proposed screens next to the epic's flow, as-built screens under "Current implementation".

## Page rules (also in the README)

- One screen per file, `<ID>-<kebab-name>.html`. IDs are `CU` (user), `CM` (maker), `CA` (platform admin) for as-built pages, and the same IDs under an epic for proposals.
- Required metas: `wf-status` (as-built or proposed, matching the folder), `wf-role`, `wf-spec` (the ui.md anchor it mirrors), `wf-version`.
- The first thing in `<body>` is an HTML comment naming the workflow step and the endpoints behind it (from `specs/system/api.md`).
- Exact copy from the app (ui.md §7 and the templates); realistic example data from the World Cup demo set.
- No custom colours: tokens and the app's classes only. Inline styles are for sizes and positions.
