# Evidence — 1.18.1 Build only the Windows installer (BA-303)

CI and docs change only: no product code changed, so no E2E spec was impacted or re-run (step-6 analysis: no component, page, service or backend module touched; no Gherkin scenario covers the release workflow). Desktop not run.

- [test-run.txt](test-run.txt) records [run 41869156864](https://github.com/jhon-buendia-halo/bi-assistant/actions/runs/41869156864) of `build-desktop.yml` dispatched from `ci/BA-302-windows-only-installer` (`ae0abe7`) with `publish=false`:
  - the run form has two inputs, `ref` and `publish`; no macOS options;
  - `prepare` emitted one matrix entry, `windows-x64`, and resolved `v0.38.1` (the patch walk-up, since `v0.38.0` belongs to another commit);
  - one build job, **Build Windows x64**, succeeded in 7m17s; Publish release was skipped as intended;
  - one artifact: `questions-to-insights-windows-x64`, 227 MB.
- The `prepare` script was also run locally for an empty ref and for `v0.38.0`: both emit only `windows-x64`.
- `python3 scripts/check-specs.py` passed.
- **actionlint not run:** fetching the release binary was blocked in this session. The workflow YAML parses and the test run above executed it end to end.
- The publish path (`publish=true`) is unchanged by this story and was not exercised; the first real release after merge should be watched to completion (retrospective, 0.2.4).
