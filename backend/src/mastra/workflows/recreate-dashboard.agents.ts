/**
 * The model calls of the two agent steps of Recreate a Dashboard (agents.md
 * 5.17): Read dashboard and Build mock. Each runs a registered System agent
 * (`dashboard-reader`, `mock-builder`; agents.md 2.12, 2.13) on the app's
 * model (`resolveAgentModel`), with its own editable instructions, no tools
 * and no memory, in one model call that carries the dashboard image. The
 * run's turn calls them through `RecreateDashboardRuntime`.
 */
import type { MessageListInput } from '@mastra/core/agent/message-list';
import { dashboardReaderAgent } from '../agents/dashboard-reader.agent';
import { mockBuilderAgent } from '../agents/mock-builder.agent';
import { modelCallTuning } from '../model-compat';
import { resolveAgentModelConfig } from '../model-resolver';
import {
  callOptions,
  noteExchange,
  replyText,
  stoppedBy,
  type StepModelOptions,
} from './answer-business-question.agents';
import { jsonObjectOf } from './answer-business-question.steps';
import {
  buildMockRequest,
  readDashboardRequest,
} from './recreate-dashboard.prompts';
import { dashboardBlueprintSchema } from './recreate-dashboard.schemas';
import {
  blueprintOf,
  emptyBlueprint,
  mockBundleOf,
  type DashboardBlueprint,
  type MockBundle,
} from './recreate-dashboard.steps';
import { runErrorMessage } from './workflow-run';

/** The image a step shows its model. */
export interface StepImage {
  /** The file's bytes. */
  data: Buffer;
  /** image/png, image/jpeg or image/webp. */
  mediaType: string;
}

/** The most tokens Read dashboard's description takes. */
const READ_OUTPUT_TOKENS = 6000;
/** The most tokens Build mock's HTML, CSS and JavaScript take. */
const BUILD_OUTPUT_TOKENS = 24000;

/** One user message: the request's text and the image. */
function imageMessage(request: string, image: StepImage): MessageListInput {
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: request },
        {
          type: 'image',
          image: image.data.toString('base64'),
          mimeType: image.mediaType,
        },
      ],
    },
  ] as MessageListInput;
}

/**
 * The call's options with its output cap filed the way the resolved model
 * reads it; the turn's own provider options (its effort) are kept.
 */
async function tunedOptions(
  options: StepModelOptions,
  maxOutputTokens: number,
) {
  const tuning = modelCallTuning(await resolveAgentModelConfig(), {
    maxOutputTokens,
  });
  const base = callOptions(options);
  const providerOptions = {
    ...tuning.providerOptions,
    ...(options.providerOptions ?? {}),
  };
  return {
    ...base,
    modelSettings: tuning.modelSettings,
    ...(Object.keys(providerOptions).length
      ? { providerOptions: providerOptions as never }
      : {}),
  };
}

/** The model's own failure as an error; undefined when it did not fail. */
function replyFailure(error: unknown): Error | undefined {
  if (error === undefined || error === null) return undefined;
  return error instanceof Error ? error : new Error(runErrorMessage(error));
}

/**
 * The Read dashboard step's call (agents.md 5.17): the image with the run's
 * instructions, and the blueprint read from the reply (`blueprintOf`). A
 * reply that describes no widget fails the step: there is nothing to
 * recreate. A stopped turn reads nothing.
 */
export async function readDashboardWithModel(
  input: { question: string; image: StepImage },
  options: StepModelOptions,
): Promise<{ blueprint: DashboardBlueprint; stopped: boolean }> {
  const request = readDashboardRequest(input);
  try {
    const result = await dashboardReaderAgent.generate(
      imageMessage(request, input.image),
      {
        ...(await tunedOptions(options, READ_OUTPUT_TOKENS)),
        structuredOutput: {
          schema: dashboardBlueprintSchema,
          jsonPromptInjection: 'inline',
          // A reply off the schema is read leniently (`blueprintOf`).
          errorStrategy: 'warn',
        },
      },
    );
    const reply = result as {
      object?: unknown;
      text?: string;
      error?: unknown;
    };
    if (stoppedBy(options)) {
      return { blueprint: emptyBlueprint(), stopped: true };
    }
    const failure = replyFailure(reply.error);
    if (failure) throw failure;
    await noteExchange(options, request, replyText(reply.object, reply.text));
    const blueprint = blueprintOf(reply.object ?? reply.text);
    if (!blueprint) {
      // The model says in `summary` why the image is no dashboard.
      const summary = (
        jsonObjectOf(reply.object ?? reply.text) as
          { summary?: unknown } | undefined
      )?.summary;
      const why = typeof summary === 'string' ? summary.trim() : '';
      throw new Error(
        why
          ? `The image shows no dashboard to recreate: ${why}`
          : 'The image shows no dashboard to recreate',
      );
    }
    return { blueprint, stopped: false };
  } catch (error) {
    if (stoppedBy(options)) {
      return { blueprint: emptyBlueprint(), stopped: true };
    }
    throw error;
  }
}

/**
 * The Build mock step's call (agents.md 5.17): the blueprint and the image,
 * and the mock read from the reply (`mockBundleOf`). A reply that is no
 * mock, or whose script does not parse (`validateScript`), is asked for
 * once more with the problem quoted; a second unusable reply fails the
 * step. A stopped turn builds nothing.
 */
export async function buildMockWithModel(
  input: {
    question: string;
    image: StepImage;
    blueprint: DashboardBlueprint;
    /** The script's syntax error, or null when it parses. */
    validateScript: (javascript: string) => string | null;
  },
  options: StepModelOptions,
): Promise<{ bundle?: MockBundle; stopped: boolean }> {
  const call = await tunedOptions(options, BUILD_OUTPUT_TOKENS);
  let problem: string | undefined;
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const request = buildMockRequest({
        question: input.question,
        blueprint: input.blueprint,
        ...(problem ? { problem } : {}),
      });
      const result = await mockBuilderAgent.generate(
        imageMessage(request, input.image),
        call,
      );
      const reply = result as {
        text?: string;
        error?: unknown;
        finishReason?: string;
      };
      if (stoppedBy(options)) return { stopped: true };
      const failure = replyFailure(reply.error);
      if (failure) throw failure;
      const text = reply.text ?? '';
      await noteExchange(options, request, text);
      const bundle = mockBundleOf(text, input.blueprint);
      if (!bundle) {
        problem =
          reply.finishReason === 'length'
            ? 'it was cut off before the end; write a shorter mock'
            : 'it had no ```html block or no ```javascript block';
        continue;
      }
      const syntax = input.validateScript(bundle.javascript);
      if (!syntax) return { bundle, stopped: false };
      problem =
        reply.finishReason === 'length'
          ? 'it was cut off before the end; write a shorter mock'
          : `its JavaScript does not parse (${syntax})`;
    }
    throw new Error(`The model wrote no usable mock: ${problem}`);
  } catch (error) {
    if (stoppedBy(options)) return { stopped: true };
    throw error;
  }
}
