# 1.23.26b — eval requests before and after

Evals (`EvalRunsService`, `run-assistant-evals.ts`) now create a throwaway run
host (`SessionsService.createRunHost`, the host a workflow run's agent turn runs
on) instead of a throwaway chat session; `run-eval.ts`, `check-answers.ts` and
`custom-endpoint-smoke` run their turns on run hosts too.

## Requests

`backend/src/mastra/evals/eval-requests.spec.ts` records what the first eval case
of each agent that has evals sends to the agent (input, context blocks, step
budget, requestContext keys and datasets; the host id is the only entry left out)
and holds it in `__snapshots__/eval-requests.spec.ts.snap`.

- The snapshot was written on the base (before the change: throwaway session).
- After the change the same spec passes with the snapshot unchanged: the
  requests for `assistant`, `rfp` and `data-readiness` are identical.
- Questions to Insights v2 has no eval set (`evalTargetFor` refuses it); its
  requests are covered by the run e2e (`workflow-runs.e2e-spec.ts`).

## Hashes (`node evidence/1.23.4/measure-hashes.cjs backend/dist`)

Identical before and after:

| Agent | Instructions sha256 | Tool list sha256 |
|---|---|---|
| assistant | 4b5bffd8cf3692c3 | 82a571d15af79e57 |
| rfp | 464bf0fd05d1cb6d | ae32589c79433cf7 |
| data-readiness | 97a99bcea2814a3d | 2fac61dc28c01d2e |
| assistant-v2 | eaeb63b48b9e9932 | 8e2247b12b5a7338 |
