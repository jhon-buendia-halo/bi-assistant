import {
  createStep,
  createWorkflow,
  type DefaultEngineType,
  type ExecuteFunctionParams,
} from '@mastra/core/workflows';
import type { z } from 'zod';
import {
  REVIEW_WEBSITE_STEP_SCHEMAS,
  reviewWebsiteInputSchema,
  reviewWebsiteResultSchema,
} from './review-website.schemas';
import {
  REVIEW_WEBSITE_RUNTIME_KEY,
  REVIEW_WEBSITE_STEPS,
  REVIEW_WEBSITE_WORKFLOW_ID,
  preparedSessionOf,
  signInQuestion,
  type ReviewWebsiteRuntime,
} from './review-website.steps';
import { severityCounts } from './review-website.checks';
import {
  renderReportBundle,
  reviewAnswer,
  sessionLostAnswer,
} from './review-website.report';
import { engineInputSchema, withContract } from './workflow-contract';

// The Review a Website workflow, defined in code (agents.md 5.19), on
// Mastra's sequential control flow
// (https://mastra.ai/docs/workflows/control-flow) with one suspend
// (https://mastra.ai/docs/workflows/suspend-and-resume):
//
//   prepare-session → discover-pages → capture-and-check → save-report
//
// Prepare session makes the input usable and, for a site behind a sign-in,
// checks the saved sign-in; when there is none that works it opens a
// browser window and the run waits until the user signs in and continues.
// Discover pages crawls the site; when a page lands on the sign-in page it
// bails, which ends the run as a success with that step's output
// (`sessionLost`) and nothing reviewed. Capture and check measures every
// page on every screen. Save report draws the report and writes the answer.
// No step calls a model (docs/plans/m1-27-site-review.md, phase 1).
//
// The run's runtime (functions on the RequestContext) holds the browser, so
// a snapshot is written only while the run waits for the sign-in: the
// runtime is never serialised, and after a restart the waiting run expires
// (workflows R28).

const STEP = Object.fromEntries(
  REVIEW_WEBSITE_STEPS.map((step) => [step.id, step]),
) as unknown as Record<
  keyof typeof REVIEW_WEBSITE_STEP_SCHEMAS,
  { id: string; title: string }
>;
const SCHEMAS = REVIEW_WEBSITE_STEP_SCHEMAS;

/** What the engine hands the execute of a step with these schemas. */
type StepParams<
  S extends { input: z.ZodType; output: z.ZodType },
  R = unknown,
  P = unknown,
> = ExecuteFunctionParams<
  unknown,
  z.output<S['input']>,
  z.output<S['output']>,
  R,
  P,
  DefaultEngineType
>;

/** The run's runtime, or an error naming the step that needs it. */
function runtimeOf(
  params: { requestContext: { get(key: string): unknown } },
  title: string,
): ReviewWebsiteRuntime {
  const runtime = params.requestContext.get(REVIEW_WEBSITE_RUNTIME_KEY) as
    ReviewWebsiteRuntime | undefined;
  if (!runtime) throw new Error(`The ${title} step has no website to review`);
  return runtime;
}

/** Snapshots only while the run waits for the sign-in (ADR-0043). */
const persistWhileWaiting = ({ workflowStatus }: { workflowStatus: string }) =>
  workflowStatus === 'suspended';

const prepareSessionStep = createStep({
  id: STEP['prepare-session'].id,
  description: STEP['prepare-session'].title,
  inputSchema: engineInputSchema(SCHEMAS['prepare-session'].input),
  outputSchema: SCHEMAS['prepare-session'].output,
  suspendSchema: SCHEMAS['prepare-session'].suspend,
  resumeSchema: SCHEMAS['prepare-session'].resume,
  execute: withContract(
    STEP['prepare-session'].title,
    SCHEMAS['prepare-session'],
    async (
      params: StepParams<
        (typeof SCHEMAS)['prepare-session'],
        z.output<(typeof SCHEMAS)['prepare-session']['resume']>,
        z.output<(typeof SCHEMAS)['prepare-session']['suspend']>
      >,
    ) => {
      const prepared = preparedSessionOf(params.inputData);
      if (!prepared.needsSignIn) return { ...prepared, signedIn: false };
      const runtime = runtimeOf(params, STEP['prepare-session'].title);
      const { url, loginUrl } = prepared;
      if (params.resumeData?.answer === undefined) {
        const saved = await runtime.checkSignIn({ url, loginUrl });
        if (saved.signedIn) return { ...prepared, signedIn: true };
        // No sign-in that works: the user signs in in a window of their own.
        await runtime.openSignIn({ loginUrl });
        return params.suspend(signInQuestion(url));
      }
      // Continued: the window's sign-in, saved when it works.
      const finished = await runtime.finishSignIn({ url, loginUrl });
      if (finished.signedIn) return { ...prepared, signedIn: true };
      return params.suspend(signInQuestion(url, true));
    },
  ),
});

const discoverPagesStep = createStep({
  id: STEP['discover-pages'].id,
  description: STEP['discover-pages'].title,
  inputSchema: engineInputSchema(SCHEMAS['discover-pages'].input),
  outputSchema: SCHEMAS['discover-pages'].output,
  execute: withContract(
    STEP['discover-pages'].title,
    SCHEMAS['discover-pages'],
    async (params: StepParams<(typeof SCHEMAS)['discover-pages']>) => {
      const runtime = runtimeOf(params, STEP['discover-pages'].title);
      const found = await runtime.discoverPages(params.inputData);
      const output = { ...params.inputData, ...found };
      if (output.sessionLost === null) return output;
      // Nothing is reviewed on pages behind a lost sign-in.
      await runtime.showAnswer(sessionLostAnswer(output));
      return params.bail(output);
    },
  ),
});

const captureAndCheckStep = createStep({
  id: STEP['capture-and-check'].id,
  description: STEP['capture-and-check'].title,
  inputSchema: engineInputSchema(SCHEMAS['capture-and-check'].input),
  outputSchema: SCHEMAS['capture-and-check'].output,
  execute: withContract(
    STEP['capture-and-check'].title,
    SCHEMAS['capture-and-check'],
    async (params: StepParams<(typeof SCHEMAS)['capture-and-check']>) => {
      const runtime = runtimeOf(params, STEP['capture-and-check'].title);
      const checked = await runtime.captureAndCheck(params.inputData);
      return { ...params.inputData, ...checked };
    },
  ),
});

const saveReportStep = createStep({
  id: STEP['save-report'].id,
  description: STEP['save-report'].title,
  inputSchema: engineInputSchema(SCHEMAS['save-report'].input),
  outputSchema: SCHEMAS['save-report'].output,
  execute: withContract(
    STEP['save-report'].title,
    SCHEMAS['save-report'],
    async (params: StepParams<(typeof SCHEMAS)['save-report']>) => {
      const runtime = runtimeOf(params, STEP['save-report'].title);
      const site = params.inputData;
      const paths = [
        ...site.findings.map((finding) => finding.crop),
        ...site.captures.map((capture) => capture.thumbnail),
      ].filter((path): path is string => typeof path === 'string');
      const images = await runtime.readImages([...new Set(paths)]);
      const answer = reviewAnswer(site);
      const saved = await runtime.saveReport({
        bundle: renderReportBundle({
          site,
          images,
          generatedAt: new Date().toISOString(),
        }),
        findings: JSON.stringify(
          {
            origin: site.origin,
            url: site.url,
            screens: site.screens,
            pages: site.pages,
            captures: site.captures,
            findings: site.findings,
            skippedLinks: site.skippedLinks,
            capped: site.capped,
          },
          null,
          2,
        ),
        answer,
      });
      return {
        ...saved,
        origin: site.origin,
        pageCount: site.pages.length,
        groupCount: new Set(site.pages.map((page) => page.group)).size,
        findingCount: site.findings.length,
        counts: severityCounts(site.findings),
        answer,
      };
    },
  ),
});

export const reviewWebsiteWorkflow = createWorkflow({
  id: REVIEW_WEBSITE_WORKFLOW_ID,
  description:
    'Map a website and measure the visual and usability defects of every page on each screen size, with the evidence of each finding.',
  inputSchema: reviewWebsiteInputSchema,
  outputSchema: reviewWebsiteResultSchema,
  options: {
    validateInputs: true,
    shouldPersistSnapshot: persistWhileWaiting,
  },
})
  .then(prepareSessionStep)
  .then(discoverPagesStep)
  .then(captureAndCheckStep)
  .then(saveReportStep)
  .commit();
