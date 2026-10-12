# 0.2.8 — Wireframes skill and the as-built baseline (BA-172)

There are no application changes, so there is no E2E run. The evidence is the wireframes themselves and the spec check.

| Artifact | Shows |
|---|---|
| [wireframes/](wireframes/) | `render.mjs` output for all 20 as-built pages at 1440 × 960: User CU1–CU7 (plus CU6b, CU7b), Maker CM1–CM4, Platform admin CA1–CA7. Each was compared by eye with the app's evidence screenshots (2.1.2–2.1.6, 1.9.3–1.9.5, 1.8.6–1.8.8). |
| [render-results.txt](render-results.txt) | Every page renders with no missing icon and no console error (exit 0). |
| [check-specs.txt](check-specs.txt) | `python3 scripts/check-specs.py` passing, with check 9: "20 wireframe pages are complete and indexed". |
| [check-specs-negative.txt](check-specs-negative.txt) | The same check failing (exit 1) when CU7b is removed from `design/wireframes/index.html`; the index was restored afterwards. |

Changed: [design/wireframes/](../../design/wireframes/README.md), the skill [.claude/skills/wireframes/](../../.claude/skills/wireframes/SKILL.md), *Wireframe convention* and workflow steps 5 and 10 in [CLAUDE.md](../../CLAUDE.md), check 9 in [scripts/check-specs.py](../../scripts/check-specs.py), feature 0.2.8 in [roadmap.md](../../roadmap.md), the story row in [specs/epics/BA-89/spec.md](../../specs/epics/BA-89/spec.md), and [specs/system/ui.md](../../specs/system/ui.md): a pointer to the wireframes, and the stale "The agent editor arrives with BA-155" removed from the §7 copy list.

Not done: the Figma board was not updated through the MCP (the Collab seat's call limit). Import with html.to.design or the PNGs, as described in the skill.

Branch: `docs/BA-89-delivery-process`.
