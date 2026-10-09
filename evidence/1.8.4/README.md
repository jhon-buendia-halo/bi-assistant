# 1.8.4 — Shared components (BA-145)

| Artifact | Shows |
|---|---|
| [compiled-classes.txt](compiled-classes.txt) | Which of the 25 component classes are in the built renderer CSS, and that `components.css` contains no hex colours. Unused classes are tree-shaken until a template uses them. `chip`, `field` and `menu` already appear because Tailwind v4 picks up candidate names from any source text (here, words in TypeScript comments). A search of every template found no element that carries these class names, so nothing existing is restyled. |
| [e2e-results.txt](e2e-results.txt) | `appearance.spec.ts` 4/4 with the section now built from `card` and `field-label`, and `layout-accessibility.spec.ts` 2/3. The failure is the visual baseline, which only exists for macOS (`-darwin.png`). Its Linux output was deleted, not committed. The baseline is regenerated in 1.8.7. |

This is a CSS-only story: no flow changed, so the run is targeted at the specs that render the changed section. The full suite runs again at the end of 1.8.3.
