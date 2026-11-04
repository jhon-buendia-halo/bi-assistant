# Evidence — 1.18.2 Product page offers only the Windows installer (BA-304)

Static page and docs change only: the product page has no Playwright specs or Gherkin scenarios and no app code changed, so no E2E spec was impacted or re-run. Desktop not run.

- [live-checks.txt](live-checks.txt): curl and Chromium checks of https://bi-assistant.halo-powered-labs.com after deploy `d366ce57` from `ci/BA-302-windows-only-site`:
  - no macOS, Gatekeeper or Apple silicon text in the page; one download card, `win-x64`;
  - `/download/win-x64` redirects to the Windows `.exe` (first bytes `MZ`); `/download/mac-arm64` and `/download/mac-x64` still resolve to v0.13.1 (unlinked); `/download/bogus` is 404;
  - no console errors or failed requests.
- [live-download-desktop.png](live-download-desktop.png): the live download section at 1440×900.
- [local-download-phone.png](local-download-phone.png): the download section at 390×844 from the local preview (`scripts/dev.sh`, no token, so the button reads "Unavailable").
- Release [v0.38.1](https://github.com/jhon-buendia-halo/bi-assistant/releases/tag/v0.38.1) was the first one built and published by the Windows-only workflow (run [41871917670](https://github.com/jhon-buendia-halo/bi-assistant/actions/runs/41871917670): one Windows job, publish succeeded, one asset `Questions-to-Insights-0.38.1-win-x64.exe`). This also covers the publish path 1.18.1's test run did not exercise.
- `python3 scripts/check-specs.py` passed.
- At 17:02Z the page still served v0.38.0: v0.38.1 was published at 16:59:46Z and the page caches the release list for 5 minutes (`CACHE_SECONDS` in `site/lib/github-release.js`). The switch to v0.38.1 needs no deploy; it was not yet observed when this PR opened.
