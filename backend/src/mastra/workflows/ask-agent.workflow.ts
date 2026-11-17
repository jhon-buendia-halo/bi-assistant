import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  interpretFollowUp,
  loadCatalog,
  pageAnswer,
  planCatalogBlock,
} from './answer-business-question.steps';
import {
  ASK_AGENT_RUNTIME_KEY,
  ASK_AGENT_WORKFLOW_ID,
  ASK_NEW_QUESTION_REPLY,
  ASK_NO_RESULT_REPLY,
  ASKABLE_STEP_IDS,
  imageNotesAnswer,
  planAnswer,
  type AskAgentRuntime,
  type AskableStepId,
} from './ask-agent.steps';

// Ask one agent (workflows R38; agents.md 5.21): a follow-up run of Answer
// a Business Question that runs the agent of one of its steps alone. The
// branch takes exactly one step, the asked one, whose id is that step's id
// in Answer a Business Question, so the run shows it and skips the rest.
// The session code hands the work over on the RequestContext.

const askInput = z.object({
  question: z.string(),
  datasets: z.array(z.string()),
  askStep: z.enum(ASKABLE_STEP_IDS),
  images: z.array(z.string()).optional(),
});

const askOutcome = z.object({
  step: z.enum(ASKABLE_STEP_IDS),
  answerLength: z.number(),
  stopped: z.boolean(),
});

type AskInput = z.output<typeof askInput>;
type AskOutcome = z.output<typeof askOutcome>;

/** Step titles, as Answer a Business Question names them. */
const TITLES: Record<AskableStepId, string> = {
  'read-images': 'Read images',
  'interpret-follow-up': 'Interpret follow-up',
  plan: 'Plan',
  analyse: 'Analyse',
  'check-data-quality': 'Check data quality',
  'write-answer': 'Write answer',
};

function runtimeOf(params: {
  requestContext: { get(key: string): unknown };
}): AskAgentRuntime {
  const runtime = params.requestContext.get(ASK_AGENT_RUNTIME_KEY) as
    AskAgentRuntime | undefined;
  if (!runtime) throw new Error('The asked agent has no turn to run');
  return runtime;
}

/** Deliver a code-written answer and end the step with it. */
async function delivered(
  runtime: AskAgentRuntime,
  step: AskableStepId,
  answer: string,
): Promise<AskOutcome> {
  await runtime.deliverAnswer(answer);
  return { step, answerLength: answer.length, stopped: false };
}

/** What each asked step does (agents.md 5.21). */
const WORK: Record<
  AskableStepId,
  (runtime: AskAgentRuntime, input: AskInput) => Promise<AskOutcome>
> = {
  // Zoe reads the run's images again, with this question.
  'read-images': async (runtime, input) => {
    const images = input.images ?? [];
    if (!images.length) {
      return delivered(
        runtime,
        'read-images',
        imageNotesAnswer({
          imageNotes: '',
          imageCount: 0,
          stopped: false,
        }),
      );
    }
    const read = await runtime.readImages({ question: input.question, images });
    if (read.stopped) {
      return { step: 'read-images', answerLength: 0, stopped: true };
    }
    return delivered(runtime, 'read-images', imageNotesAnswer(read));
  },
  // Nathan reads the words over the earlier queries and pages one; a new
  // question is answered with where to ask it, never planned.
  'interpret-follow-up': async (runtime, input) => {
    if (!runtime.followUp.length) {
      return delivered(runtime, 'interpret-follow-up', ASK_NO_RESULT_REPLY);
    }
    // In the whole workflow a model error plans the question instead; asked
    // alone, Nathan's error is the step's (agents.md 5.21).
    let failure: Error | undefined;
    const { followUp, stopped } = await interpretFollowUp(input.question, {
      followUp: runtime.followUp,
      interpretFollowUp: async (request) => {
        try {
          return await runtime.interpretFollowUp(request);
        } catch (error) {
          failure =
            error instanceof Error
              ? error
              : new Error(String(error ?? 'Result Explorer failed'));
          throw failure;
        }
      },
    });
    if (failure !== undefined) throw failure;
    if (stopped) {
      return { step: 'interpret-follow-up', answerLength: 0, stopped: true };
    }
    if (!followUp) {
      return delivered(runtime, 'interpret-follow-up', ASK_NEW_QUESTION_REPLY);
    }
    const page = await runtime.pageResult({
      query: followUp.query,
      request: followUp.request,
      understood: followUp.understood,
    });
    return delivered(
      runtime,
      'interpret-follow-up',
      pageAnswer(page.view, page, page.title),
    );
  },
  // Olivia plans the question over the run's catalog; her plan, in words,
  // is the answer.
  plan: async (runtime, input) => {
    const { catalog, columns } = await loadCatalog(input.datasets);
    const { plan, stopped } = await runtime.plan({
      question: input.question,
      catalog,
      catalogBlock: planCatalogBlock(catalog, columns),
    });
    if (stopped) return { step: 'plan', answerLength: 0, stopped: true };
    return delivered(runtime, 'plan', planAnswer(plan));
  },
  // The Analyst or Sarah answers alone, with their own tools.
  analyse: async (runtime) => {
    const outcome = await runtime.answer();
    return { step: 'analyse', answerLength: 0, stopped: outcome.stopped };
  },
  'check-data-quality': async (runtime) => {
    const outcome = await runtime.answer();
    return {
      step: 'check-data-quality',
      answerLength: 0,
      stopped: outcome.stopped,
    };
  },
  // Jessica writes again from the earlier answer's queries and rows.
  'write-answer': async (runtime, input) => {
    const earlier = runtime.earlierAnswer();
    const { answer, stopped } = await runtime.writeAnswer({
      question: input.question,
      plan: earlier.plan,
      queries: earlier.queries,
      findings: earlier.findings,
      imageNotes: earlier.imageNotes,
    });
    return {
      step: 'write-answer',
      answerLength: answer.answer.length,
      stopped,
    };
  },
};

const askSteps = ASKABLE_STEP_IDS.map((id) =>
  createStep({
    id,
    description: TITLES[id],
    inputSchema: askInput,
    outputSchema: askOutcome,
    execute: async (params) => WORK[id](runtimeOf(params), params.inputData),
  }),
);

/** The one outcome the branch took, whichever step it was. */
const ASK_AGENT_OUTCOME_ID = 'ask-agent-outcome';

export const askAgentWorkflow = createWorkflow({
  id: ASK_AGENT_WORKFLOW_ID,
  description:
    'A follow-up that asks one agent of Answer a Business Question alone, over the earlier run.',
  inputSchema: askInput,
  outputSchema: askOutcome,
  // The run's runtime object on the RequestContext must never be serialized,
  // and this run never waits.
  options: { shouldPersistSnapshot: () => false },
})
  .branch(
    askSteps.map(
      (step, index) =>
        [
          ({ inputData }: { inputData: AskInput }) =>
            Promise.resolve(inputData.askStep === ASKABLE_STEP_IDS[index]),
          step,
        ] as const,
    ),
  )
  .map(
    ({ inputData }) =>
      Promise.resolve(
        Object.values(inputData as Record<string, AskOutcome | undefined>).find(
          (outcome): outcome is AskOutcome => outcome !== undefined,
        ) as AskOutcome,
      ),
    { id: ASK_AGENT_OUTCOME_ID },
  )
  .commit();
