---
name: visual-options
description: Use when the user asks for suggestions, options or a redesign of something that can be seen (a screen, dialog, panel, layout, chart, canvas flow). Three really different options, each drawn as a wireframe on a real app screenshot with the app's own tokens, one artifact per option, a recommendation, then ask.
---

# Visual options

The user asks for a suggestion, options or a redesign ("how can we improve…", "give me 3 options"), and the change can be seen: a screen, a dialog, a panel, a layout, a chart, a flow on the canvas. Each option is shown as a wireframe image, with what it consists of, before anything is built. Each step below fills the workflow step named in brackets.

1. **[Understand]** Open the real screen in an isolated instance ([`local-instance`](../local-instance/SKILL.md)) and capture it as the user sees it, with real data (a run, a chat, a dataset that exists). Note what it shows today and what it lacks; when the user sent a screenshot, start from that state.
2. **[Understand]** Find what data each option needs and whether the app already stores it. An option that needs data the app does not keep says so; never draw a figure the app cannot produce without saying it is new.
3. **[Clarify]** Design three options that really differ (in layout, in what they show, or in cost), not one design with two straw men.
4. **[Clarify]** Draw each option on the real screen: open it with Playwright (`frontend/node_modules/playwright`), replace or overlay the part that changes with HTML styled by the app's own CSS variables (read them from the live page: `--qti-fg`, `--qti-border`, `--qti-primary`, …), and fill it with the real data from step 1. One screenshot per option (`deviceScaleFactor: 2`), under `.context/`. Look at every image before showing it. ASCII art or prose alone is not a wireframe.
5. **[Clarify]** Show the images in the chat, not as file paths: **one Conductor artifact per option** (`.context/artifacts/<name>-<option>/index.html`, published with `PublishArtifact`), its image embedded as JPEG under the option's title, the recommended one marked in its title. Never stack all options in one artifact: the chat shows only its top, so the user sees option A alone.
6. **[Clarify]** In the reply, for each option: what it consists of, what it reuses, what it costs (new data, new endpoints, what is not stored today). Then the recommendation and why, and ask which one to build. When the user picks, its prototype is the first step of the build.

**Reply:** per option (A, B, C), its embedded artifact followed by what it consists of and its trade-offs, the recommendation, and the question.
