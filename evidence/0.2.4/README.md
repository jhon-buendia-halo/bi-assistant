# Evidence — 0.2.4 Require PR approval on main (BA-110)

CI, repo-settings and docs change only: no product code changed, so the E2E suite was not re-run.

- [ruleset-probe.txt](ruleset-probe.txt) shows the planned rule tested on a throwaway branch with a temporary ruleset and deploy key:
  - the admin's direct push was rejected;
  - a push authenticated with only the deploy key was accepted;
  - an unapproved PR (#48) could not be merged normally but merged with `gh pr merge --admin`.
- Repo settings created for the release push: write deploy key "version-on-merge release push (BA-110)" (id 165450677) and repo secret `RELEASE_DEPLOY_KEY`.
- `python3 scripts/check-specs.py` passed. `actionlint` reports one shellcheck warning (SC2209, `level=patch`) in the version-bump step. It is identical on `origin/main`, so this change didn't introduce it.
- [release-run.txt](release-run.txt) records the rollout. Ruleset 24514122 was created on `main`, and PR #49 was blocked without approval and merged with `--admin`. [Release run 37335141305](https://github.com/jhon-buendia-halo/bi-assistant/actions/runs/37335141305) pushed `chore(release): v0.20.7` with the deploy key.
- It also records a regression found in that run: the deploy-key tag push started an installer build. It was cancelled, and no release was published. The follow-up PR pushes the tag with `GITHUB_TOKEN` again.
