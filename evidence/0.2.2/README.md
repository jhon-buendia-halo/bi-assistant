# Evidence — 0.2.2 Rebuildable system specs (BA-90)

Process and docs change only: no product code or test changed, so the E2E suite was not re-run.

- [spec-checks.py](spec-checks.py) is the acceptance check from roadmap 0.2.2. Run it from anywhere in the repo with `python3 evidence/0.2.2/spec-checks.py`. It checks that:
  - every file listed in `specs/README.md` exists;
  - every relative link in `specs/`, CLAUDE.md and roadmap.md resolves;
  - every Gherkin Feature from the old `gherkin.md` (read from `origin/main`) sits verbatim in exactly one capability spec;
  - every backend route appears in `system/api.md`, every collection in `system/data-model.md` and every registered agent in `system/agents.md`;
  - every capability spec has the required sections.
- [spec-checks.txt](spec-checks.txt) is its output on this branch: all checks passed.
- [check-specs-negative-test.txt](check-specs-negative-test.txt) is the drift test for the CI check [`scripts/check-specs.py`](../../scripts/check-specs.py). Seven faults were injected and then reverted: a new route, a collection, an agent, a Playwright spec with no Feature, a capability missing from the README, a capability missing sections, and a broken link. All 7 matching checks failed, with exit code 1. `spec-checks.py` above is the one-time migration check; `scripts/check-specs.py` is the permanent one.
- [findings.md](findings.md) lists the bugs, security gaps and drift the backfill found. None were fixed.
