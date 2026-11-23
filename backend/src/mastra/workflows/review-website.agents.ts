/**
 * The model call of Review templates (agents.md 5.19): Iris, the Site
 * Reviewer (`site-reviewer`), on the app's model, in one call per page
 * template that carries, per screen, the clean screenshot and the one with
 * numbered marks, with structured output by JSON prompt injection.
 */
import { siteReviewerAgent } from '../agents/site-reviewer.agent';
import {
  noteExchange,
  replyText,
  stoppedBy,
  type StepModelOptions,
} from './step-agents';
import {
  imagesMessage,
  replyFailure,
  throwIfCut,
  tunedOptions,
  type ModelReply,
  type StepImage,
} from './recreate-dashboard.agents';
import { guardedCall } from './model-call';
import { IRIS_CALL_TIMEOUT_MS, IrisTimeoutError } from './review-website.steps';
import { irisReviewOf } from './review-website.iris';
import { reviewTemplateRequest } from './review-website.prompts';
import {
  irisReviewSchema,
  type Finding,
  type IrisReview,
  type PageTemplate,
  type ReviewMark,
  type SiteScreenName,
} from './review-website.schemas';

/** The most tokens Iris's reply takes. */
const REVIEW_OUTPUT_TOKENS = 4000;

const NO_REVIEW: IrisReview = { findings: [], summary: '' };

/**
 * Review templates' call for one template (agents.md 5.19): one user
 * message with the request's text (`reviewTemplateRequest`) and, per screen,
 * the clean image then the marked one, in the order the text names. The
 * reply is read leniently (`irisReviewOf`) against the screens and marks
 * shown. The exchange is recorded as text only. A model error rejects with
 * the model's own error. A stopped turn reads nothing and records nothing.
 * The call is guarded (`guardedCall`, workflows R43) with Iris's one
 * deadline: two minutes per try (`IRIS_CALL_TIMEOUT_MS`), past which it
 * fails with `IrisTimeoutError`; one retry of a transient failure or a cut
 * reply.
 */
export async function reviewTemplateWithModel(
  input: {
    url: string;
    template: PageTemplate;
    shots: {
      screen: SiteScreenName;
      label: string;
      width: number;
      clean: StepImage;
      marked: StepImage;
      marks: ReviewMark[];
    }[];
    measured: readonly Finding[];
  },
  options: StepModelOptions,
): Promise<{ review: IrisReview; stopped: boolean }> {
  const request = reviewTemplateRequest({
    url: input.url,
    template: input.template,
    screens: input.shots.map(({ screen, label, width, marks }) => ({
      screen,
      label,
      width,
      marks,
    })),
    measured: input.measured,
  });
  const images = input.shots.flatMap((shot) => [shot.clean, shot.marked]);
  const valid = {
    screens: input.shots.map((shot) => shot.screen),
    marks: new Map(
      input.shots.map((shot) => [
        shot.screen,
        new Set(shot.marks.map((mark) => mark.n)),
      ]),
    ),
  };
  const guard = {
    label: 'Review templates',
    deadlineMs: IRIS_CALL_TIMEOUT_MS,
    timeoutError: () => new IrisTimeoutError(input.template.id),
  };
  try {
    return await guardedCall(options, guard, async (call) => {
      const result = await siteReviewerAgent.generate(
        imagesMessage(request, images),
        {
          ...(await tunedOptions(call, REVIEW_OUTPUT_TOKENS)),
          structuredOutput: {
            schema: irisReviewSchema,
            jsonPromptInjection: 'inline',
            // A reply off the schema is read leniently (`irisReviewOf`).
            errorStrategy: 'warn',
          },
        },
      );
      const reply = result as ModelReply;
      if (stoppedBy(call)) return { review: NO_REVIEW, stopped: true };
      const failure = replyFailure(reply.error);
      if (failure) throw failure;
      throwIfCut(reply, guard.label, REVIEW_OUTPUT_TOKENS);
      await noteExchange(call, request, replyText(reply.object, reply.text));
      return {
        review: irisReviewOf(reply.object ?? reply.text, valid),
        stopped: false,
      };
    });
  } catch (error) {
    if (stoppedBy(options)) return { review: NO_REVIEW, stopped: true };
    throw error;
  }
}
