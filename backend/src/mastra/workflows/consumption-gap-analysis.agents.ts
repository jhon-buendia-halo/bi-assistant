/**
 * The model calls of Consumption Gap Analysis (agents.md 2.18 to 2.20,
 * 5.20): one call each, no tools, no memory, structured output read
 * leniently and checked in code. The run records each exchange as text in
 * the agent's thread (`options.onExchange`).
 */
import type { z } from 'zod';
import { gapAdvisorAgent } from '../agents/gap-advisor.agent';
import { layerMapperAgent } from '../agents/layer-mapper.agent';
import { requirementsAnalystAgent } from '../agents/requirements-analyst.agent';
import { modelCallTuning } from '../model-compat';
import { resolveAgentModelConfig } from '../model-resolver';
import { stepModelFrom } from '../step-model';
import {
  callOptions,
  noteExchange,
  replyText,
  stoppedBy,
  type StepModelOptions,
} from './step-agents';
import {
  deriveRequirementsRequest,
  mapRequirementsRequest,
  recommendFixesRequest,
  reviseRequirementsRequest,
} from './consumption-gap-analysis.prompts';
import {
  derivedRequirementsOf,
  derivedRequirementsReplySchema,
  gapFixesReplySchema,
  layerMappingsReplySchema,
  revisedRequirementsOf,
  revisedRequirementsReplySchema,
} from './consumption-gap-analysis.replies';
import type {
  FieldMapping,
  GapFix,
  LayerTable,
  Lineage,
  ReferenceDashboard,
  Requirement,
  RequirementAssessment,
} from './consumption-gap-analysis.schemas';
import { checkedFixes, checkedMappings } from './consumption-gap.gaps';
import {
  cutReply,
  deadlineFor,
  guardedCall,
  ReplyCutError,
} from './model-call';
import { runErrorMessage } from './workflow-run';

/** The most tokens each call's reply takes. */
const REQUIREMENTS_OUTPUT_TOKENS = 8000;
const MAPPINGS_OUTPUT_TOKENS = 16000;
const FIXES_OUTPUT_TOKENS = 8000;

/**
 * The call's options with its output cap filed the way the resolved model
 * reads it; the turn's own provider options (its effort) are kept.
 */
async function tunedOptions(
  options: StepModelOptions,
  maxOutputTokens: number,
) {
  // Tuned for the model the call runs on: a workflow's step model, if any.
  const tuning = modelCallTuning(
    await resolveAgentModelConfig(stepModelFrom(options.requestContext)?.model),
    { maxOutputTokens },
  );
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

/** What a one-call step reads of `generate`'s reply. */
interface ModelReply {
  object?: unknown;
  text?: string;
  error?: unknown;
  finishReason?: unknown;
}

/**
 * Throws `ReplyCutError` when the reply was cut at the output cap (finish
 * reason `length`; workflows R43): a JSON reply cut short is never read as
 * an empty result. The guarded call tries once more; cut again, the step
 * fails with it.
 */
function throwIfCut(
  reply: ModelReply,
  label: string,
  maxOutputTokens: number,
): void {
  if (cutReply(reply.finishReason)) {
    throw new ReplyCutError(label, maxOutputTokens);
  }
}

interface CallableAgent {
  generate: (message: string, options: never) => Promise<unknown>;
}

/**
 * One call: the request to the agent with its schema, the exchange noted,
 * the raw reply handed to `read`. A stopped turn returns `empty` with
 * `stopped` true; a model error is thrown. The call is guarded
 * (`guardedCall`, workflows R43): a deadline by its output cap, one retry
 * of a transient failure or a cut reply; cut twice, `ReplyCutError`.
 */
async function callOnce<T>(
  label: string,
  agent: unknown,
  request: string,
  schema: z.ZodType,
  maxOutputTokens: number,
  options: StepModelOptions,
  read: (reply: unknown) => T,
  empty: T,
): Promise<{ result: T; stopped: boolean }> {
  const guard = { label, deadlineMs: deadlineFor(maxOutputTokens) };
  try {
    return await guardedCall(options, guard, async (call) => {
      const result = await (agent as CallableAgent).generate(request, {
        ...(await tunedOptions(call, maxOutputTokens)),
        structuredOutput: {
          schema,
          jsonPromptInjection: 'inline',
          // A reply off the schema is read leniently.
          errorStrategy: 'warn',
        },
      } as never);
      const reply = result as ModelReply;
      if (stoppedBy(call)) return { result: empty, stopped: true };
      const failure = replyFailure(reply.error);
      if (failure) throw failure;
      // A reply cut at the output cap is never read as an empty result.
      throwIfCut(reply, label, maxOutputTokens);
      await noteExchange(call, request, replyText(reply.object, reply.text));
      return { result: read(reply.object ?? reply.text), stopped: false };
    });
  } catch (error) {
    if (stoppedBy(options)) return { result: empty, stopped: true };
    throw error;
  }
}

/**
 * Derive requirements: the Requirements Analyst over the questions (the
 * dashboards are context only: their requirements are built in code). One
 * requirement per question, ids `Q1`… in question order, kind `question`,
 * `dashboardId` ''. A question the reply misses gets a requirement with no
 * fields and its title.
 */
export async function deriveRequirementsWithModel(
  input: { questions: string[]; dashboards: ReferenceDashboard[] },
  options: StepModelOptions,
): Promise<{ requirements: Requirement[]; stopped: boolean }> {
  const { result, stopped } = await callOnce(
    'Derive requirements',
    requirementsAnalystAgent,
    deriveRequirementsRequest(input),
    derivedRequirementsReplySchema,
    REQUIREMENTS_OUTPUT_TOKENS,
    options,
    (reply) => derivedRequirementsOf(reply, input.questions),
    [] as Requirement[],
  );
  return { requirements: result, stopped };
}

/**
 * Confirm requirements: the Requirements Analyst applies the user's
 * feedback to the whole list (questions, widgets and filters); it may
 * drop, edit or add requirements. Ids are kept for kept requirements; an
 * added one gets the next free id of its kind.
 */
export async function reviseRequirementsWithModel(
  input: { questions: string[]; requirements: Requirement[]; feedback: string },
  options: StepModelOptions,
): Promise<{ requirements: Requirement[]; stopped: boolean }> {
  const { result, stopped } = await callOnce(
    'Confirm requirements',
    requirementsAnalystAgent,
    reviseRequirementsRequest(input),
    revisedRequirementsReplySchema,
    REQUIREMENTS_OUTPUT_TOKENS,
    options,
    (reply) => revisedRequirementsOf(reply, input.requirements),
    [] as Requirement[],
  );
  return { requirements: result, stopped };
}

/** Map requirements: the Layer Mapper's reply through `checkedMappings`. */
export async function mapRequirementsWithModel(
  input: { requirements: Requirement[]; tables: LayerTable[] },
  options: StepModelOptions,
): Promise<{ mappings: FieldMapping[]; stopped: boolean }> {
  const { result, stopped } = await callOnce(
    'Map requirements',
    layerMapperAgent,
    mapRequirementsRequest(input),
    layerMappingsReplySchema,
    MAPPINGS_OUTPUT_TOKENS,
    options,
    (reply) => checkedMappings(reply, input.requirements, input.tables),
    [] as FieldMapping[],
  );
  return { mappings: result, stopped };
}

/** Recommend fixes: the Gap Advisor's reply through `checkedFixes`. */
export async function recommendFixesWithModel(
  input: {
    requirements: Requirement[];
    assessments: RequirementAssessment[];
    tables: LayerTable[];
    lineage: Lineage;
  },
  options: StepModelOptions,
): Promise<{ fixes: GapFix[]; stopped: boolean }> {
  const { result, stopped } = await callOnce(
    'Recommend fixes',
    gapAdvisorAgent,
    recommendFixesRequest(input),
    gapFixesReplySchema,
    FIXES_OUTPUT_TOKENS,
    options,
    (reply) => checkedFixes(reply, input.requirements, input.assessments),
    [] as GapFix[],
  );
  return { fixes: result, stopped };
}
