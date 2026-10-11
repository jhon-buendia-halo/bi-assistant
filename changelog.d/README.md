# Changelog fragments

Each story adds one file here instead of editing [changelog.md](../changelog.md). On every merge to `main`, `version-on-merge.yml` runs `python3 scripts/fragments.py collect`, which writes the fragments into a `## <date> — v<version>` section and deletes them. Rules: *Logging convention* in [CLAUDE.md](../CLAUDE.md).

**Name:** `<STORY>.md`, e.g. `BA-172.md`. A story with a second kind of change adds `<STORY>-<suffix>.md`, e.g. `BA-172-fixed.md`.

**Format:**

```markdown
---
type: added            # added | changed | fixed | removed | cut
story: BA-172
epic: BA-89            # the parent epic (the story key itself for an epic-level change)
roadmap: 0.2.8         # the roadmap feature ID
title: Wireframes: an as-built set per role and a skill to co-design and sync them
evidence: evidence/0.2.8/   # or `none: <why there is no artifact>`
---
- One point per line when there are several; a single paragraph otherwise.
- Links are relative to the repo root, as they will read in changelog.md: [design/wireframes/](design/wireframes/README.md).
```

**Becomes, in `changelog.md`:**

```markdown
## 2026-10-12 — v0.30.0

### Added
- **Wireframes: an as-built set per role and a skill to co-design and sync them** (roadmap 0.2.8, [BA-172](https://halo-powered.atlassian.net/browse/BA-172), epic [BA-89](https://halo-powered.atlassian.net/browse/BA-89)):
  - One point per line when there are several; a single paragraph otherwise.
  - …
  - Evidence: [evidence/0.2.8/](evidence/0.2.8/).
```

**Check:** `python3 scripts/check-specs.py --base origin/main` (CI check 10) · **Preview:** `python3 scripts/fragments.py collect --version <next> --dry-run`.
