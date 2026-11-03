import type { ReasoningEffort } from '../../../mastra/effort-levels';

// Connection probes per API style (units 4 and 5: BA-285, BA-286).

export interface CustomProbeOptions {
  /** Already normalised (`normalizeBaseUrl`). */
  baseUrl: string;
  apiKey?: string;
  model: string;
  effort?: ReasoningEffort;
}

/** Success; failures throw Error with the user-facing text (messages.ts). */
export interface CustomProbeReply {
  reply: string;
  latencyMs: number;
}

export function probeOpenAiStyle(
  options: CustomProbeOptions,
): Promise<CustomProbeReply> {
  void options;
  return Promise.reject(
    new Error('OpenAI-style probe is not implemented yet (BA-281 scaffold)'),
  );
}
