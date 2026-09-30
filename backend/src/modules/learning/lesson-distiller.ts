/**
 * Pure helpers for `LearningService`: the prompt handed to the
 * `feedback-learner` agent, and the deterministic post-processing that turns
 * its raw output (or, on failure, the reviewer's own words) into snippets
 * ready to persist. Nothing here calls the model, the database or a clock —
 * every function is total and side-effect free, so it is tested directly
 * without stubbing anything.
 */
import { schemaSection } from '../expert-mode/expert-mode.service';
import { analyzeSql } from '../expert-mode/sql-grounding';
import type { DatasetEntitySnapshot } from '../datasets/repositories/datasets.repository';
import type {
  BlockVote,
  ReasoningBlock,
  ReasoningBlockKind,
} from '../expert-mode/entities/reasoning-trace.entity';
import type { KnowledgeSnippetKind } from '../knowledge/entities/knowledge-snippet.entity';
import type { FeedbackLearnerOutput } from '../../mastra/agents/feedback-learner.agent';

/** The subset of `LearnInput` the prompt is built from. */
export interface LearnPromptInput {
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

/** A lesson once sanitised: valid, clamped, de-duplicated — ready to persist. */
export interface SanitisedLesson {
  kind: KnowledgeSnippetKind;
  title: string;
  body: string;
  synonyms: string[];
  entities: string[];
}

const ANSWER_CHARS = 2_000;
const TITLE_CHARS = 80;
const BODY_CHARS = 500;

const BLOCK_TITLES: Record<ReasoningBlockKind, string> = {
  interpretation: 'Interpretation',
  'data-selection': 'Data selection',
  assumptions: 'Assumptions',
  metric: 'Metric',
  sql: 'SQL',
};

/** A human label for a reasoning block kind, for the verbatim fallback's title. */
export function blockTitle(kind: ReasoningBlockKind): string {
  return BLOCK_TITLES[kind] ?? kind;
}

/**
 * The per-call prompt for the `feedback-learner` agent: the dataset(s) in
 * scope, the schema (entities the final SQL reads get full columns, the
 * rest names only), the question and answer, the rated block as JSON, the
 * final SQL, the knowledge titles already on file, and the reviewer's note.
 */
export function buildLearnPrompt(input: LearnPromptInput): string {
  const grounding = input.finalSql
    ? analyzeSql(input.finalSql, input.entities ?? [])
    : undefined;
  const schema = schemaSection(input.entities ?? [], grounding?.entities ?? []);
  return [
    '<dataset>',
    input.datasets.join(', ') || '(none)',
    '</dataset>',
    '',
    '<schema>',
    schema || '(no schema snapshot stored for this session)',
    '</schema>',
    '',
    '<question>',
    input.question,
    '</question>',
    '',
    '<answer>',
    clip(input.answer, ANSWER_CHARS),
    '</answer>',
    '',
    `<rated-block kind="${input.block}" vote="${input.vote ?? 'none'}">`,
    JSON.stringify(input.blockSnapshot),
    '</rated-block>',
    '',
    '<final-sql>',
    input.finalSql?.trim() || '(no final SQL ran)',
    '</final-sql>',
    '',
    '<existing-knowledge-titles>',
    input.existingTitles.join(', ') || '(none)',
    '</existing-knowledge-titles>',
    '',
    '<reviewer-note>',
    input.comment.trim(),
    '</reviewer-note>',
  ].join('\n');
}

/**
 * The agent's raw lessons, made safe to persist: an entity not among the
 * schema's own keys is dropped (the model cannot invent a table), an
 * `appliesWhen` is folded into the body as "Applies when: …", a title is
 * de-duplicated (first occurrence wins — the loader rejects a second write
 * under the same title anyway), and title/body are clamped to the stored
 * field's own limits once folding is done.
 */
export function sanitiseLessons(
  raw: FeedbackLearnerOutput['lessons'] | undefined,
  entityKeys: string[],
): SanitisedLesson[] {
  const seenTitles = new Set<string>();
  const lessons: SanitisedLesson[] = [];
  for (const draft of raw ?? []) {
    const title = clip((draft.title ?? '').trim(), TITLE_CHARS);
    if (!title || seenTitles.has(title.toLowerCase())) continue;

    const appliesWhen = draft.appliesWhen?.trim();
    const body = clip(
      [(draft.body ?? '').trim(), appliesWhen ? `Applies when: ${appliesWhen}` : '']
        .filter(Boolean)
        .join('\n\n'),
      BODY_CHARS,
    );
    if (!body) continue;

    seenTitles.add(title.toLowerCase());
    lessons.push({
      kind: draft.kind,
      title,
      body,
      synonyms: (draft.synonyms ?? []).map((s) => s.trim()).filter(Boolean),
      entities: (draft.entities ?? []).filter((e) => entityKeys.includes(e)),
    });
  }
  return lessons;
}

/**
 * The deterministic fallback when the agent could not be used: one
 * `instruction` titled after the rated block, whose body is the reviewer's
 * note verbatim. Always has something to persist — a comment that reached
 * here is, by definition, non-empty.
 */
export function verbatimFallback(
  block: ReasoningBlockKind,
  comment: string,
): SanitisedLesson {
  return {
    kind: 'instruction',
    title: clip(`Reviewer note: ${blockTitle(block)}`, TITLE_CHARS),
    body: clip(comment.trim(), BODY_CHARS),
    synonyms: [],
    entities: [],
  };
}

function clip(text: string, chars: number): string {
  return text.length > chars ? `${text.slice(0, chars - 1)}…` : text;
}
