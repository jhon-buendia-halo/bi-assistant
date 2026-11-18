# Merged sets vs main's code-defined sets

Script: compares main's and the merge base's code cases (evaluated via esbuild) with what the JSON loader produces after the merge: question, intent, reference SQL, result-set options, rubric, agentTools, checks (type + arguments) and relative check order.

```
world-cup: merged 12 cases, main 12; same ids in same order: true
world-cup-rest: merged 12 cases, main 12; same ids in same order: true
formula-1: merged 10 cases, main 10; same ids in same order: true

Differences that are not BA-9 check additions:
  none

BA-9 check additions (merged has, main and base do not):
  noRepairs: 24
  rationaleOk: 27
  noHtml: 30
  dialect: 24
  qualifiedNames: 24
  namesNotIds: 24
  numbersGrounded: 24
  usesEntities: 3
  sqlMatches: 3
  optionCount: 3
  didNotCall: 3
  matches: 3
  notMatches: 3
  visualKeywords: 3
```
