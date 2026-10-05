# Evidence — 0.2.4 Require PR approval on main (BA-110)

CI, repo-settings and docs change only: no product code changed, so the E2E suite was not re-run.

- [ruleset-probe.txt](ruleset-probe.txt) shows the planned rule tested on a throwaway branch with a temporary ruleset and deploy key:
  - the admin's direct push was rejected;
  - a push authenticated with only the deploy key was accepted;
  - an unapproved PR (#48) could not be merged normally but merged with `gh pr merge --admin`.
- Repo settings created for the release push: write deploy key "version-on-merge release push (BA-110)" (id 165450677) and repo secret `RELEASE_DEPLOY_KEY`.
- `python3 scripts/check-specs.py` passed. `actionlint` reports one shellcheck warning (SC2209, `level=patch`) in the version-bump step. It is identical on `origin/main`, so this change didn't introduce it.
- Pending at PR time:
  - the ruleset on `main` is created right before this PR merges;
  - the first release run under it is recorded here afterwards.
