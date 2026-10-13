import { checks } from '@mastra/evals/checks';
import type { MastraScorer } from '@mastra/core/evals';
// Type-only: erased at compile time, so no runtime edge back to the agent
// stack that `assistant.evals.ts` pulls in.
import type { AssistantEvalCase, AssistantEvalSet } from './assistant.evals';
import { checkRegExp } from './eval-sets';
import type { EvalCheckSpec, EvalSetDefinition } from './eval-sets';

/**
 * The Mastra scorer a set file's check stands for. Each type calls the
 * `@mastra/evals/checks` function of the same name with the file's arguments,
 * so the scorer id (`check-includes`, …) and description ('Checks if output
 * includes "Argentina"') are exactly what the Evals tab and stored runs
 * showed when the cases were TypeScript.
 */
export function scorerForCheck(
  spec: EvalCheckSpec,
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
      scorers: evalCase.checks.map(scorerForCheck),
      ...(evalCase.expectedSql !== undefined
        ? { expectedSql: evalCase.expectedSql }
        : {}),
      ...(evalCase.resultSetOptions
        ? { resultSetOptions: evalCase.resultSetOptions }
        : {}),
      ...(evalCase.judgeRubric !== undefined
        ? { judgeRubric: evalCase.judgeRubric }
        : {}),
      category: evalCase.category,
      split: evalCase.split,
      tags: evalCase.tags,
      ...(evalCase.notes !== undefined ? { notes: evalCase.notes } : {}),
    })),
  }));
}
