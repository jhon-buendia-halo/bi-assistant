### Show the change

Every new feature or change ends with **images that prove it works**, shown to the user in the chat, before the report and before any commit is called done. Prose, test counts or file paths alone are not proof. Each step below fills the workflow step named in brackets.

1. **[Checks]** Rebuild and restart the instance the user tries things on ([`local-instance`](local-instance.md)) so it runs the change, and give it real data: an existing run, chat or dataset, or a new run when the change only shows on new data (a stored field, a new event).
2. **[Checks]** Drive it with Playwright (`frontend/node_modules/playwright`) to the exact place the change shows, in the state that proves it (a dialog opened, a step expanded, a link followed), with real data. Capture one screenshot per screen or state that changed (`deviceScaleFactor: 1` or `2`, under `.context/`). When it changes an existing screen, capture the before as well (from the screenshot the user sent, or from the base build). Look at every image before showing it.
3. **[Checks]** A change with nothing on screen (an endpoint, a stored field, a prompt) is shown where its effect surfaces: the screen that reads it, a run's result, the API's answer in the app. Only when nothing surfaces anywhere, say so and show the check that proves it instead.
4. **[Checks]** Run axe on what changed, in both themes, and say the result next to the images.
5. **[Checks]** Show the images in the chat, never as file paths: **one Conductor artifact per image** (`.context/artifacts/<name>-<n>/index.html`, published with `PublishArtifact`), the image embedded as JPEG under a title that says what it proves. Never stack several images in one artifact: the chat shows only its top.

**Reply:** each artifact followed by one line on what it proves, then what changed, the checks and their results, and the commit.
