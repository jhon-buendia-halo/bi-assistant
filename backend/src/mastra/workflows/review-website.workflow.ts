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
import { severityCounts, sortFindings } from './review-website.checks';
import {
  groupTemplates,
  reviewChoiceOf,
  reviewPlan,
  reviewQuestion,
} from './review-website.templates';
import { irisFindings } from './review-website.iris';
import type { Finding, ReviewedSite } from './review-website.schemas';
import {
  renderReportBundle,
  reviewAnswer,
  sessionLostAnswer,
} from './review-website.report';
import { engineInputSchema, withContract } from './workflow-contract';
import { runErrorMessage } from './workflow-run';

// The Review a Website workflow, defined in code (agents.md 5.19), on
// Mastra's control flow (https://mastra.ai/docs/workflows/control-flow):
// `.then`, one `.branch` and two suspends
// (https://mastra.ai/docs/workflows/suspend-and-resume):
//
//   prepare-session → discover-pages → group-templates
//     ─┬─ more than ten templates for Iris → confirm-review (waits) ─┐
//      └──────────────────────────────────────────────────────────────┴→
//   review-choice (map) → capture-and-check → review-templates → save-report
//
// Group templates groups the pages into page templates and plans Iris's
// review (phase 2); Confirm review asks before a big one; the map passes
// Group templates' output on with the user's choice. Review templates is
// the one step that calls a model: Iris, once per template, two at a time.
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

const groupTemplatesStep = createStep({
  id: STEP['group-templates'].id,
  description: STEP['group-templates'].title,
  inputSchema: engineInputSchema(SCHEMAS['group-templates'].input),
  outputSchema: SCHEMAS['group-templates'].output,
  execute: withContract(
    STEP['group-templates'].title,
    SCHEMAS['group-templates'],
    async (params: StepParams<(typeof SCHEMAS)['group-templates']>) => {
      const site = params.inputData;
      const grouped = groupTemplates(site.pages);
      const plan = reviewPlan(
        grouped.templates,
        site.visualReview,
        grouped.pages,
      );
      return Promise.resolve({
        ...site,
        pages: grouped.pages,
        templates: grouped.templates,
        ...plan,
      });
    },
  ),
});

const confirmReviewStep = createStep({
  id: STEP['confirm-review'].id,
  description: STEP['confirm-review'].title,
  inputSchema: engineInputSchema(SCHEMAS['confirm-review'].input),
  outputSchema: SCHEMAS['confirm-review'].output,
  suspendSchema: SCHEMAS['confirm-review'].suspend,
  resumeSchema: SCHEMAS['confirm-review'].resume,
  execute: withContract(
    STEP['confirm-review'].title,
    SCHEMAS['confirm-review'],
    async (
      params: StepParams<
        (typeof SCHEMAS)['confirm-review'],
        z.output<(typeof SCHEMAS)['confirm-review']['resume']>,
        z.output<(typeof SCHEMAS)['confirm-review']['suspend']>
      >,
    ) => {
      const site = params.inputData;
      const answer = params.resumeData?.answer;
      // The run waits for the user's choice (api.md 138).
      if (answer === undefined) {
        return params.suspend(
          reviewQuestion(
            site.templates,
            site.reviewTemplates,
            site.pages.length,
          ),
        );
      }
      return Promise.resolve({
        reviewTemplates: reviewChoiceOf(answer, site.reviewTemplates),
      });
    },
  ),
});

/** The branch's condition: Iris's review is big enough to ask first. */
const asksBeforeReview = ({ inputData }: { inputData: unknown }) =>
  Promise.resolve(
    (inputData as { askBeforeReview?: unknown } | undefined)
      ?.askBeforeReview === true,
  );

/** The map's id after the branch: Group templates' output with the user's choice. */
const REVIEW_CHOICE_ID = 'review-choice';

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

/** The branch's condition: Iris has templates to review, with their shots. */
const hasTemplatesToReview = ({ inputData }: { inputData: unknown }) => {
  const site = inputData as
    { reviewTemplates?: unknown[]; reviewShots?: unknown[] } | undefined;
  return Promise.resolve(
    (site?.reviewTemplates?.length ?? 0) > 0 &&
      (site?.reviewShots?.length ?? 0) > 0,
  );
};

/** The map's id after Review templates' branch. */
const REVIEW_OUTCOME_ID = 'review-outcome';

/** How many templates Iris reviews at once. */
const REVIEW_CONCURRENCY = 2;

const reviewTemplatesStep = createStep({
  id: STEP['review-templates'].id,
  description: STEP['review-templates'].title,
  inputSchema: engineInputSchema(SCHEMAS['review-templates'].input),
  outputSchema: SCHEMAS['review-templates'].output,
  execute: withContract(
    STEP['review-templates'].title,
    SCHEMAS['review-templates'],
    async (params: StepParams<(typeof SCHEMAS)['review-templates']>) => {
      const site = params.inputData;
      const queue = site.templates.filter(
        (template) =>
          site.reviewTemplates.includes(template.id) &&
          site.reviewShots.some((shot) => shot.template === template.id),
      );
      if (!queue.length) return { ...site, reviewed: [], stopped: false };
      const runtime = runtimeOf(params, STEP['review-templates'].title);
      const reviewed: ReviewedSite['reviewed'] = [];
      const found: Finding[] = [];
      let stopped = false;
      let next = 0;
      let done = 0;
      // The first failure, thrown only when no template was reviewed.
      let firstError: unknown;
      runtime.progress(
        `Iris is reviewing ${queue.length} page template${queue.length === 1 ? '' : 's'}`,
      );
      // Each worker catches its own template's failure and goes on: a
      // template not reviewed is recorded with why (workflows R43); only a
      // stop ends the workers.
      const worker = async () => {
        while (!stopped && next < queue.length) {
          const template = queue[next++];
          const shots = site.reviewShots.filter(
            (shot) => shot.template === template.id,
          );
          const measured = site.findings.filter(
            (finding) =>
              finding.group === template.id && finding.source === 'measured',
          );
          let result: Awaited<ReturnType<typeof runtime.reviewTemplate>>;
          try {
            result = await runtime.reviewTemplate({
              template,
              shots,
              measured,
            });
          } catch (error) {
            firstError ??= error;
            const reason = runErrorMessage(error);
            reviewed.push({
              template: template.id,
              summary: '',
              findingCount: 0,
              notReviewed: reason,
            });
            done += 1;
            runtime.progress(
              `Could not review ${template.id} (${done} of ${queue.length}): ${reason}`,
            );
            continue;
          }
          if (result.stopped) {
            stopped = true;
            return;
          }
          const findings = irisFindings(result.review, {
            template,
            url: template.representative,
            shots,
          });
          found.push(...findings);
          reviewed.push({
            template: template.id,
            summary: result.review.summary,
            findingCount: findings.length,
          });
          done += 1;
          runtime.progress(
            `Reviewed ${done} of ${queue.length} templates · ${template.id} · ${findings.length} finding${findings.length === 1 ? '' : 's'}`,
          );
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(REVIEW_CONCURRENCY, queue.length) },
          worker,
        ),
      );
      // Template order, whatever order the calls ended in.
      const order = new Map(queue.map((template, at) => [template.id, at]));
      reviewed.sort(
        (a, b) => (order.get(a.template) ?? 0) - (order.get(b.template) ?? 0),
      );
      // Nothing reviewed and something failed: the step fails with it.
      if (
        !stopped &&
        firstError !== undefined &&
        reviewed.every((entry) => entry.notReviewed !== undefined)
      ) {
        throw firstError instanceof Error
          ? firstError
          : new Error(runErrorMessage(firstError));
      }
      // A stop is passed on, not bailed: a bail inside the branch would end
      // only this step, and Save report would still save.
      return {
        ...site,
        findings: sortFindings([...site.findings, ...found]),
        reviewed,
        stopped,
      };
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
      const site = params.inputData;
      // Stopped during the review: nothing is saved.
      if (site.stopped) throw new Error('The review was stopped');
      const runtime = runtimeOf(params, STEP['save-report'].title);
      const paths = [
        ...site.findings.map((finding) => finding.crop),
        ...site.findings.map((finding) => finding.context?.image ?? null),
        ...site.captures.map((capture) => capture.thumbnail),
      ].filter((path): path is string => typeof path === 'string');
      const images = await runtime.loadReportImages([...new Set(paths)]);
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
            templates: site.templates,
            reviewed: site.reviewed,
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
        groupCount: site.templates.length,
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
  .then(groupTemplatesStep)
  // A big review waits for the user's choice; the map passes Group
  // templates' output on with that choice (a skipped branch passes `{}`).
  .branch([[asksBeforeReview, confirmReviewStep]])
  .map(
    async (params) => {
      const { inputData } = params;
      const grouped = params.getStepResult(groupTemplatesStep) as Record<
        string,
        unknown
      >;
      const chosen = (inputData as Record<string, unknown> | undefined)?.[
        STEP['confirm-review'].id
      ] as { reviewTemplates?: string[] } | undefined;
      return Promise.resolve({
        ...grouped,
        ...(chosen?.reviewTemplates
          ? { reviewTemplates: chosen.reviewTemplates }
          : {}),
      });
    },
    { id: REVIEW_CHOICE_ID },
  )
  .then(captureAndCheckStep)
  // Iris runs only when there are templates to review; the map passes on
  // her output, or Capture and check's with no review (a skipped branch
  // passes `{}`).
  .branch([[hasTemplatesToReview, reviewTemplatesStep]])
  .map(
    async (params) => {
      const reviewed = (
        params.inputData as Record<string, unknown> | undefined
      )?.[STEP['review-templates'].id];
      return Promise.resolve(
        reviewed ?? {
          ...(params.getStepResult(captureAndCheckStep) as Record<
            string,
            unknown
          >),
          reviewed: [],
          stopped: false,
        },
      );
    },
    { id: REVIEW_OUTCOME_ID },
  )
  .then(saveReportStep)
  .commit();
