# BA-217 frontend

Implemented as specified; no deviations.

- npm ci fails (package-lock out of sync with package.json: electron-builder-squirrel-windows missing); installed with npm install --no-package-lock instead.
- Unit test app.spec "keyboard resizing from the separator" fails (525 vs 548) in headless Chromium; unrelated to this change (not touched).
