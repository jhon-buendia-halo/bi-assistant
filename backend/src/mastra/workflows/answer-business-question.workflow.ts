import {
  createStep,
  createWorkflow,
  type DefaultEngineType,
  type ExecuteFunctionParams,
} from '@mastra/core/workflows';
import { z } from 'zod';
import {
  analysePlanBlock,
  visualCued,
  earlierQueriesBlock,
} from './analysis.prompts';
import {
  ANSWER_BUSINESS_QUESTION_STEP_SCHEMAS,
  analyseInputSchema,
  questionInputSchema,
  catalogedQuestionSchema,
  answerBusinessQuestionResultSchema,
  turnSummarySchema,
  answerPathInputSchema,
} from './analysis.schemas';
import {
  ANSWER_BUSINESS_QUESTION_RUNTIME_KEY,
  ANSWER_BUSINESS_QUESTION_STEPS,
  ANSWER_BUSINESS_QUESTION_WORKFLOW_ID,
  analysisLoopDone,
  catalogBlock,
  clarifyingQuestionOf,
  loadCatalog,
  mergeAttempts,
  planCatalogBlock,
  chartableQueries,
  receiveQuestion,
  validateAttempt,
  wrapUp,
  type AnswerBusinessQuestionRuntime,
} from './analysis.steps';
import {
  READ_IMAGES_OUTCOME_ID,
  hasReferenceImages,
  readImagesOutcome,
  readImagesStep,
} from './read-images.workflow';
import { engineInputSchema, withContract } from './workflow-contract';
import {
  APPROVE_OPTION,
  askedOf,
  interactiveStep,
  isApproval,
  reviewOf,
  reviewQuestion,
  VISUAL_IMAGES_INSTRUCTION,
  VISUAL_REVIEW_QUESTION,
  visualReview,
} from './answer-business-question.review';
import { analysisReview, planReview } from './analysis.prompts';

// The turn of Insights Analyst as a workflow defined in code
// (ADR-0034; agents.md 5.11), on Mastra's control flow
// (https://mastra.ai/docs/workflows/control-flow) and suspend/resume
// (https://mastra.ai/docs/workflows/suspend-and-resume, ADR-0043):
//
//   .branch(the input has images → read-images) → read-images-outcome
//   → receive-question → load-catalog
//   → question-path: question-input → plan
//       → .branch(not stopped → analysis-path:
//           .dountil(analysis-attempt: analyse → validate, ok or 2 attempts)
//           → .branch(not stopped → answer-path:
//               write-answer → visual-input
//               → .branch(the run builds a visual → build-visual)
//               → visual-outcome → wrap-up))
//
// One line since 2026-11-19: no follow-up branch (Interpret follow-up, Page
// result and Page answer left the workflow) and no Clarify loop.
//
// Plan suspends the run with its own clarifying question; resumed with the
// user's answer, it plans again with it (and never asks twice). Analyse
// suspends the run when the agent asks a clarifying question; resumed, it
// runs the agent again with the answer. A suspended run's path
// (`result.suspended`) is passed back unchanged to `run.resumeStream`.
//
// Read images (agents.md 2.15; workflows R35) describes the run's reference
// images once, before Receive question; its notes (`imageNotes`, `''`
// without images) travel in every step's data to Plan, Analyse and Write
// answer, so they survive a wait and a resume (the runtime is rebuilt empty
// on resume, and nested workflows cannot read a parent's steps).
//
// The nested workflows (`question-path`, `analysis-path`,
// `analysis-attempt`, `answer-path`) and the mapping steps
// `read-images-outcome`, `question-input`, `visual-input` and
// `visual-outcome` are not catalogue steps: the engine reports their steps as
// `<parent>.<child>.<step>`, and the session code reads the last segment.
// A step's bail ends only the sequence it is in, so a stopped Analyse ends
// its attempt, the loop's condition sees `stopped`, and the answer path is
// not taken (its steps end `skipped`); a stopped Plan likewise ends the
// question path with `stopped`, and no analysis runs.
//
// Mastra resumes a run from its persisted snapshot only, so a snapshot is
// written while the run is suspended and at no other time; the run's
// runtime (functions on the RequestContext) is handed in again on resume.
//
// Every step keeps its data contract (agents.md 5.12): its schemas come
// from ./answer-business-question.schemas.ts, and `withContract` validates its input
// before it runs and its output after, so a violation fails the step with
// `Contract violation in <Step title>…` and later steps do not run. The
// engine sees each step's declared input schema but never refuses with it
// (`engineInputSchema`), so that message is the one a run shows.

const STEP = Object.fromEntries(
  ANSWER_BUSINESS_QUESTION_STEPS.map((step) => [step.id, step]),
) as unknown as Record<
  keyof typeof ANSWER_BUSINESS_QUESTION_STEP_SCHEMAS,
  { id: string; title: string }
>;
const SCHEMAS = ANSWER_BUSINESS_QUESTION_STEP_SCHEMAS;

/** What the engine hands the execute of a step with these schemas. */
type StepParams<
  S extends {
    input: z.ZodType;
    output: z.ZodType;
    suspend?: z.ZodType;
    resume?: z.ZodType;
  },
> = ExecuteFunctionParams<
  unknown,
  z.output<S['input']>,
  z.output<S['output']>,
  S['resume'] extends z.ZodType ? z.output<S['resume']> : unknown,
  S['suspend'] extends z.ZodType ? z.output<S['suspend']> : unknown,
  DefaultEngineType
>;

/**
 * Snapshots are written only while a run waits for an answer: Mastra
 * resumes a run from its snapshot (ADR-0043), and nothing else needs one.
 */
const persistWhileWaiting = ({ workflowStatus }: { workflowStatus: string }) =>
  workflowStatus === 'suspended';

/** The run's turn, or an error naming the step that needs it. */
function runtimeOf(
  params: { requestContext: { get(key: string): unknown } },
  title: string,
): AnswerBusinessQuestionRuntime {
  const runtime = params.requestContext.get(
    ANSWER_BUSINESS_QUESTION_RUNTIME_KEY,
  ) as AnswerBusinessQuestionRuntime | undefined;
  if (!runtime) throw new Error(`The ${title} step has no turn to run`);
  return runtime;
}

const receiveQuestionStep = createStep({
  id: STEP['receive-question'].id,
  description: STEP['receive-question'].title,
  inputSchema: engineInputSchema(SCHEMAS['receive-question'].input),
  outputSchema: SCHEMAS['receive-question'].output,
  execute: withContract(
    STEP['receive-question'].title,
    SCHEMAS['receive-question'],
    async ({ inputData }: StepParams<(typeof SCHEMAS)['receive-question']>) =>
      Promise.resolve({
        question: receiveQuestion(inputData.question),
        datasets: inputData.datasets,
        imageNotes: inputData.imageNotes,
      }),
  ),
});

const loadCatalogStep = createStep({
  id: STEP['load-catalog'].id,
  description: STEP['load-catalog'].title,
  inputSchema: engineInputSchema(SCHEMAS['load-catalog'].input),
  outputSchema: SCHEMAS['load-catalog'].output,
  execute: withContract(
    STEP['load-catalog'].title,
    SCHEMAS['load-catalog'],
    async ({ inputData }: StepParams<(typeof SCHEMAS)['load-catalog']>) => ({
      question: inputData.question,
      ...(await loadCatalog(inputData.datasets)),
      imageNotes: inputData.imageNotes,
    }),
  ),
});

// Plan (agents.md 5.11): Olivia plans the question. When it can be read
// more than one way she asks first, in her own step (since 2026-11-19 there
// is no Clarify step): the run waits for the answer (api.md 138), then she
// plans again with it and never asks twice. In an interactive run (workflows
// R44) a clear plan then waits for the user's approval; their words instead
// make her plan again with them.
const planStep = createStep({
  id: STEP.plan.id,
  description: STEP.plan.title,
  inputSchema: engineInputSchema(SCHEMAS.plan.input),
  outputSchema: SCHEMAS.plan.output,
  suspendSchema: SCHEMAS.plan.suspend,
  resumeSchema: SCHEMAS.plan.resume,
  execute: withContract(
    STEP.plan.title,
    SCHEMAS.plan,
    async (params: StepParams<(typeof SCHEMAS)['plan']>) => {
      const { inputData } = params;
      const runtime = runtimeOf(params, STEP.plan.title);
      const interactive = runtime.interactive === true;
      const answer = params.resumeData?.answer?.trim() ?? '';
      // Resumed on the approval gate: approved, the held plan goes on.
      const pending = interactive ? reviewOf(params.suspendData) : undefined;
      if (pending && answer && isApproval(answer)) {
        return pending.outcome as never;
      }
      // Resumed after her own question: she plans with the answer.
      const asked = askedOf(params.suspendData);
      const answered =
        asked && answer
          ? { question: asked.question, options: asked.options, answer }
          : undefined;
      const revision =
        pending && answer
          ? { previous: pending.reply, note: answer }
          : undefined;
      const { plan, stopped } = await runtime.plan({
        question: inputData.question,
        catalog: inputData.catalog,
        // Plan sees each entity's columns, so its measures and its
        // clarifying options rest on what the data can compute.
        catalogBlock: planCatalogBlock(inputData.catalog, inputData.columns, {
          question: inputData.question,
        }),
        ...(answered ? { clarification: answered } : {}),
        ...(revision ? { revision } : {}),
        imageNotes: inputData.imageNotes,
      });
      // After an answer or the user's changes, Plan never asks again.
      const settled =
        (answered || revision) && plan.needsClarification
          ? { ...plan, needsClarification: false, clarification: null }
          : plan;
      const output = {
        question: inputData.question,
        catalog: inputData.catalog,
        // Analyse lists the columns too (agents.md 5.11).
        columns: inputData.columns,
        plan: settled,
        imageNotes: inputData.imageNotes,
      };
      // A stopped turn ends here: nothing after Plan runs.
      if (stopped) return params.bail({ ...output, stopped: true });
      // Her question: the run waits for the user's answer (api.md 138).
      if (settled.needsClarification && settled.clarification) {
        return params.suspend({
          kind: 'clarify',
          question: settled.clarification.question,
          options: settled.clarification.options,
        });
      }
      if (interactive) {
        return params.suspend({
          kind: 'review',
          question: reviewQuestion('Olivia', 'plan', 'Michael'),
          options: [APPROVE_OPTION],
          review: planReview(settled),
          outcome: output,
          reply: JSON.stringify(settled),
        });
      }
      return output;
    },
  ),
});

const analyseStep = createStep({
  id: STEP.analyse.id,
  description: STEP.analyse.title,
  inputSchema: engineInputSchema(SCHEMAS.analyse.input),
  outputSchema: SCHEMAS.analyse.output,
  execute: withContract(
    STEP.analyse.title,
    SCHEMAS.analyse,
    async (params: StepParams<(typeof SCHEMAS)['analyse']>) => {
      const { inputData } = params;
      const previous = inputData.attempt ?? 0;
      const attempt = previous + 1;
      const runtime = runtimeOf(params, STEP.analyse.title);
      const interactive = runtime.interactive === true;
      const answer = params.resumeData?.answer?.trim();
      // Resumed on the approval gate (workflows R44): approved, the held
      // outcome goes on to Validate with no new turn.
      const pending = interactive ? reviewOf(params.suspendData) : undefined;
      if (pending && answer && isApproval(answer)) {
        return pending.outcome as never;
      }
      // Resumed after the agent's clarifying question, or with the user's
      // changes on its approval gate: it goes on with the user's words, in
      // the same attempt.
      const asked = params.resumeData
        ? clarifyingQuestionOf(params.suspendData)
        : undefined;
      // A retry carries the earlier attempt forward (Validate's output): it
      // is shown its queries, and Validate merges them with its own.
      const earlier =
        previous && inputData.queries
          ? {
              calls: inputData.calls ?? [],
              queries: inputData.queries,
              findings: inputData.findings ?? [],
            }
          : undefined;
      const earlierBlock = earlier
        ? earlierQueriesBlock(earlier.queries, earlier.findings)
        : '';
      const { clarification, ...attemptResult } = await runtime.analyse({
        question: inputData.question,
        catalog: inputData.catalog,
        // The columns Load catalog loaded, as Plan got them: the agent
        // need not describe the entities again. With none known, the
        // catalog block alone, as before.
        catalogBlock: inputData.columns.length
          ? planCatalogBlock(inputData.catalog, inputData.columns, {
              question: inputData.question,
            })
          : catalogBlock(inputData.catalog, { question: inputData.question }),
        plan: inputData.plan,
        attempt,
        planBlock: analysePlanBlock(
          inputData.plan,
          previous && inputData.findings
            ? { attempt: previous, findings: inputData.findings }
            : undefined,
        ),
        ...(earlier && earlierBlock
          ? {
              earlierBlock,
              earlier: { queries: earlier.queries, findings: earlier.findings },
            }
          : {}),
        ...(asked && answer
          ? {
              answered: {
                question: asked.question,
                options: asked.options,
                answer,
              },
            }
          : {}),
        imageNotes: inputData.imageNotes,
        ...visualFollows(params.requestContext, inputData),
      });
      // The agent asked the user: the run waits for the answer (api.md 138).
      if (clarification && !attemptResult.stopped) {
        return params.suspend({
          question: clarification.question,
          options: clarification.options,
        });
      }
      const outcome = {
        question: inputData.question,
        catalog: inputData.catalog,
        columns: inputData.columns,
        plan: inputData.plan,
        attempt,
        ...attemptResult,
        ...(earlier ? { earlier } : {}),
        imageNotes: inputData.imageNotes,
      };
      // A stopped turn ends the attempt: the loop ends, no answer is written.
      if (outcome.stopped) return params.bail(outcome);
      // In an interactive run the attempt waits for the user's approval
      // before Validate and Jessica get it (workflows R44).
      if (interactive) {
        return params.suspend({
          kind: 'review',
          question: reviewQuestion('Michael', 'analysis', 'Jessica'),
          options: [APPROVE_OPTION],
          review: analysisReview(outcome),
          outcome,
          reply: outcome.text,
        });
      }
      return outcome;
    },
  ),
});

const validateStep = createStep({
  id: STEP.validate.id,
  description: STEP.validate.title,
  inputSchema: engineInputSchema(SCHEMAS.validate.input),
  outputSchema: SCHEMAS.validate.output,
  execute: withContract(
    STEP.validate.title,
    SCHEMAS.validate,
    async ({ inputData }: StepParams<(typeof SCHEMAS)['validate']>) => {
      // On a retry the kept set is checked: the merged queries, or attempt
      // 1's alone when the retry did worse or ended on a model error.
      const checked = inputData.earlier
        ? mergeAttempts({
            plan: inputData.plan,
            first: inputData.earlier,
            second: inputData,
            catalog: inputData.catalog,
            question: inputData.question,
          })
        : {
            ...validateAttempt(inputData),
            calls: inputData.calls,
            queries: inputData.queries,
          };
      return Promise.resolve({
        ok: checked.ok,
        attempt: inputData.attempt,
        findings: checked.findings,
        question: inputData.question,
        catalog: inputData.catalog,
        columns: inputData.columns,
        plan: inputData.plan,
        calls: checked.calls,
        queries: checked.queries,
        ...('kept' in checked ? { kept: checked.kept } : {}),
        imageNotes: inputData.imageNotes,
      });
    },
  ),
});

const writeAnswerStep = createStep({
  id: STEP['write-answer'].id,
  description: STEP['write-answer'].title,
  inputSchema: engineInputSchema(SCHEMAS['write-answer'].input),
  outputSchema: SCHEMAS['write-answer'].output,
  suspendSchema: SCHEMAS['write-answer'].suspend,
  resumeSchema: SCHEMAS['write-answer'].resume,
  execute: withContract(
    STEP['write-answer'].title,
    SCHEMAS['write-answer'],
    async (params: StepParams<(typeof SCHEMAS)['write-answer']>) => {
      const { inputData } = params;
      const runtime = runtimeOf(params, STEP['write-answer'].title);
      const interactive = runtime.interactive === true;
      // Her answer goes on to Ryan only when Build visual runs: only then
      // does it wait on the approval gate (workflows R44), unseen until the
      // user approves it.
      const gated = interactive && buildsVisual(params.requestContext);
      let stopped = false;
      const ended = await interactiveStep(params as never, interactive, {
        run: async ({ canAsk, answered, revision }) => {
          const written = await runtime.writeAnswer({
            question: inputData.question,
            plan: inputData.plan,
            queries: inputData.queries,
            findings: inputData.findings,
            imageNotes: inputData.imageNotes,
            ...visualFollows(params.requestContext, inputData),
            ...(canAsk ? { canAsk } : {}),
            ...(answered ? { answered } : {}),
            ...(revision ? { revision } : {}),
            ...(gated ? { quiet: true } : {}),
          });
          stopped = written.stopped;
          return {
            output: { ...written.answer, calls: inputData.calls },
            reply: written.answer.answer,
            stopped: written.stopped,
            ...(written.clarification
              ? { clarification: written.clarification }
              : {}),
          };
        },
        gate: (output) =>
          gated
            ? {
                question: reviewQuestion('Jessica', 'answer', 'Ryan'),
                review: output.answer,
              }
            : undefined,
      });
      if (ended.type === 'suspended') return ended.value as never;
      // Approved: the answer she wrote unseen becomes the run's answer.
      if (ended.approved && runtime.deliverAnswer) {
        await runtime.deliverAnswer(ended.output.answer);
      }
      // A stopped turn ends here: Wrap up does not run.
      return stopped ? params.bail(ended.output) : ended.output;
    },
  ),
});

/** Whether the run builds a visual: its runtime says so (the input). */
function buildsVisual(requestContext: unknown): boolean {
  const context = requestContext as { get(key: string): unknown } | undefined;
  const runtime = context?.get(ANSWER_BUSINESS_QUESTION_RUNTIME_KEY) as
    AnswerBusinessQuestionRuntime | undefined;
  return runtime?.buildsVisual === true;
}

/**
 * `{ visualFollows: true }` for Analyse and Write answer when Build visual
 * runs after them and the request cues a visual (`visualCued`), so neither
 * says it cannot draw one; otherwise nothing, and their input is as before.
 */
function visualFollows(
  requestContext: unknown,
  input: { question: string; imageNotes: string },
): { visualFollows?: true } {
  return buildsVisual(requestContext) &&
    visualCued(input.question, input.imageNotes)
    ? { visualFollows: true }
    : {};
}

// On unless the run turns it off (workflows R41): Ryan designs an
// interactive visual from the answer and its queries' rows, stored with the
// run. Nothing to chart skips the design; a design that fails leaves the
// answer without a visual and never fails the run. A stop bails the step (Wrap up still sums the stopped turn).
const buildVisualStep = createStep({
  id: STEP['build-visual'].id,
  description: STEP['build-visual'].title,
  inputSchema: engineInputSchema(SCHEMAS['build-visual'].input),
  outputSchema: SCHEMAS['build-visual'].output,
  suspendSchema: SCHEMAS['build-visual'].suspend,
  resumeSchema: SCHEMAS['build-visual'].resume,
  execute: withContract(
    STEP['build-visual'].title,
    SCHEMAS['build-visual'],
    async (params: StepParams<(typeof SCHEMAS)['build-visual']>) => {
      const { inputData } = params;
      const written = {
        headline: inputData.headline,
        answer: inputData.answer,
        calls: inputData.calls,
      };
      if (!chartableQueries(inputData.queries)) {
        return {
          ...written,
          visual: { skipped: 'No query returned rows to chart.' },
        };
      }
      const runtime = runtimeOf(params, STEP['build-visual'].title);
      if (!runtime.buildVisual) {
        throw new Error('The Build visual step has no designer to run');
      }
      const interactive = runtime.interactive === true;
      // Resumed on Ryan's approval gate (workflows R44): approved, the
      // visual stands; otherwise the user's words, and any reference
      // images they attached, make a new version of the same visual.
      const pending = interactive ? reviewOf(params.suspendData) : undefined;
      const gated = (params.suspendData ?? {}) as { visualId?: unknown };
      const answer = params.resumeData?.answer?.trim() ?? '';
      const images = params.resumeData?.images ?? [];
      let output: z.output<(typeof SCHEMAS)['build-visual']['output']>;
      let stopped: boolean;
      let failure: string | undefined;
      if (pending && isApproval(answer) && !images.length) {
        return pending.outcome as never;
      }
      if (
        pending &&
        typeof gated.visualId === 'string' &&
        runtime.reviseVisual
      ) {
        const revised = await runtime.reviseVisual({
          visualId: gated.visualId,
          instruction: answer || VISUAL_IMAGES_INSTRUCTION,
          ...(images.length ? { images } : {}),
        });
        stopped = revised.stopped;
        // A change that failed keeps the visual as it was, saying why.
        failure = revised.visual.error;
        output = failure
          ? (pending.outcome as typeof output)
          : { ...written, visual: revised.visual };
      } else {
        // The notes are the designer's reference, only when there are some.
        const built = await runtime.buildVisual({
          question: inputData.question,
          answer: inputData.answer,
          queries: inputData.queries,
          ...(inputData.imageNotes.trim()
            ? { imageNotes: inputData.imageNotes }
            : {}),
        });
        stopped = built.stopped;
        output = { ...written, visual: built.visual };
      }
      if (stopped) return params.bail(output);
      // A visual that was built waits for the user's approval before the
      // run ends; none (a failed design) ends it as before.
      if (interactive && output.visual.visualId) {
        return params.suspend({
          kind: 'review',
          question: VISUAL_REVIEW_QUESTION,
          options: [APPROVE_OPTION],
          review: visualReview(output.visual, failure),
          outcome: output,
          reply: output.visual.title ?? '',
          visualId: output.visual.visualId,
        });
      }
      return output;
    },
  ),
});

const wrapUpStep = createStep({
  id: STEP['wrap-up'].id,
  description: STEP['wrap-up'].title,
  inputSchema: engineInputSchema(SCHEMAS['wrap-up'].input),
  outputSchema: SCHEMAS['wrap-up'].output,
  execute: withContract(
    STEP['wrap-up'].title,
    SCHEMAS['wrap-up'],
    async ({ inputData }: StepParams<(typeof SCHEMAS)['wrap-up']>) =>
      Promise.resolve(wrapUp(inputData.calls, inputData.answer)),
  ),
});

/** Any object: what the loop and the branches pass between nested workflows. */
const passOn = z.record(z.string(), z.unknown());

// One attempt of the analysis: the agent's turn, then the code checks.
const analysisAttemptWorkflow = createWorkflow({
  id: 'analysis-attempt',
  inputSchema: engineInputSchema(analyseInputSchema),
  outputSchema: passOn,
  options: { shouldPersistSnapshot: persistWhileWaiting },
})
  .then(analyseStep)
  .then(validateStep)
  .commit();

// The answer: written from the kept queries (the last attempt's, or after a
// retry the merged set or attempt 1's), then summed up.
const answerPathWorkflow = createWorkflow({
  id: 'answer-path',
  // Write answer's input and the catalog of the run's datasets.
  inputSchema: engineInputSchema(answerPathInputSchema),
  outputSchema: turnSummarySchema,
  options: { shouldPersistSnapshot: persistWhileWaiting },
})
  .then(writeAnswerStep)
  // Build visual unless the run turns it off (its input's `buildVisual`),
  // from the answer and the queries' rows; Wrap up sums up either way.
  .map(
    async (params) => {
      const { question, queries, imageNotes } = answerPathInputSchema.parse(
        params.getInitData(),
      );
      return Promise.resolve({
        ...(params.inputData as Record<string, unknown>),
        question,
        queries,
        imageNotes,
      });
    },
    { id: 'visual-input' },
  )
  .branch([
    [
      async ({ requestContext }) =>
        Promise.resolve(buildsVisual(requestContext)),
      buildVisualStep,
    ],
  ])
  .map(
    async (params) =>
      Promise.resolve(
        ((params.inputData as Record<string, unknown>)['build-visual'] ??
          params.getStepResult(writeAnswerStep)) as Record<string, unknown>,
      ),
    { id: 'visual-outcome' },
  )
  .then(wrapUpStep)
  .commit();

// The clear branch: the analysis, retried once when Validate fails, then
// the answer unless the turn was stopped.
const analysisPathWorkflow = createWorkflow({
  id: 'analysis-path',
  inputSchema: engineInputSchema(analyseInputSchema),
  outputSchema: passOn,
  options: { shouldPersistSnapshot: persistWhileWaiting },
})
  .dountil(analysisAttemptWorkflow, async ({ inputData }) =>
    Promise.resolve(analysisLoopDone(inputData as Record<string, unknown>)),
  )
  .branch([
    [
      async ({ inputData }) =>
        Promise.resolve(
          (inputData as Record<string, unknown>)['stopped'] !== true,
        ),
      answerPathWorkflow,
    ],
  ])
  .commit();

// The question: Plan (asking the user first when it needs to), then the
// analysis unless the turn was stopped.
const questionPathWorkflow = createWorkflow({
  id: 'question-path',
  // Load catalog's output: Plan's input.
  inputSchema: engineInputSchema(catalogedQuestionSchema),
  outputSchema: passOn,
  options: { shouldPersistSnapshot: persistWhileWaiting },
})
  // Plan's input: the question, the catalog, its columns and Read images'
  // notes.
  .map(
    async ({ inputData }) =>
      Promise.resolve({
        question: inputData.question,
        catalog: inputData.catalog,
        columns: inputData.columns,
        imageNotes: inputData.imageNotes,
      }),
    { id: 'question-input' },
  )
  .then(planStep)
  .branch([
    [
      async ({ inputData }) =>
        Promise.resolve(
          (inputData as Record<string, unknown>)['stopped'] !== true,
        ),
      analysisPathWorkflow,
    ],
  ])
  .commit();

export const answerBusinessQuestionWorkflow = createWorkflow({
  id: ANSWER_BUSINESS_QUESTION_WORKFLOW_ID,
  description:
    'One turn of Insights Analyst: read the reference images when there are some, receive the question, load the catalog, plan (asking the user first when the question is ambiguous), analyse and validate (retried once), write the answer and build its visual.',
  inputSchema: questionInputSchema,
  outputSchema: answerBusinessQuestionResultSchema,
  options: {
    // The run's input is validated against
    // `questionInputSchema` before the first step (the input
    // node has already checked it, api.md 118, 119).
    validateInputs: true,
    // The session document holds the turn's state. Only a suspended run is
    // snapshotted (for its resume); the run's runtime object on the
    // RequestContext is functions only, so nothing of it is kept.
    shouldPersistSnapshot: persistWhileWaiting,
  },
})
  // Reference images (agents.md 2.15, 5.11): Read images runs first only
  // when the run has images; the map passes the input on with its notes.
  .branch([[hasReferenceImages, readImagesStep]])
  .map(readImagesOutcome, { id: READ_IMAGES_OUTCOME_ID })
  .then(receiveQuestionStep)
  .then(loadCatalogStep)
  // The question path is always taken: a one-way branch keeps the run's
  // result and a waiting run's path keyed under `question-path`, as stored
  // runs have them.
  .branch([[async () => Promise.resolve(true), questionPathWorkflow]])
  .commit();
