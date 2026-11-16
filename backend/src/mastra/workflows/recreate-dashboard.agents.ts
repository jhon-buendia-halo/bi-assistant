/**
 * The model calls of the two agent steps of Dashboard Image to Artifact (agents.md
 * 5.17): Read dashboard and Map data. Each runs a registered System agent
 * (`dashboard-reader`, `data-mapper`; agents.md 2.13, 2.14) on the app's
 * model (`resolveAgentModel`), with its own editable instructions, no
 * tools and no memory, in one model call with structured output by JSON
 * prompt injection. Read dashboard's call carries the image. The run's turn
 * calls them through `RecreateDashboardRuntime`.
 */
import type { MessageListInput } from '@mastra/core/agent/message-list';
import { dashboardReaderAgent } from '../agents/dashboard-reader.agent';
import { dataMapperAgent } from '../agents/data-mapper.agent';
import { modelCallTuning } from '../model-compat';
import { resolveAgentModelConfig } from '../model-resolver';
import {
  callOptions,
  noteExchange,
  replyText,
  stoppedBy,
  type StepModelOptions,
} from './answer-business-question.agents';
import {
  jsonObjectOf,
  type CatalogEntity,
  type EntityColumns,
} from './answer-business-question.steps';
import {
  mapDataRequest,
  readDashboardRequest,
} from './recreate-dashboard.prompts';
import {
  dashboardBlueprintSchema,
  dataMappingSchema,
} from './recreate-dashboard.schemas';
import {
  blueprintOf,
  emptyBlueprint,
  emptyMapping,
  mappingOf,
  type DashboardBlueprint,
  type DataMapping,
} from './recreate-dashboard.steps';
import { runErrorMessage } from './workflow-run';

/** The image a step shows its model. */
export interface StepImage {
  /** The file's bytes. */
  data: Buffer;
  /** image/png, image/jpeg or image/webp. */
  mediaType: string;
}

/** The most tokens Read dashboard's blueprint takes. */
const READ_OUTPUT_TOKENS = 8000;
/** The most tokens Map data's mapping takes. */
const MAP_OUTPUT_TOKENS = 8000;

/**
 * One user message: the request's text, then one image part per image
 * (base64, with its media type), in order. Read dashboard sends one image,
 * Read images every reference image of the run (agents.md 2.13, 2.15).
 */
export function imagesMessage(
  request: string,
  images: readonly StepImage[],
): MessageListInput {
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: request },
        ...images.map((image) => ({
          type: 'image',
          image: image.data.toString('base64'),
          mimeType: image.mediaType,
        })),
      ],
    },
  ] as MessageListInput;
}

/** One user message: the request's text and the image. */
function imageMessage(request: string, image: StepImage): MessageListInput {
  return imagesMessage(request, [image]);
}

/**
 * The call's options with its output cap filed the way the resolved model
 * reads it; the turn's own provider options (its effort) are kept. Shared
 * by the one-call image steps (Read dashboard, Map data, Read images).
 */
export async function tunedOptions(
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
export function replyFailure(error: unknown): Error | undefined {
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
 * The Map data step's call (agents.md 5.17): the dashboard and the catalog,
 * and the mapping read from the reply and checked against the catalog
 * (`mappingOf`), so a source the catalog lacks never reaches the
 * dashboard. A reply that is no JSON object maps nothing: every widget has
 * no data. A stopped turn maps nothing.
 */
export async function mapDataWithModel(
  input: {
    question: string;
    blueprint: DashboardBlueprint;
    catalog: readonly CatalogEntity[];
    columns: readonly EntityColumns[];
    /**
     * Read images' notes on the run's reference images (agents.md 2.15,
     * 5.18); absent or `''` when the run has none, and the request is then
     * what it was before.
     */
    imageNotes?: string;
  },
  options: StepModelOptions,
): Promise<{ mapping: DataMapping; stopped: boolean }> {
  const request = mapDataRequest(input);
  try {
    const result = await dataMapperAgent.generate(request, {
      ...(await tunedOptions(options, MAP_OUTPUT_TOKENS)),
      structuredOutput: {
        schema: dataMappingSchema,
        jsonPromptInjection: 'inline',
        // A reply off the schema is read leniently (`mappingOf`).
        errorStrategy: 'warn',
      },
    });
    const reply = result as {
      object?: unknown;
      text?: string;
      error?: unknown;
    };
    if (stoppedBy(options)) return { mapping: emptyMapping(), stopped: true };
    const failure = replyFailure(reply.error);
    if (failure) throw failure;
    await noteExchange(options, request, replyText(reply.object, reply.text));
    return {
      mapping: mappingOf(
        reply.object ?? reply.text,
        input.blueprint,
        input.catalog,
        input.columns,
      ),
      stopped: false,
    };
  } catch (error) {
    if (stoppedBy(options)) return { mapping: emptyMapping(), stopped: true };
    throw error;
  }
}
