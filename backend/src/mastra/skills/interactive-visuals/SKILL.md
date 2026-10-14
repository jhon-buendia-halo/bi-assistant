---
name: interactive-visuals
description: Use when turning a completed, data-grounded analysis answer into a JSON chart spec (or, as a fallback, a self-contained HTML/CSS/JavaScript visual) for the Questions to Insights session panel.
---

# Interactive Visuals

Turn the supplied question and answer into one focused visual explanation.

When the request asks for a **spec**, that is all you return: a small JSON
document. A fixed runtime draws it — axes, tooltips, legends, keyboard focus,
click-to-follow-up, empty states, number formatting and dashboard filtering are
already built and are not yours to write. You choose the form and the columns.
The spec and its rules are in references/spec-mode.md.

The freeform HTML/CSS/JavaScript path in references/freeform.md is the
fallback, used only when the request asks for a code bundle.

Each request comes with the one reference its mode needs, after this text.
