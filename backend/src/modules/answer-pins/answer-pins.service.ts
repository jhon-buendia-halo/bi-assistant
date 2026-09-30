import { Injectable } from '@nestjs/common';
import { AnswerPinsRepository } from './repositories/answer-pins.repository';
import type {
  AnswerPinDoc,
  FingerprintParts,
} from './entities/answer-pin.entity';
import type { ChatMessage } from '../sessions/entities/session.entity';

/**
 * The persisted assistant message minus the fields a replay must not carry
 * over verbatim: `at` (the replay gets its own timestamp), `feedback` /
 * `usage` (per-turn, not per-lineage) and `consistency` (the *previous*
 * turn's consistency verdict — this turn writes its own). The trace's own
 * `feedback` map is stripped the same way: it is per-block ratings of one
 * specific message, and a replayed message is a different message.
 */
export function stripForPin(
  message: ChatMessage,
): Omit<ChatMessage, 'at' | 'feedback' | 'usage' | 'consistency'> {
  const { at, feedback, usage, consistency, expertTrace, ...rest } = message;
  void at;
  void feedback;
  void usage;
  void consistency;
  if (!expertTrace) return rest;
  const { feedback: traceFeedback, ...traceRest } = expertTrace;
  void traceFeedback;
  return { ...rest, expertTrace: traceRest };
}

/**
 * CRUD over the `answer_pins` collection. `SessionsService` (unit D) is the
 * only caller: it computes the lineage/fingerprint (`pin-key.ts`), decides
 * eligibility (`eligibility.ts`) and orchestrates replay vs. fresh
 * derivation; this service just persists what it is told to.
 */
@Injectable()
export class AnswerPinsService {
  constructor(private readonly repository: AnswerPinsRepository) {}

  lookup(lineageKey: string): Promise<AnswerPinDoc | null> {
    return this.repository.findByLineageKey(lineageKey);
  }

  /**
   * Full replace: delete whatever pin already sits at this lineage, then
   * insert the fresh one. The doc store's `update` is a merge-patch, which
   * would leave a stale `sql`/`rows`/`knowledgeIds` behind a re-derivation
   * that changed shape (a metric that now needs a join it did not before) —
   * a full replace never can.
   */
  async save(doc: AnswerPinDoc): Promise<AnswerPinDoc> {
    await this.repository.deleteByLineageKey(doc.lineageKey);
    return this.repository.insert(doc);
  }

  /** A thumbs-up on the pinned answer: re-key the fingerprint (knowledge/
   * metrics may have moved between the original answer and the approval),
   * swap in the message carrying `verified: true` + the rescored trace, and
   * lift any earlier rejection — the reviewer now vouches for it. */
  async approve(
    lineageKey: string,
    patch: {
      fingerprint: string;
      fingerprintParts: FingerprintParts;
      message: AnswerPinDoc['message'];
    },
  ): Promise<AnswerPinDoc | null> {
    const approved = await this.repository.patch(lineageKey, patch);
    if (!approved) return null;
    let current: AnswerPinDoc | null = approved;
    if (approved.rejectedAt !== undefined) {
      current = await this.repository.unset(lineageKey, 'rejectedAt');
    }
    if (approved.rejectedBy !== undefined) {
      current = await this.repository.unset(lineageKey, 'rejectedBy');
    }
    return current;
  }

  /**
   * A thumbs-down anywhere on the answer: the pin is no longer trusted — it
   * is never replayed and its wording is never kept again — but it stays, so
   * the next fresh derivation can report what changed since it. `block`
   * names the rated reasoning block (absent for a whole-answer 👎). Returns
   * how many pins were marked (0 or 1).
   */
  async reject(
    lineageKey: string,
    at: string,
    by?: { block?: string },
  ): Promise<number> {
    const rejected = await this.repository.patch(lineageKey, {
      rejectedAt: at,
      ...(by ? { rejectedBy: by } : {}),
    });
    if (!rejected) return 0;
    if (!by && rejected.rejectedBy !== undefined) {
      await this.repository.unset(lineageKey, 'rejectedBy');
    }
    return 1;
  }

  /** Hard delete of one lineage's pin (`DELETE /answer-pins/:lineageKey`). */
  remove(lineageKey: string): Promise<number> {
    return this.repository.deleteByLineageKey(lineageKey);
  }

  /** Records a successful replay: bumps `replays`, stamps `lastReplayedAt`. */
  async touchReplay(
    lineageKey: string,
    at: string,
  ): Promise<AnswerPinDoc | null> {
    const existing = await this.repository.findByLineageKey(lineageKey);
    if (!existing) return null;
    return this.repository.patch(lineageKey, {
      replays: (existing.replays ?? 0) + 1,
      lastReplayedAt: at,
    });
  }

  /** Every pin, newest first, optionally scoped to one dataset. */
  list(datasetId?: string): Promise<AnswerPinDoc[]> {
    return this.repository.list(datasetId);
  }

  /** Removes every pin that touches a dataset — called when the dataset is deleted. */
  deleteForDataset(datasetId: string): Promise<number> {
    return this.repository.deleteForDataset(datasetId);
  }
}
