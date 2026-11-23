import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { builtVisualSchema } from './analysis.schemas';
import {
  chartableQueries,
  loadCatalog,
  planCatalogBlock,
  type BuiltVisual,
} from './analysis.steps';
import {
  ASK_AGENT_RUNTIME_KEY,
  ASK_AGENT_WORKFLOW_ID,
  ASK_NO_ROWS_REPLY,
  ASKABLE_STEP_IDS,
  imageNotesAnswer,
  planAnswer,
  visualAnswer,
  visualFailedAnswer,
  type AskAgentRuntime,
  type AskableStepId,
} from './ask-agent.steps';

// Ask one agent (workflows R40; agents.md 5.21): a follow-up run of Answer
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
  // Build visual only: what Ryan built, read by the run's visual event.
  visual: builtVisualSchema.optional(),
});

type AskInput = z.output<typeof askInput>;
type AskOutcome = z.output<typeof askOutcome>;

/** Step titles, as Answer a Business Question names them. */
const TITLES: Record<AskableStepId, string> = {
  'read-images': 'Read images',
  plan: 'Plan',
  analyse: 'Analyse',
  'write-answer': 'Write answer',
  'build-visual': 'Build visual',
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
  visual?: BuiltVisual,
): Promise<AskOutcome> {
  await runtime.deliverAnswer(answer);
  return {
    step,
    answerLength: answer.length,
    stopped: false,
    ...(visual ? { visual } : {}),
  };
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
  // The Analyst answers alone, with their own tools.
  analyse: async (runtime) => {
    const outcome = await runtime.answer();
    return { step: 'analyse', answerLength: 0, stopped: outcome.stopped };
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
  // Ryan designs a new visual (v1) from the earlier answer's rows, the
  // follow-up as his instruction; no query runs. As in the whole workflow,
  // a design that fails is the answer's news, never a failed run.
  'build-visual': async (runtime, input) => {
    const earlier = runtime.earlierVisual();
    // The request is refused before the run without rows; kept defensive.
    if (!chartableQueries(earlier.queries)) {
      return delivered(runtime, 'build-visual', ASK_NO_ROWS_REPLY, {
        skipped: 'No query returned rows to chart.',
      });
    }
    // The earlier run's image notes are Ryan's reference, when it had some.
    const { visual, stopped } = await runtime.buildVisual({
      question: earlier.question,
      answer: earlier.answer,
      instruction: input.question,
      ...(earlier.imageNotes.trim() ? { imageNotes: earlier.imageNotes } : {}),
    });
    if (stopped) {
      return { step: 'build-visual', answerLength: 0, stopped: true, visual };
    }
    return delivered(
      runtime,
      'build-visual',
      visual.error !== undefined
        ? visualFailedAnswer(visual.error)
        : visualAnswer(visual.title ?? 'New visual'),
      visual,
    );
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
