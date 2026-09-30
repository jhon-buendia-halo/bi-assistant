import { BadRequestException } from '@nestjs/common';
import {
  REASONING_BLOCK_KINDS,
  type BlockVote,
  type ReasoningBlockKind,
} from '../entities/reasoning-trace.entity';
import type { ReasoningFeedbackPatch } from '../repositories/reasoning-feedback.repository';

/** Longest comment kept on one block rating. */
export const FEEDBACK_COMMENT_CHARS = 2_000;

/**
 * `POST /sessions/:id/expert/feedback` body. PATCH semantics: only the fields
 * present are changed — `vote: null` clears the vote, `comment: null` (or an
 * empty comment) clears the comment, an absent field is left as stored.
 */
export class BlockFeedbackDto {
  /** `at` of the assistant message whose trace is rated. */
  messageAt?: string;
  block?: ReasoningBlockKind;
  vote?: BlockVote | null;
  comment?: string | null;
}

export interface ValidBlockFeedback {
  messageAt: string;
  block: ReasoningBlockKind;
  patch: ReasoningFeedbackPatch;
}

/** Validate the body; the patch carries only the keys the client sent. */
export function validateBlockFeedback(
  body: BlockFeedbackDto | undefined,
): ValidBlockFeedback {
  const messageAt = typeof body?.messageAt === 'string' ? body.messageAt : '';
  if (!messageAt) throw new BadRequestException('messageAt is required');
  const block = body?.block;
  if (!block || !REASONING_BLOCK_KINDS.includes(block)) {
    throw new BadRequestException(
      `block must be one of ${REASONING_BLOCK_KINDS.join(', ')}`,
    );
  }
  const patch: ReasoningFeedbackPatch = {};
  if (body && 'vote' in body && body.vote !== undefined) {
    if (body.vote !== null && body.vote !== 'up' && body.vote !== 'down') {
      throw new BadRequestException("vote must be 'up', 'down' or null");
    }
    patch.vote = body.vote;
  }
  if (body && 'comment' in body && body.comment !== undefined) {
    if (body.comment !== null && typeof body.comment !== 'string') {
      throw new BadRequestException('comment must be a string or null');
    }
    patch.comment =
      body.comment === null
        ? null
        : body.comment.trim().slice(0, FEEDBACK_COMMENT_CHARS);
  }
  if (!('vote' in patch) && !('comment' in patch)) {
    throw new BadRequestException('send a vote, a comment, or both');
  }
  return { messageAt, block, patch };
}
