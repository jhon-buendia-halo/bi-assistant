import type { PromptMessage } from './context-segments';
import type { CallUsage } from './model-prices';
import { asRecord, type CollapsedSpan } from './span-collapse';

/** Values read off collapsed spans, shared by the calls and the session flow. */

export function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export function durationMs(start: Date, end: Date | null): number | null {
  return end ? end.getTime() - start.getTime() : null;
}

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** `attributes.usage`, or an empty record. */
export function usage(
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  return asRecord(attributes.usage);
}

/** A span's token usage, in the price table's shape. */
export function callUsage(span: CollapsedSpan): CallUsage {
  const u = usage(span.attributes);
  const input = asRecord(u.inputDetails);
  return {
    inputTokens: num(u.inputTokens),
    outputTokens: num(u.outputTokens),
    cacheReadTokens: num(input.cacheRead),
    cacheWriteTokens: num(input.cacheWrite),
  };
}

/** A model_generation's model id (as the calls query reads it). */
export function callModel(span: CollapsedSpan): string {
  const { model, responseModel } = span.attributes;
  if (typeof model === 'string') return model;
  return typeof responseModel === 'string' ? responseModel : '';
}

/** `attributes.finishReason`, when it is a string. */
export function finishReason(span: CollapsedSpan): string | null {
  const finish = span.attributes.finishReason;
  return typeof finish === 'string' ? finish : null;
}

/** The prompt messages of a span input: an array, or `{ messages }`. */
export function messages(input: unknown): PromptMessage[] {
  const list: unknown = Array.isArray(input)
    ? input
    : input && typeof input === 'object'
      ? (input as { messages?: unknown }).messages
      : undefined;
  if (!Array.isArray(list)) return [];
  return (list as unknown[]).filter(
    (m): m is PromptMessage =>
      !!m &&
      typeof m === 'object' &&
      typeof (m as { role?: unknown }).role === 'string',
  );
}

/** The text parts only of a message's content, joined by new lines. */
export function textParts(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const texts = (content as unknown[])
    .map((part) => asRecord(part))
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string);
  return texts.length ? texts.join('\n') : null;
}

/** Cuts a text to `max` chars, the last one an ellipsis when cut. */
export function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
