import type { KnowledgeUse } from '../knowledge/entities/knowledge-snippet.entity';
import type { MentalModel, RecalledMemory } from './learning-store.port';

/**
 * The turn's view of the learning memory (ADR-0013). Pure module: the
 * system blocks a recall and the mental models become, and the provenance
 * entries recorded for the answer.
 */

export const LEARNED_BLOCK_HEADING =
  '## Learned from past sessions (not curated; curated knowledge wins on conflict)';
export const MENTAL_MODELS_HEADING =
  '## What this datasource has taught the assistant';

/** One line of memory text: whitespace collapsed so the list stays a list. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** `observation · 3 evidences`, `experience · 2026-09-28`, `world`. */
function label(memory: RecalledMemory): string {
  if (memory.type === 'observation' && memory.evidenceCount) {
    const count = memory.evidenceCount;
    return `observation · ${count} ${count === 1 ? 'evidence' : 'evidences'}`;
  }
  if (memory.type === 'experience' && memory.occurredAt) {
    return `experience · ${memory.occurredAt.slice(0, 10)}`;
  }
  return memory.type;
}

/**
 * The "Learned from past sessions" system block, or undefined when nothing
 * was recalled — no memories, no block.
 */
export function learnedBlock(memories: RecalledMemory[]): string | undefined {
  const lines = memories
    .filter((memory) => oneLine(memory.text))
    .map((memory) => `- [${label(memory)}] ${oneLine(memory.text)}`);
  return lines.length
    ? [LEARNED_BLOCK_HEADING, ...lines].join('\n')
    : undefined;
}

/** One `###` section per mental model, or undefined when none has content. */
export function mentalModelsBlock(models: MentalModel[]): string | undefined {
  const sections = models
    .filter((model) => model.content.trim())
    .map((model) => `### ${model.name}\n${model.content.trim()}`);
  return sections.length
    ? [MENTAL_MODELS_HEADING, ...sections].join('\n\n')
    : undefined;
}

/**
 * Each recalled memory as an entry of the answer's "Knowledge in context",
 * marked `source: 'memory'`. Recorded beside the curated snippets, so the
 * answer pin's fingerprint covers them too.
 */
export function toKnowledgeUse(memories: RecalledMemory[]): KnowledgeUse[] {
  return memories
    .filter((memory) => oneLine(memory.text))
    .map((memory) => ({
      id: memory.id,
      kind: 'instruction',
      title: `${memory.type} memory`,
      body: oneLine(memory.text),
      source: 'memory',
    }));
}
