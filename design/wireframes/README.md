# Wireframes

Wireframes of Agentic Hub, one HTML page per screen, at the desktop size the Figma board uses (1440 × 960). They are drawn with the app's own theme tokens and component classes, so they look like the app and follow its design changes.

- **Browse:** open [index.html](index.html) in a browser.
- **Flows:** [flows.md](flows.md) has the as-built workflow per role, and how it compares with the proposed board.
- **Procedure:** the `wireframes` skill ([.claude/skills/wireframes/SKILL.md](../../.claude/skills/wireframes/SKILL.md)) covers co-designing, syncing after a UI change, rendering and importing into Figma.
- **Rule:** *Wireframe convention* in [CLAUDE.md](../../CLAUDE.md).

## Layout

```
design/wireframes/
  index.html               every page, grouped; check-specs.py fails if a page is missing here
  flows.md                 as-built flows per role (Mermaid) and the comparison with the proposal
  _kit/hub.css             imports frontend/src/styles/tokens.css and components.css, plus wf- layout helpers
  _kit/shell.js            draws the frame, rail, banner, page card and details panel around a page
  _kit/icons.js            generated lucide subset (build-icons.mjs); do not edit
  as-built/user/CU*.html   what a User sees today (Data owner and Approver see the same)
  as-built/maker/CM*.html  what a Maker adds
  as-built/admin/CA*.html  what a Platform admin adds
  proposed/<EPIC-ID>/      screens being co-designed for an epic; deleted when the epic ships
  _renders/                PNG output of render.mjs (git-ignored)
```

## Page contract

A page writes only its own content; `shell.js` adds the rest. The comment at the top of [_kit/shell.js](_kit/shell.js) is the full contract. In short:

```html
<!doctype html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <title>CU2 · Agents: discover, pin, Start chat</title>
  <meta name="wf-status" content="as-built">          <!-- as-built | proposed (must match the folder) -->
  <meta name="wf-version" content="v0.29.0">          <!-- released version it matches, or "BA-123 (unreleased)" -->
  <meta name="wf-role" content="user">                <!-- user | maker | admin -->
  <meta name="wf-spec" content="specs/system/ui.md#44-agent-hub">
  <link rel="stylesheet" href="../../_kit/hub.css">
  <script src="../../_kit/icons.js"></script>
  <script src="../../_kit/shell.js" defer></script>
</head>
<!-- Workflow step and endpoints, e.g. "Pin applies at once: PUT /agents/:key/pin" -->
<body data-area="Agents" data-role="user" data-mode="org" data-initials="JB" data-sessions='[["Cup historian","Cup historian · World Cup Core"]]'>
  <main> … page content … </main>
  <aside data-panel="Preview" data-width="460"> … optional details panel … </aside>
  <div class="wf-overlay"> … optional dialogs, toasts, numbered notes … </div>
</body>
</html>
```

- Use the app's classes (`btn btn-primary`, `chip chip-success`, `card`, `field`, `list-row`, `filter-pill`, …) and the helpers in `hub.css` (`row`, `col`, `grid3`, `h2`, `micro`, `wf-table`, `wf-dialog`, …). No hex colours.
- Icons: `<i data-lucide="bot" data-size="16"></i>`, lucide names as in ui.md §6.4. Run `build-icons.mjs` after adding one.
- Query string: `?notes=0` hides co-design notes; `?theme=dark` renders the Dark theme.
- The fonts come from `frontend/node_modules/@fontsource/noto-sans`; without `node_modules` the page falls back to the system sans.
