import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { REASONING_FEEDBACK_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type {
  BlockVote,
  ReasoningBlock,
  ReasoningBlockKind,
  ReasoningFeedbackDoc,
} from '../entities/reasoning-trace.entity';

/** A feedback document's identity: one rating per block of one answer. */
export interface ReasoningFeedbackKey {
  sessionId: string;
  messageAt: string;
  block: ReasoningBlockKind;
}

/** Refreshed on every write — they describe what was rated. */
export interface ReasoningFeedbackContext {
  traceId: string;
  question: string;
  blockSnapshot: ReasoningBlock;
}

/**
 * PATCH semantics: an absent field is left as stored, `null` clears it. An
 * empty (whitespace-only) comment clears the comment too.
 */
export interface ReasoningFeedbackPatch {
  vote?: BlockVote | null;
  comment?: string | null;
}

/**
 * Per-block ratings of reasoning traces, upserted by (sessionId, messageAt,
 * block) so re-rating a block never forks. Kept apart from the session so the
 * improvement loop can read every rating — and so ratings survive a deleted
 * session (the question and the rated block are copied in).
 */
@Injectable()
export class ReasoningFeedbackRepository {
  constructor(
    @Inject(REASONING_FEEDBACK_STORE)
    private readonly store: DocStore<ReasoningFeedbackDoc>,
  ) {}

  /** Newest first; optionally one session's ratings only. */
  list(sessionId?: string): Promise<ReasoningFeedbackDoc[]> {
    return this.store.find(sessionId ? { sessionId } : {}, {
      sort: { updatedAt: -1 },
    });
  }

  get(key: ReasoningFeedbackKey): Promise<ReasoningFeedbackDoc | null> {
    return this.store.findOne({ ...key });
  }

  async upsert(
    key: ReasoningFeedbackKey,
    context: ReasoningFeedbackContext,
    patch: ReasoningFeedbackPatch,
  ): Promise<ReasoningFeedbackDoc> {
    const filter = { ...key };
    const existing = await this.store.findOne(filter);
    const comment =
      typeof patch.comment === 'string' ? patch.comment.trim() : patch.comment;
    const set: Partial<ReasoningFeedbackDoc> = {
      id: existing?.id ?? randomUUID(),
      ...key,
      ...context,
      ...(patch.vote === 'up' || patch.vote === 'down'
        ? { vote: patch.vote }
        : {}),
      ...(comment ? { comment } : {}),
    };
    let saved = await this.store.update(filter, set, { upsert: true });
    // Clearing goes through `unset` rather than writing `undefined`, so the
    // field is gone from the stored document whatever the adapter does with
    // undefined values.
    if (existing && patch.vote === null && existing.vote !== undefined) {
      saved = await this.store.unset(filter, 'vote');
    }
    const clearsComment =
      patch.comment === null || (typeof patch.comment === 'string' && !comment);
    if (existing && clearsComment && existing.comment !== undefined) {
      saved = await this.store.unset(filter, 'comment');
    }
    return (saved ?? { ...existing, ...set }) as ReasoningFeedbackDoc;
  }
}
