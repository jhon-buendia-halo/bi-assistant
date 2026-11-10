import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { copilotRequestFailedMessage } from '../../../mastra/copilot/copilot-contracts';
import { createCopilotModel, getCopilotRuntime } from '../../../mastra/copilot';
import { effortLevelsForProvider } from '../../../mastra/effort-levels';
import { TIMEOUT_MESSAGE } from '../custom-endpoint/messages';

// GitHub Copilot connection probe (R58): sign-in check, then a throwaway
// Mastra agent on the Copilot model asked for the same structured reply the
// other probes use.

const PROBE_PROMPT =
  'Reply with JSON matching the schema, using the value "ok" for `status`.';
const PROBE_TIMEOUT_MS = 30_000;
const PROBE_SCHEMA = z.object({ status: z.string() });

const STRUCTURED_OUTPUT_MESSAGE =
  'Model answered but could not produce structured JSON output, which every agent here requires';

/** Texts the runtime and model already phrase for the user (R57, R58). */
const PASS_THROUGH_PREFIXES = [
  'GitHub Copilot request failed',
  'Not signed in to GitHub',
  'The GitHub Copilot runtime could not start',
];

function failureMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (PASS_THROUGH_PREFIXES.some((prefix) => msg.startsWith(prefix))) {
    return msg;
  }
  return copilotRequestFailedMessage(msg.slice(0, 300));
}

export interface CopilotProbeReply {
  reply: string;
  latencyMs: number;
}

/**
 * Probes GitHub Copilot with `model` (`auto` or a model name). Success
 * returns the reply and latency; every failure throws Error with the
 * user-facing text.
 */
export async function probeCopilot(model: string): Promise<CopilotProbeReply> {
  await getCopilotRuntime().ensureSignedIn();

  const levels = effortLevelsForProvider('copilot', model);
  const probe = new Agent({
    id: 'llm-connection-probe',
    name: 'LLM connection probe',
    instructions: 'You answer connection probes exactly as asked.',
    model: createCopilotModel({ model }),
  });

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  let status: unknown;
  try {
    const result = await probe.generate(PROBE_PROMPT, {
      structuredOutput: { schema: PROBE_SCHEMA },
      ...(levels.length
        ? { providerOptions: { copilot: { reasoningEffort: levels[0] } } }
        : {}),
      abortSignal: controller.signal,
    });
    status = (result.object as { status?: unknown } | undefined)?.status;
  } catch (err) {
    if (controller.signal.aborted) throw new Error(TIMEOUT_MESSAGE);
    throw new Error(failureMessage(err));
  } finally {
    clearTimeout(timer);
  }

  // Mastra resolves an aborted run without an object instead of throwing.
  if (controller.signal.aborted) throw new Error(TIMEOUT_MESSAGE);
  if (typeof status !== 'string' || !status.trim()) {
    throw new Error(STRUCTURED_OUTPUT_MESSAGE);
  }
  return { reply: status.trim(), latencyMs: Date.now() - started };
}
