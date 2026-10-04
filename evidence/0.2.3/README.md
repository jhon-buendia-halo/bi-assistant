# Evidence — 0.2.3 Require the spec check on main (BA-108)

CI and docs change only: no product code changed, so the E2E suite was not re-run.

- [ruleset-probe.txt](ruleset-probe.txt) shows the ruleset rule tested on a throwaway branch. A direct push was rejected, and the "stage, report status, push" sequence the release workflow now uses was accepted.
- `actionlint` reported no findings on `version-on-merge.yml` or `spec-checks.yml`, and `python3 scripts/check-specs.py` passed.
- The ruleset on `main` and the first release run under it are linked below once the PR merges.
