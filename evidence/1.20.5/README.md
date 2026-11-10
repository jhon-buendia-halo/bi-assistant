# 1.20.5 — Let users select and copy any text in the app (BA-326)

[e2e-results.txt](e2e-results.txt): `layout-accessibility.spec.ts` "text in the app can be selected" — triple-clicking the home heading selects its text (computed `user-select` is not `none`), and dragging the right panel's splitter selects nothing while `.resizing-right-panel` is set. The two axe scans pass with selection enabled. The visual-baseline scenario fails only because this Windows machine has no win32 baseline (same on main).

App unit test: `app.spec.ts` "lets the user select text anywhere (BA-326)".
