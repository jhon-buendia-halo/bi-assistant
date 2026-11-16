import { ToolDataRecord } from '../../sessions/models/session.model';
import { StepStory } from '../models/workflow.model';

/**
 * Step stories in the node dialog (ui.md 4.4b, *Story*): a query fact's
 * place among the answer's queries, so it opens in the query inspector, and
 * the story as Markdown, for Copy. Pure.
 */

/** A statement with its whitespace collapsed and no final semicolon. */
function normalized(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().replace(/;\s*$/, '');
}

/**
 * The index in the answer's `data` of the SQL record that ran `sql` (its
 * last run when it ran more than once); null when the answer has none. A
 * statement kept clipped matches a record it starts.
 */
export function answerQueryIndex(
  data: readonly ToolDataRecord[] | null | undefined,
  sql: string,
): number | null {
  const wanted = normalized(sql);
  if (!wanted || !data?.length) return null;
  // Only a statement long enough to have been clipped matches by its start.
  const clipped = wanted.length >= CLIPPED_AT;
  for (let i = data.length - 1; i >= 0; i--) {
    const record = data[i];
    if (!record.tool.endsWith('run_readonly_sql') || !record.input) continue;
    const ran = normalized(record.input);
    if (ran === wanted || (clipped && ran.startsWith(wanted))) return i;
  }
  return null;
}

/** A tool call keeps at most 2 000 characters of its input (api.md 3.6). */
const CLIPPED_AT = 1900;

/** The story as Markdown: the title, the headline, the facts and what came next. */
export function storyMarkdown(title: string, story: StepStory): string {
  const lines = [`## ${title}`, '', story.headline];
  if (story.facts?.length) {
    lines.push('');
    for (const fact of story.facts) {
      const mark =
        fact.verdict === 'passed'
          ? '✓ '
          : fact.verdict === 'failed'
            ? '✗ '
            : '';
      const values = fact.code
        ? fact.values.map((v) => `\`${v}\``).join(', ')
        : fact.values.join('; ');
      lines.push(`- ${mark}**${fact.label}:** ${values}`);
    }
  }
  if (story.next) lines.push('', story.next);
  return lines.join('\n');
}
