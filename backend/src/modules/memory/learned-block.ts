import type { KnowledgeUse } from '../knowledge/entities/knowledge-snippet.entity';
import type { RecalledSignal } from './learning-store.port';
import { utcDay } from './signal-text';

/**
 * Block 3b of a chat turn (agents.md 4.1, knowledge R36 to R38): what the
 * learning memories of the session's datasources recalled, and the
 * "Knowledge in context" entries recorded for it. Pure module.
 */

export const LEARNED_BLOCK_HEADING =
  'Learned from past sessions (not curated; curated knowledge wins on conflict):';
/** Characters of summaries and signals the block may carry. */
export const LEARNED_BLOCK_CHARS = 6_000;

/** What one learning memory answered in time. */
export interface LearningMemoryRecall {
  /** The memory's scope: a datasource id. */
  scope: string;
  summary: string | null;
  signals: RecalledSignal[];
}

/**
 * The block and its entries, or no block when no memory had a summary or a
 * relevant signal. Summaries first, then every signal oldest first (a later
 * one after an earlier one it may contradict), a text found twice once;
 * when they do not all fit the budget, the oldest signals are left out.
 */
export function learnedBlock(
  memories: LearningMemoryRecall[],
  budget = LEARNED_BLOCK_CHARS,
): { block?: string; used: KnowledgeUse[] } {
  let left = budget;
  const summaries: { scope: string; text: string }[] = [];
  for (const memory of memories) {
    const text = memory.summary?.trim();
    if (!text || text.length > left) continue;
    left -= text.length;
    summaries.push({ scope: memory.scope, text });
  }

  const byText = new Map<string, RecalledSignal>();
  for (const signal of memories.flatMap((memory) => memory.signals)) {
    const kept = byText.get(signal.content);
    if (!kept || kept.occurredAt <= signal.occurredAt) {
      byText.set(signal.content, signal);
    }
  }
  const newestFirst = [...byText.values()]
    .filter((signal) => signal.content.trim())
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const signals: RecalledSignal[] = [];
  for (const signal of newestFirst) {
    if (signal.content.length > left) break;
    left -= signal.content.length;
    signals.unshift(signal);
  }

  if (!summaries.length && !signals.length) return { used: [] };
  const parts = [
    ...summaries.map((summary) => `Summary:\n${summary.text}`),
    ...signals.map((signal) => signal.content),
  ];
  return {
    block: `${LEARNED_BLOCK_HEADING}\n${parts.join('\n\n')}`,
    used: [
      ...summaries.map((summary): KnowledgeUse => ({
        id: `summary:${summary.scope}`,
        kind: 'summary',
        title: 'summary',
        body: summary.text,
        source: 'memory',
      })),
      ...signals.map((signal): KnowledgeUse => ({
        id: signal.documentId,
        kind: signal.kind,
        title: `${signal.kind} · ${signalDay(signal)}`,
        body: signal.content,
        source: 'memory',
      })),
    ],
  };
}

/** The date the signal's text carries (`[kind · YYYY-MM-DD]`). */
function signalDay(signal: RecalledSignal): string {
  return (
    /^\[\w+ · (\d{4}-\d{2}-\d{2})\]/.exec(signal.content)?.[1] ??
    utcDay(signal.occurredAt)
  );
}
