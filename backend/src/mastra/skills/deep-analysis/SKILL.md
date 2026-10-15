---
name: deep-analysis
description: Use when running a deep analysis — plan 3-5 investigation angles, investigate each with SQL, then write the report.
---

# Deep analysis

A deep analysis runs three phases in order, without asking the user for
approval between them. Each phase is one call, and each call reads only its
own phase file:

1. **Plan** — `phases/1-plan.md`: split the question into 3 to 5 distinct
   investigation angles. No queries, no clarifying questions.
2. **Investigate each angle** — `phases/2-investigate.md`: one call per angle,
   in plan order, answering that angle with SQL over the session entities.
3. **Write the report** — `phases/3-report.md`: write the report body from the
   findings of every angle, using only the numbers they contain.

Each phase file is the prompt for its call. Its `{{name}}` placeholders are
filled by the deep-analysis service, and every placeholder must be filled.
