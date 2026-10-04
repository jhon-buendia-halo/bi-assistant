# Evidence — 0.2.3 Require the spec check on main (BA-108)

CI and docs change only: no product code changed, so the E2E suite was not re-run.

- [ruleset-probe.txt](ruleset-probe.txt) shows the ruleset rule tested on a throwaway branch. A direct push was rejected, and the "stage, report status, push" sequence the release workflow now uses was accepted.
- `actionlint` reported no findings on `version-on-merge.yml` or `spec-checks.yml`, and `python3 scripts/check-specs.py` passed.
- The ruleset on `main` is **"main: specs match the code"** (id 24455088), active since 2026-10-04 and applied right before PR #45 merged.
- The first release under the ruleset was [run 37202187011](https://github.com/jhon-buendia-halo/bi-assistant/actions/runs/37202187011), triggered by merging PR #45. It succeeded: it pushed `chore(release): v0.20.5` to `main` and the `v0.20.5` tag, and it deleted its `release-staging/<sha>` branch. This closes the last test-plan item.
