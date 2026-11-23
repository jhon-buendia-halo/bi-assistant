/*
 * The theme of every visual's frame, in a module of its own with no import:
 * a page that stands outside the app frame (a downloaded dashboard) takes it
 * without loading the document builder (./visualization-document.ts).
 */

/**
 * The frame's colour tokens, Light and Dark, per brand (ADR-0045). They mirror
 * the app's own theme tokens (ui.md 6.0) so a visual reads as part of the
 * panel around it, and the series palette keeps 3:1 against each theme's page
 * colour. Halo Powered is the default; the host panel sets
 * `data-brand="mercer"` on the root of an Agentic Hub build's frames.
 */
const LIGHT_TOKENS = `
  color-scheme: light;
  --qti-bg: #ffffff;
  --qti-fg: #2a2a2a;
  --qti-fg-strong: #181818;
  --qti-fg-muted: #5f5f5c;
  --qti-surface: #f6f6f4;
  --qti-border: #e3e3df;
  --qti-link: #d4380f;
  --qti-focus: #ed3e13;
  /* Categorical series palette — accessible on the white page. */
  --qti-cat-1: #0284c7; /* sky-600 */
  --qti-cat-2: #d97706; /* amber-600 */
  --qti-cat-3: #059669; /* emerald-600 */
  --qti-cat-4: #7c3aed; /* violet-600 */
  --qti-cat-5: #e11d48; /* rose-600 */
  --qti-cat-6: #0891b2; /* cyan-600 */
  --qti-cat-7: #65a30d; /* lime-600 */
  --qti-cat-8: #ea580c; /* orange-600 */
  --qti-pos: #059669;
  --qti-neg: #dc2626;
  --qti-grid: rgb(0 0 0 / 0.08);
  --qti-axis: rgb(0 0 0 / 0.6);
  --qti-tooltip-bg: #ffffff;
  /* Text on a filled series colour (pie slices, dense heatmap cells). */
  --qti-on-cat: #ffffff;`;

const DARK_TOKENS = `
  color-scheme: dark;
  --qti-bg: #242424;
  --qti-fg: #d9d9d9;
  --qti-fg-strong: #ffffff;
  --qti-fg-muted: #a3a3a3;
  --qti-surface: #2b2b2b;
  --qti-border: #363636;
  --qti-link: #ff7a3d;
  --qti-focus: #ff9361;
  /* Categorical series palette — accessible on the dark page. */
  --qti-cat-1: #38bdf8; /* sky-400 */
  --qti-cat-2: #fbbf24; /* amber-400 */
  --qti-cat-3: #34d399; /* emerald-400 */
  --qti-cat-4: #a78bfa; /* violet-400 */
  --qti-cat-5: #fb7185; /* rose-400 */
  --qti-cat-6: #22d3ee; /* cyan-400 */
  --qti-cat-7: #a3e635; /* lime-400 */
  --qti-cat-8: #fb923c; /* orange-400 */
  --qti-pos: #34d399;
  --qti-neg: #f87171;
  --qti-grid: rgb(255 255 255 / 0.08);
  --qti-axis: #a3a3a3;
  --qti-tooltip-bg: #303030;
  --qti-on-cat: #141414;`;

/** Agentic Hub (Mercer) overrides of the page tokens, as before the rebrand (ADR-0007). */
const MERCER_LIGHT_TOKENS = `
  --qti-fg: rgb(0 0 0 / 0.85);
  --qti-fg-strong: #001f52;
  --qti-fg-muted: rgb(0 0 0 / 0.6);
  --qti-surface: #f8fafc;
  --qti-border: rgb(0 0 0 / 0.1);
  --qti-link: #0b41ad;
  --qti-focus: #0b41ad;`;

const MERCER_DARK_TOKENS = `
  --qti-bg: #12233a;
  --qti-fg: #d5dfec;
  --qti-fg-strong: #eef4fc;
  --qti-fg-muted: #93a6bf;
  --qti-surface: #16294a;
  --qti-border: #24384f;
  --qti-link: #5b95ff;
  --qti-focus: #7fb0ff;
  --qti-axis: #93a6bf;
  --qti-tooltip-bg: #1a3357;
  --qti-on-cat: #0b1626;`;

/**
 * The frame's theme tokens and page background. The host panel sets
 * `data-theme` on the root to the app's resolved theme; a document without
 * it (a downloaded `index.html`) follows the operating system.
 */
export const FRAME_TOKENS_CSS = `
:root {${LIGHT_TOKENS}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {${DARK_TOKENS}
  }
}
:root[data-theme="dark"] {${DARK_TOKENS}
}
:root[data-brand="mercer"] {${MERCER_LIGHT_TOKENS}
}
@media (prefers-color-scheme: dark) {
  :root[data-brand="mercer"]:not([data-theme="light"]) {${MERCER_DARK_TOKENS}
  }
}
:root[data-brand="mercer"][data-theme="dark"] {${MERCER_DARK_TOKENS}
}
html, body { margin: 0; background: var(--qti-bg); }
`;

/**
 * The theme tokens alone, for a page that stands outside the app frame (a
 * downloaded dashboard): light and dark by the operating system, the Agentic
 * Hub overrides, and the page background.
 */
export function standaloneFrameCss(): string {
  return FRAME_TOKENS_CSS;
}
