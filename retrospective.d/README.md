# Retrospective fragments

Each story adds one file here instead of editing [retrospective.md](../retrospective.md). On every merge to `main` the release workflow writes it into `retrospective.md`, newest first, and deletes it. Rules: *Retrospective convention* in [CLAUDE.md](../CLAUDE.md).

**Name:** `<STORY>.md`, e.g. `BA-172.md`.

**Format:**

```markdown
---
story: BA-172
roadmap: 0.2.8
title: Wireframes skill and as-built baseline
---
### What went well
- …

### What went wrong
- …

### What to do differently
- A concrete instruction the next change can follow.
```

**Becomes** `## <merge date> — 0.2.8 Wireframes skill and as-built baseline (BA-172)` followed by the body. All three subsections are required (CI check 10).
