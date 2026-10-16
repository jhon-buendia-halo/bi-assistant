import { checks } from '@mastra/evals/checks';
import type { MastraScorer } from '@mastra/core/evals';
// Type-only: erased at compile time, so no runtime edge back to the agent
// stack that `assistant.evals.ts` pulls in.
import type { AssistantEvalCase, AssistantEvalSet } from './assistant.evals';
import { checkRegExp } from './eval-set-files';
import type { EvalCheckSpec, EvalSetDefinition } from './eval-set-files';
import { DETERMINISTIC_CHECKS } from './checks';
import type { CheckContext } from './checks';
import { checkScorer } from './checks/check-scorer';

/**
 * The Mastra scorer a set file's check stands for. The six helper types call
 * the `@mastra/evals/checks` function of the same name with the file's
 * arguments, so the scorer id (`check-includes`, …) and description ('Checks
 * if output includes "Argentina"') are exactly what the Evals tab and stored
 * runs showed when the cases were TypeScript. The deterministic checks
 * (agents-evals R112 to R124) are `./checks/` wrapped with `createScorer`;
 * `context` binds the set's dialect and the case's reference query.
 */
export function scorerForCheck(
  spec: EvalCheckSpec,
  context: CheckContext = { dialect: 'postgres' },
): MastraScorer<any, any, any, any> {
  switch (spec.type) {
    case 'includes':
      return checks.includes(spec.args.text);
    case 'matches':
      return checks.matches(checkRegExp(spec.args));
    case 'calledTool':
      return checks.calledTool(spec.args.tool);
    case 'didNotCall':
      return checks.didNotCall(spec.args.tool);
    case 'toolOrder':
      return checks.toolOrder(spec.args.tools);
    case 'noToolErrors':
      return checks.noToolErrors();
    default:
      return checkScorer(
        DETERMINISTIC_CHECKS[spec.type],
        (spec.args ?? {}) as Record<string, unknown>,
        context,
      );
  }
}

/** The suite's sets, with each case's checks built into Mastra scorers. */
export function toAssistantEvalSets(
  definitions: EvalSetDefinition[],
): AssistantEvalSet[] {
  return definitions.map((set) => ({
    id: set.id,
    name: set.name,
    description: set.description,
    fixtureId: set.fixtureId,
    cases: set.cases.map((evalCase): AssistantEvalCase => ({
      id: evalCase.id,
      question: evalCase.question,
      intent: evalCase.intent,
      scorers: evalCase.checks.map((check) =>
        scorerForCheck(check, {
          dialect: set.dialect,
          ...(evalCase.expectedSql !== undefined
            ? { expectedSql: evalCase.expectedSql }
            : {}),
        }),
      ),
      // One per scorer, same order: what each check measures (R146).
      checkCriteria: evalCase.checks.map((check) => check.criterion),
      ...(evalCase.expectedSql !== undefined
        ? { expectedSql: evalCase.expectedSql }
        : {}),
      ...(evalCase.resultSetOptions
        ? { resultSetOptions: evalCase.resultSetOptions }
        : {}),
      ...(evalCase.judgeRubric !== undefined
        ? { judgeRubric: evalCase.judgeRubric }
        : {}),
      // The case's tool selection, put on its requestContext by the runner.
      ...(evalCase.agentTools ? { agentTools: evalCase.agentTools } : {}),
      category: evalCase.category,
      split: evalCase.split,
      tags: evalCase.tags,
      ...(evalCase.notes !== undefined ? { notes: evalCase.notes } : {}),
    })),
  }));
}
