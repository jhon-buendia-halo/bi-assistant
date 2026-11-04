# BA-302 — Desktop installer builds

- **Jira:** [BA-302](https://halo-powered.atlassian.net/browse/BA-302) · **Roadmap:** Milestone 1.18 · **Status:** Confirmed (2026-11-04; scope widened to the product page with BA-304, re-confirmed the same day)

## Goal

Releases publish the desktop installer we actually ship, without waiting on runners for platforms we no longer distribute. From 2026-11-04 that is the Windows x64 installer only: the "Build desktop installers" workflow builds and publishes it, and nothing else.

## Scope

- **Windows-only release builds.** `.github/workflows/build-desktop.yml` loses its macOS Apple Silicon and macOS Intel inputs and matrix entries. A manual run and a `v*` tag push both build Windows x64 only; `publish` attaches that `.exe` to the release as today.
- **Product requirement.** [non-functional.md](../../product/non-functional.md) N1 changes from "macOS arm64, macOS x64 and Windows x64" to Windows x64.
- **Product page.** bi-assistant.halo-powered-labs.com (`site/`) offers only the Windows download: no macOS cards, Gatekeeper note or macOS platform copy (BA-304). The `/download/mac-*` routes stay, unlinked, so old links still resolve.
- **Specs and docs.** [delivery.md](../../system/delivery.md) §5 (`build-desktop.yml` inputs and jobs), the README's desktop-app paragraph and the `version-on-merge.yml` header comment describe the Windows-only build.

## Out of scope

- Removing the `/download/mac-*` routes and the macOS entries of `/api/latest`. They keep serving the newest release that carries a macOS installer (v0.13.1).
- The Labs home page.
- The electron-builder macOS configuration and `npm run electron:dist -- --mac …`: a developer can still build a `.dmg` locally; it is just not built or published by CI.
- The desktop E2E project, which runs locally on macOS, and the macOS-specific app behaviour (traffic lights, Dock, quit-on-close).
- Code signing.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-303](https://halo-powered.atlassian.net/browse/BA-303) | Build only the Windows installer | 1.18.1 |
| [BA-304](https://halo-powered.atlassian.net/browse/BA-304) | Product page offers only the Windows installer | 1.18.2 |

BA-303 shipped on `ci/BA-302-windows-only-installer` (PR #84). BA-304 was added after that PR merged and the branch was deleted, so it is built on `ci/BA-302-windows-only-site` and ships as a second PR.

## Specs touched

- [product/non-functional.md](../../product/non-functional.md): N1, the shipped platforms (BA-303).
- [system/delivery.md](../../system/delivery.md): §5 `build-desktop.yml` (BA-303); §8 the product page's download routes (BA-304).

## Acceptance

- The "Build desktop installers" run form offers no macOS options.
- A manual run with `publish=true` runs one build job, Windows x64, and attaches `Questions-to-Insights-<version>-win-x64.exe` to the release.
- `python3 scripts/check-specs.py` passes and actionlint is clean on the workflow.
- The live page shows one download card, Windows, serving the newest release, with no macOS text; `/download/win-x64` redirects to the `.exe` and `/download/mac-arm64` still resolves.

## Dependencies, risks and open questions

- **Intel and Apple Silicon Mac users** get no new versions after v0.13.1; the page no longer offers macOS, and the unlinked macOS routes stay on that release.
- **Release run after merge.** Per the retrospective, after merging a release-workflow change, watch the next build run to completion and record it in the evidence.
- **Depends on** nothing outside this epic.
