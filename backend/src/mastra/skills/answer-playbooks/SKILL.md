---
name: answer-playbooks
description: Use when a question ranks, compares periods, can be read two ways, returns no rows, or a check fails — which playbook to follow and what the answer must say.
---

# Answer playbooks

Tools for this skill: [[tool:run_readonly_sql]], [[tool:explore_result]], [[tool:ask_clarification]].

Pick the one playbook that fits, read it, and follow its **Steps**. Its **Answer** says what your answer must say on top of the usual format. The rules of your job description still hold in every playbook.

## Pick one playbook
- Top, bottom, best, worst, most, least, "rank" → read reference/ranking.md
- Why something went up or down, what changed, one period against another → read reference/period-change.md
- A word in the question can be read more than one way, and the readings give different answers → read reference/ambiguous.md
- A query returns no rows, the results contradict the question's premise, or the data covers only part of the question or none of it → read reference/no-answer.md
- A check on your results failed, or a figure the question needs is missing → read reference/failed-check.md

When two fit (a ranking that returns no rows), follow the first, then the second from the step where it applies.

## Anything else
When none fits but the question needs more than one table or measure, write down the measures, the scope and what each query must prove before the first query, and say under "Assumptions" any reading you chose.
