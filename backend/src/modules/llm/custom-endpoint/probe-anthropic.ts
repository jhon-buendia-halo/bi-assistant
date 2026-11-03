import type { CustomProbeOptions, CustomProbeReply } from './probe';

// Anthropic-style connection probe (unit 5, BA-286).

export function probeAnthropicStyle(
  options: CustomProbeOptions,
): Promise<CustomProbeReply> {
  void options;
  return Promise.reject(
    new Error('Anthropic-style probe is not implemented yet (BA-281 scaffold)'),
  );
}
