import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type {
  HindsightClient,
  MemoryItemInput,
  RecallResult,
} from '@vectorize-io/hindsight-client';
import { withTimeout } from '../../infrastructure/memory/hindsight.client';
import type { MemorySignal } from './entities/memory-signal.entity';
import type {
  LearningStore,
  MentalModel,
  RecallQuery,
  RecalledMemory,
} from './learning-store.port';

/** One bank per datasource: what one database taught never leaks into another. */
export function bankIdFor(datasourceId: string): string {
  return `halo-ds-${datasourceId}`;
}

/** Tag on a memory that applies to every dataset of its datasource. */
export const GLOBAL_SCOPE_TAG = 'scope:global';

/**
 * Tags on every retained memory: its datasets (or `scope:global`), its
 * signal kind and the tables it names — what recall filters on, and what a
 * curator filters by in the Hindsight UI.
 */
export function memoryTags(signal: MemorySignal): string[] {
  const scope = signal.datasetIds.length
    ? signal.datasetIds.map((id) => `dataset:${id}`)
    : [GLOBAL_SCOPE_TAG];
  return [
    ...scope,
    `kind:${signal.kind}`,
    ...signal.entities.map((entity) => `entity:${entity}`),
  ];
}

/**
 * `LearningStore` over the official Hindsight TypeScript client (0.10.x).
 * The client's options are camelCase but its responses are the server's
 * snake_case (`document_id`, `occurred_start`, `source_fact_ids`), so the
 * mapping below reads snake_case.
 */
export class HindsightLearningStore implements LearningStore {
  readonly enabled = true;
  private readonly logger = new Logger(HindsightLearningStore.name);

  constructor(private readonly client: HindsightClient) {}

  /**
   * One async `retainBatch` per bank, one item per signal. Throws when the
   * server refuses, so the outbox can retry; a retry of the same batch reuses
   * its operation id, which the server deduplicates.
   */
  async retain(signals: MemorySignal[]): Promise<void> {
    const byBank = new Map<string, MemorySignal[]>();
    for (const signal of signals) {
      const bank = bankIdFor(signal.datasourceId);
      byBank.set(bank, [...(byBank.get(bank) ?? []), signal]);
    }
    for (const [bank, group] of byBank) {
      await this.client.retainBatch(bank, group.map(toMemoryItem), {
        async: true,
        operationId: batchOperationId(group),
      });
    }
  }

  /**
   * Observations first (`preferObservations` drops the raw facts an
   * observation already consolidates), filtered to the session's datasets
   * plus datasource-wide memories. No LLM runs on the server for a recall.
   */
  async recall(query: RecallQuery): Promise<RecalledMemory[]> {
    try {
      const response = await withTimeout(query.timeoutMs, (signal) =>
        this.client.recall(bankIdFor(query.datasourceId), query.question, {
          types: ['observation', 'experience', 'world'],
          budget: 'low',
          maxTokens: query.maxTokens,
          tags: [
            ...query.datasetIds.map((id) => `dataset:${id}`),
            GLOBAL_SCOPE_TAG,
          ],
          tagsMatch: 'any',
          preferObservations: true,
          signal,
        }),
      );
      return (response.results ?? [])
        .filter((result) => result.text?.trim())
        .map(toRecalledMemory);
    } catch (error) {
      this.logger.debug(
        `Memory recall skipped for ${query.datasourceId}: ${errorText(error)}`,
      );
      return [];
    }
  }

  async mentalModels(
    datasourceId: string,
    timeoutMs: number,
  ): Promise<MentalModel[]> {
    try {
      const list = await withTimeout(timeoutMs, (signal) =>
        this.client.listMentalModels(bankIdFor(datasourceId), {
          // The list defaults to metadata only — `content` comes back null.
          detail: 'content',
          signal,
        }),
      );
      return (list.items ?? [])
        .filter((model) => model.content?.trim())
        .map((model) => ({
          id: model.id,
          name: model.name,
          content: model.content!.trim(),
        }));
    } catch (error) {
      this.logger.debug(
        `Mental models skipped for ${datasourceId}: ${errorText(error)}`,
      );
      return [];
    }
  }

  async forget(datasourceId: string, documentId: string): Promise<void> {
    try {
      await this.client.deleteDocument(bankIdFor(datasourceId), documentId);
    } catch (error) {
      // Usually a document that was never retained (the lever was off, or
      // the signal is still in the outbox — which drops it separately).
      this.logger.debug(`Memory forget of ${documentId}: ${errorText(error)}`);
    }
  }
}

function toMemoryItem(signal: MemorySignal): MemoryItemInput {
  return {
    content: signal.content,
    context: signal.context,
    timestamp: signal.occurredAt,
    document_id: signal.documentId,
    tags: memoryTags(signal),
    metadata: { kind: signal.kind, datasourceId: signal.datasourceId },
  };
}

/** The server's result, snake_case, onto the port's shape. */
export function toRecalledMemory(result: RecallResult): RecalledMemory {
  const type =
    result.type === 'observation' || result.type === 'experience'
      ? result.type
      : 'world';
  const occurredAt = result.occurred_start ?? result.mentioned_at;
  return {
    id: result.id,
    type,
    text: result.text.trim(),
    ...(occurredAt ? { occurredAt } : {}),
    ...(result.document_id ? { documentId: result.document_id } : {}),
    entities: result.entities ?? [],
    ...(Array.isArray(result.source_fact_ids)
      ? { evidenceCount: result.source_fact_ids.length }
      : {}),
  };
}

/**
 * A UUID that identifies this exact batch: a lone signal's own id, else one
 * derived from the sorted signal ids. Re-sending the same batch after a lost
 * acknowledgement reuses it (the server returns the original operation); a
 * batch with different signals gets a different one.
 */
export function batchOperationId(signals: MemorySignal[]): string {
  if (signals.length === 1) return signals[0].id;
  const hex = createHash('sha256')
    .update(
      signals
        .map((signal) => signal.id)
        .sort()
        .join(','),
    )
    .digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
