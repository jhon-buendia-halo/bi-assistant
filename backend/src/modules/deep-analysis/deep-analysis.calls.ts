import type { MastraService } from '../../mastra/mastra.service';
import {
  angleFinding,
  failedAngle,
  findingsBlock,
  type AnalysisAngle,
  type AngleFinding,
} from '../../mastra/workflows/deep-analysis.steps';
import type { SessionDoc } from '../sessions/entities/session.entity';
import type { SessionsService } from '../sessions/sessions.service';
import { phasePrompt } from './deep-analysis.phases';
import {
  analysisPlanSchema,
  analysisReportSchema,
  type AnalysisPlan,
  type AnalysisReportOutput,
} from './deep-analysis.schemas';

/**
 * The three assistant calls of a deep analysis (agents.md 2.7), shared by
 * the chat's background job and the `deep-analysis` run workflow (5.15), so
 * both send the assistant the same prompts with the same options: the
 * session's (or run host's) grounding without its memory thread.
 */
export interface DeepAnalysisCallDeps {
  sessions: Pick<SessionsService, 'backgroundAgentOptions'>;
  mastra: Pick<MastraService, 'getAgent'>;
  /** Where a failed angle is logged. */
  warn(message: string): void;
}

/** Step 1: 3-5 distinct angles, one structured call, no tools. */
export async function planAnalysis(
  deps: DeepAnalysisCallDeps,
  session: SessionDoc,
  question: string,
  abortSignal?: AbortSignal,
): Promise<AnalysisPlan> {
  const prompt = phasePrompt('plan', { question });
  const options = await deps.sessions.backgroundAgentOptions(
    session,
    question,
    abortSignal,
  );
  const generated = await deps.mastra.getAgent('assistant').generate(prompt, {
    ...options,
    maxSteps: 1,
    toolChoice: 'none',
    structuredOutput: {
      schema: analysisPlanSchema,
      jsonPromptInjection: 'inline' as const,
    },
  });
  const parsed = analysisPlanSchema.safeParse(
    generated.object ?? parseJsonObject(generated.text),
  );
  if (!parsed.success) {
    throw new Error('the planner returned no usable investigation plan');
  }
  return parsed.data;
}

/**
 * Step 2: one tool-enabled turn for one angle. A failure inside the angle
 * becomes its finding (R8); an abort, or a broken phase file, throws.
 */
export async function investigateAngle(
  deps: DeepAnalysisCallDeps,
  session: SessionDoc,
  question: string,
  angle: AnalysisAngle,
  index: number,
  total: number,
  abortSignal?: AbortSignal,
): Promise<AngleFinding> {
  // Built outside the try: a broken phase file fails the job, not one angle.
  const prompt = phasePrompt('investigate', {
    angleIndex: String(index + 1),
    angleTotal: String(total),
    angleTitle: angle.title,
    question,
    angleQuestion: angle.question,
  });
  const options = await deps.sessions.backgroundAgentOptions(
    session,
    angle.question,
    abortSignal,
  );
  try {
    const result = await deps.mastra
      .getAgent('assistant')
      .generate(prompt, { ...options, maxSteps: 15 });
    return angleFinding(angle, result.text ?? '');
  } catch (error) {
    if (abortSignal?.aborted) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    deps.warn(`Deep analysis angle "${angle.title}" failed: ${detail}`);
    // One failed angle must not lose the rest of the report.
    return failedAngle(angle, detail);
  }
}

/** Step 3: one structured, tool-free call that writes the report. */
export async function writeAnalysis(
  deps: DeepAnalysisCallDeps,
  session: SessionDoc,
  question: string,
  findings: readonly AngleFinding[],
  abortSignal?: AbortSignal,
): Promise<AnalysisReportOutput> {
  const prompt = phasePrompt('report', {
    question,
    findings: findingsBlock(findings),
  });
  const options = await deps.sessions.backgroundAgentOptions(
    session,
    question,
    abortSignal,
  );
  const result = await deps.mastra.getAgent('assistant').generate(prompt, {
    ...options,
    maxSteps: 1,
    toolChoice: 'none',
    structuredOutput: {
      schema: analysisReportSchema,
      jsonPromptInjection: 'inline' as const,
    },
  });
  const parsed = analysisReportSchema.safeParse(
    result.object ?? parseJsonObject(result.text),
  );
  if (!parsed.success) {
    throw new Error('the report writer returned no usable report');
  }
  return parsed.data;
}

/** Parse a model's JSON reply, tolerating a markdown fence around it. */
function parseJsonObject(text: string | undefined): unknown {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(
      trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
    );
  } catch {
    return undefined;
  }
}
