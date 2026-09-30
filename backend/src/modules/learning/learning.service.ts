import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { MastraService } from '../../mastra/mastra.service';
import {
  feedbackLearnerOutputSchema,
  type FeedbackLearnerOutput,
} from '../../mastra/agents/feedback-learner.agent';
import { KnowledgeService } from '../knowledge/knowledge.service';
import type {
  KnowledgeSnippet,
  KnowledgeSnippetInput,
  KnowledgeSnippetKind,
  LessonProvenance,
} from '../knowledge/entities/knowledge-snippet.entity';
import type { DatasetEntitySnapshot } from '../datasets/repositories/datasets.repository';
import type {
  BlockVote,
  ReasoningBlock,
  ReasoningBlockKind,
} from '../expert-mode/entities/reasoning-trace.entity';
import {
  buildLearnPrompt,
  sanitiseLessons,
  verbatimFallback,
  type SanitisedLesson,
} from './lesson-distiller';

/**
 * The slice of `KnowledgeService` this module depends on, typed structurally
 * (rather than as `KnowledgeService` itself) so this file has no compile-time
 * dependency on that service's full surface — only on the three methods it
 * actually calls. `KnowledgeService` is still injected by its own class token
 * (below), so the real instance is wired at runtime.
 */
export interface LessonStore {
  /** Insert one learned snippet (`source: 'feedback'`); same validation as `create`. */
  createLearned(
    input: KnowledgeSnippetInput,
    provenance: LessonProvenance,
  ): Promise<KnowledgeSnippet>;
  /** Delete every lesson learned from one feedback doc. Returns the count removed. */
  deleteLearnedFor(feedbackId: string): Promise<number>;
  /** Enabled lessons in scope of these datasets, newest first. */
  listLearned(datasetIds: string[]): Promise<KnowledgeSnippet[]>;
}

export interface LearnInput {
  sessionId: string;
  messageAt: string;
  feedbackId: string;
  /** Dataset names in scope for the session; a lesson is stored once per dataset. */
  datasets: string[];
  question: string;
  answer: string;
  block: ReasoningBlockKind;
  vote?: BlockVote;
  comment: string;
  blockSnapshot: ReasoningBlock;
  finalSql?: string;
  entities: DatasetEntitySnapshot[];
  existingTitles: string[];
}

export interface LearnedLesson {
  id: string;
  kind: KnowledgeSnippetKind;
  title: string;
  body: string;
  method: 'agent' | 'verbatim';
}

export interface LearnResult {
  lessons: LearnedLesson[];
  /** Previously learned snippets removed for this feedback doc before re-learning. */
  superseded: number;
}

export const FEEDBACK_LEARNER_AGENT_ID = 'feedback-learner';

/** One authoring call, plus one retry carrying the validation error. */
const AUTHOR_ATTEMPTS = 2;
const RETRY_ERROR_CHARS = 1_500;

/**
 * Turns one reviewer comment on a rated reasoning block into 0..n standing
 * knowledge snippets (`source: 'feedback'`), via the `feedback-learner` agent
 * with a deterministic verbatim fallback when the model cannot be used.
 * Re-learning always starts from a clean slate: the feedback doc's previous
 * lessons are deleted before the new ones (if any) are written, so editing a
 * note never leaves stale knowledge behind.
 *
 * Never throws to the caller for a model failure — logged as a warning and
 * covered by the verbatim fallback, because losing the reviewer's note
 * entirely would be worse than a blunt lesson.
 */
@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  constructor(
    private readonly mastra: MastraService,
    @Inject(KnowledgeService) private readonly knowledge: LessonStore,
  ) {}

  async learnFromComment(input: LearnInput): Promise<LearnResult> {
    // Re-learn from scratch: a re-edited note re-derives its lessons rather
    // than accumulating alongside the old ones.
    const superseded = await this.knowledge.deleteLearnedFor(input.feedbackId);

    const comment = input.comment?.trim() ?? '';
    if (!comment) return { lessons: [], superseded };

    const output = await this.author(input, comment);
    const method: 'agent' | 'verbatim' = output ? 'agent' : 'verbatim';
    const entityKeys = (input.entities ?? []).map((e) => e.key);
    const drafts: SanitisedLesson[] = output
      ? sanitiseLessons(output.lessons, entityKeys)
      : [verbatimFallback(input.block, comment)];

    // A successful agent call with no generalisable rule (`nothingToLearn`)
    // is a valid outcome, not a failure — nothing to persist beyond the
    // supersede above.
    if (!drafts.length) return { lessons: [], superseded };

    const provenance: LessonProvenance = {
      feedbackId: input.feedbackId,
      sessionId: input.sessionId,
      messageAt: input.messageAt,
      block: input.block,
      question: input.question,
      comment,
      ...(input.vote ? { vote: input.vote } : {}),
      learnedAt: new Date().toISOString(),
      method,
    };

    // A session can span several datasets; a lesson learned in it applies to
    // every one of them, so one copy is stored per dataset.
    const datasetIds = input.datasets.length ? input.datasets : [undefined];
    const lessons: LearnedLesson[] = [];
    for (const draft of drafts) {
      let firstId: string | undefined;
      for (const datasetId of datasetIds) {
        const created = await this.knowledge.createLearned(
          {
            kind: draft.kind,
            scope: datasetId ? { datasetId } : null,
            title: draft.title,
            body: draft.body,
            ...(draft.synonyms.length ? { synonyms: draft.synonyms } : {}),
            ...(draft.entities.length ? { entities: draft.entities } : {}),
            enabled: true,
          },
          provenance,
        );
        firstId ??= created.id;
      }
      lessons.push({
        id: firstId as string,
        kind: draft.kind,
        title: draft.title,
        body: draft.body,
        method,
      });
    }
    return { lessons, superseded };
  }

  /** Remove every lesson learned from one feedback doc (a cleared comment). */
  forget(feedbackId: string): Promise<number> {
    return this.knowledge.deleteLearnedFor(feedbackId);
  }

  // ------------------------------------------------------------- authoring

  /**
   * One structured call to the `feedback-learner` agent, plus one retry
   * carrying the validation error. `undefined` on two failures — the caller
   * falls back to the verbatim lesson.
   */
  private async author(
    input: LearnInput,
    comment: string,
  ): Promise<FeedbackLearnerOutput | undefined> {
    const prompt = buildLearnPrompt({ ...input, comment });
    let problem: string | undefined;
    for (let attempt = 1; attempt <= AUTHOR_ATTEMPTS; attempt++) {
      const text = problem
        ? [
            prompt,
            '',
            '<previous-reply-problem>',
            `Your previous reply could not be used: ${problem}`,
            'Reply again with only the JSON object that matches the schema.',
            '</previous-reply-problem>',
          ].join('\n')
        : prompt;
      try {
        const result = await this.mastra
          .getAgent(FEEDBACK_LEARNER_AGENT_ID)
          .generate(text, {
            maxSteps: 1,
            toolChoice: 'none',
            providerOptions: { openai: { reasoningEffort: 'medium' } },
            structuredOutput: {
              schema: feedbackLearnerOutputSchema,
              jsonPromptInjection: 'inline',
            },
          });
        const parsed = feedbackLearnerOutputSchema.safeParse(
          withoutNulls(result.object ?? parseJsonObject(result.text)),
        );
        if (parsed.success) return parsed.data;
        problem = clip(z.prettifyError(parsed.error), RETRY_ERROR_CHARS);
      } catch (error) {
        problem = clip(
          error instanceof Error ? error.message : String(error),
          RETRY_ERROR_CHARS,
        );
      }
      this.logger.warn(
        `Feedback learner attempt ${attempt} unusable: ${problem.split('\n')[0]}`,
      );
    }
    this.logger.warn(
      "Feedback learner skipped: falling back to the reviewer's note verbatim",
    );
    return undefined;
  }
}

function clip(text: string, chars: number): string {
  return text.length > chars ? `${text.slice(0, chars - 1)}…` : text;
}

/** Drop `null`s so optional schema fields accept a model's explicit nulls. */
function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((v) => v !== null).map(withoutNulls);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, withoutNulls(v)]),
    );
  }
  return value;
}

/** Parse a model's JSON reply, tolerating a markdown fence around it —
 * duplicated (not imported) so this module stays usable without pulling in
 * `ExpertModeService`; same reasoning as the identical helper in
 * `knowledge.service.ts`. */
function parseJsonObject(text: string | undefined): unknown {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(
      trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
    );
  } catch {
    return undefined;
  }
}
