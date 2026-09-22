# Eval change log

One entry per iteration of the improvement loop. The run logs in `logs/evals/`
record *what* the numbers were; this file records *why* someone changed
something, which no tool can reconstruct later.

Append a new entry at the top. Keep each one short.

## Template

```markdown
## YYYY-MM-DD — <one-line summary>

- **Suite:** health-insurance
- **Lever:** prompt rules | tools & guards | context | model & mode
- **Change:** what was actually edited, in one or two sentences.
- **Why:** the failure the eval report showed, and the reasoning from failure to lever.
- **Before → after:** `13/20 → 17/20`; `ratio-trap 1/3 → 3/3`, `ties 0/2 → 1/2`.
- **Side effects:** World Cup `9/10 → 9/10`, genomics not re-run.
- **Verdict:** kept | reverted, and why.
- **Runs:** `logs/evals/2026-09-22-health-insurance-baseline-1a2b3c4d.json` →
  `logs/evals/2026-09-23-health-insurance-iter-1-guards-9f8e7d6c.json`
```

A "reverted" entry is worth as much as a kept one. It stops the next person
trying the same thing.

---

## 2026-09-22 — Health insurance and genomics fixtures added

- **Suite:** n/a — this entry records the starting point, not a lever change.
- **Change:** two synthetic fixtures (`health_insurance`, `genomics`) with traps
  planted per `synthetic-domains.md`, 20 eval cases each, category tags on every
  case, per-category reporting, token/cost logging, and suites loaded from JSON
  so a new domain no longer needs a code change.
- **Why:** every measurement the engine had was a World Cup sports question. Two
  more domains — one business, one STEM — make it possible to tell a fix that
  generalises from one that was fitted to football.
- **Before → after:** no engine change; baselines to be recorded per
  `improvement-loop.md` step 2.
