import { RUN_TITLE_MAX } from './workflow-run-steps';
import type { WorkflowRunDoc, WorkflowRunSummary } from './workflow-run-steps';

/** One conversation as the left panel lists it (api.md 168). */
export interface ConversationSummary {
  /** The `conversationId` (its first run's id). */
  id: string;
  /** The first run's question, trimmed, at most `RUN_TITLE_MAX` characters. */
  title: string;
  /** Every run's datasets, first-seen order, no repeats. */
  datasets: string[];
  /** The newest `finishedAt ?? startedAt` of its runs. */
  lastActivityAt: string;
  runCount: number;
  /** The run to open: the newest `startedAt`. */
  lastRunId: string;
  /** The status of `lastRunId`. */
  status: WorkflowRunSummary['status'];
  archivedAt?: string;
}

/**
 * Group one binding's runs into conversations (api.md 168), newest activity
 * first. `q` (trimmed, case-insensitive) keeps a conversation when any run's
 * question or answer text contains it.
 */
export function conversationSummaries(
  runs: readonly WorkflowRunDoc[],
  q?: string,
): ConversationSummary[] {
  const groups = new Map<string, WorkflowRunDoc[]>();
  for (const run of runs) {
    const key = run.conversationId ?? run.id;
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  const needle = q?.trim().toLowerCase() ?? '';
  const summaries: ConversationSummary[] = [];
  for (const [id, group] of groups) {
    const sorted = [...group].sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt),
    );
    if (
      needle &&
      !sorted.some((run) =>
        [run.question, run.answer?.content].some((text) =>
          text?.toLowerCase().includes(needle),
        ),
      )
    ) {
      continue;
    }
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const archivedAt = sorted.find((run) => run.archivedAt)?.archivedAt;
    summaries.push({
      id,
      title: (first.question ?? '').trim().slice(0, RUN_TITLE_MAX),
      datasets: [...new Set(sorted.flatMap((run) => run.datasets ?? []))],
      lastActivityAt: sorted
        .map((run) => run.finishedAt ?? run.startedAt)
        .reduce((a, b) => (b > a ? b : a)),
      runCount: sorted.length,
      lastRunId: last.id,
      status: last.status,
      ...(archivedAt ? { archivedAt } : {}),
    });
  }
  return summaries.sort((a, b) =>
    b.lastActivityAt.localeCompare(a.lastActivityAt),
  );
}
