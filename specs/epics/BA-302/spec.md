# BA-302 — Desktop installer builds

- **Jira:** [BA-302](https://halo-powered.atlassian.net/browse/BA-302) · **Roadmap:** Milestone 1.18 · **Status:** Confirmed (2026-11-04)

## Goal

Releases publish the desktop installer we actually ship, without waiting on runners for platforms we no longer distribute. From 2026-11-04 that is the Windows x64 installer only: the "Build desktop installers" workflow builds and publishes it, and nothing else.

## Scope

- **Windows-only release builds.** `.github/workflows/build-desktop.yml` loses its macOS Apple Silicon and macOS Intel inputs and matrix entries. A manual run and a `v*` tag push both build Windows x64 only; `publish` attaches that `.exe` to the release as today.
- **Product requirement.** [non-functional.md](../../product/non-functional.md) N1 changes from "macOS arm64, macOS x64 and Windows x64" to Windows x64.
- **Specs and docs.** [delivery.md](../../system/delivery.md) §5 (`build-desktop.yml` inputs and jobs), the README's desktop-app paragraph and the `version-on-merge.yml` header comment describe the Windows-only build.

## Out of scope

- The product page's macOS download buttons (`site/`). They keep serving the newest release that carries a macOS installer (v0.16.1).
- The electron-builder macOS configuration and `npm run electron:dist -- --mac …`: a developer can still build a `.dmg` locally; it is just not built or published by CI.
- The desktop E2E project, which runs locally on macOS, and the macOS-specific app behaviour (traffic lights, Dock, quit-on-close).
- Code signing.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-303](https://halo-powered.atlassian.net/browse/BA-303) | Build only the Windows installer | 1.18.1 |

All stories are built on one branch, `ci/BA-302-windows-only-installer`, and ship as one PR.

## Specs touched

- [product/non-functional.md](../../product/non-functional.md): N1, the shipped platforms (BA-303).
- [system/delivery.md](../../system/delivery.md): §5 `build-desktop.yml` (BA-303).

## Acceptance

- The "Build desktop installers" run form offers no macOS options.
- A manual run with `publish=true` runs one build job, Windows x64, and attaches `Questions-to-Insights-<version>-win-x64.exe` to the release.
- `python3 scripts/check-specs.py` passes and actionlint is clean on the workflow.

## Dependencies, risks and open questions

- **Intel and Apple Silicon Mac users** get no new versions after v0.16.1 through the product page; the macOS buttons stay on that release.
- **Release run after merge.** Per the retrospective, after merging a release-workflow change, watch the next build run to completion and record it in the evidence.
- **Depends on** nothing outside this epic.
