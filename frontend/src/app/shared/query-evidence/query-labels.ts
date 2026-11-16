import { ChatMessage } from '../../features/sessions/models/session.model';
import { QueryEvidence } from './query-evidence.model';

/** The wording of the query rows and the coverage line (plan m1-25 2.5). */

export type CoverageTone = 'success' | 'info' | 'warning' | 'danger';

export interface QueryRow {
  /** Index into the message's `data`. */
  index: number;
  /** `Q1`, `Q2`. */
  label: string;
  /** The rationale, or `Query <n>`. */
  title: string;
  /** Absent for an answer stored before the feature (coverage unknown). */
  coverage?: QueryEvidence['coverage'] | 'failed';
  chipLabel?: string;
  tone?: CoverageTone;
}

export interface CoverageLine {
  /** May be empty while the table sizes are unknown. */
  text: string;
  tone: 'success' | 'warning';
  /** `Inspect the 2 queries` or `Inspect the query`. */
  linkLabel: string;
  /** The first query. */
  linkIndex: number;
}

export function queryLabel(index: number): string {
  return `Q${index + 1}`;
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

function evidenceOf(
  message: ChatMessage,
  index: number,
): QueryEvidence | undefined {
  return message.evidence?.find((e) => e.index === index);
}

/** The total behind a `Top 100 of 1,870` chip: the step before Show, once verified. */
function verifiedTotal(evidence: QueryEvidence): number | null {
  const explanation = evidence.explanation;
  if (explanation?.stageCounts?.status !== 'verified') return null;
  const before = explanation.steps.filter((s) => s.verb !== 'show');
  const last = before[before.length - 1];
  return last?.rows !== undefined ? last.rows : null;
}

export function coverageChip(
  coverage: NonNullable<QueryRow['coverage']>,
  evidence?: QueryEvidence,
): { label: string; tone: CoverageTone } {
  switch (coverage) {
    case 'whole-table':
      return { label: 'Whole table', tone: 'success' };
    case 'top-n': {
      const limit = evidence?.outerLimit;
      const total = evidence ? verifiedTotal(evidence) : null;
      if (limit !== undefined && total !== null) {
        return { label: `Top ${formatCount(limit)} of ${formatCount(total)}`, tone: 'info' };
      }
      return {
        label:
          limit !== undefined
            ? `Top ${formatCount(limit)} after ranking`
            : 'Top results after ranking',
        tone: 'info',
      };
    }
    case 'sample':
      return { label: 'Sample', tone: 'warning' };
    case 'partial':
      return { label: 'Partial result', tone: 'warning' };
    case 'failed':
      return { label: 'Failed', tone: 'danger' };
  }
}

/** One row per data record, in order. */
export function queryRows(message: ChatMessage): QueryRow[] {
  return (message.data ?? []).map((record, index) => {
    const row: QueryRow = {
      index,
      label: queryLabel(index),
      title: record.rationale?.trim() || `Query ${index + 1}`,
    };
    const evidence = evidenceOf(message, index);
    const coverage = record.error ? 'failed' : evidence?.coverage;
    if (coverage) {
      const chip = coverageChip(coverage, evidence);
      row.coverage = coverage;
      row.chipLabel = chip.label;
      row.tone = chip.tone;
    }
    return row;
  });
}

function tableName(entity: string): string {
  return entity.split('.').pop() ?? entity;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The line under the answer; null when the answer has no evidence (stored before the feature). */
export function coverageLine(message: ChatMessage): CoverageLine | null {
  const rows = queryRows(message);
  const evidence = message.evidence;
  if (!rows.length || !evidence?.length) return null;
  if (rows.every((row) => row.coverage === 'failed')) return null;

  const sentences: string[] = [];
  for (const row of rows) {
    const e = evidenceOf(message, row.index);
    if (row.coverage === 'partial') {
      const cap = e?.rowLimit ?? message.data?.[row.index]?.rowCount;
      sentences.push(
        cap !== undefined
          ? `${row.label} was cut at ${formatCount(cap)} rows, so figures from it may be incomplete.`
          : `${row.label} was cut, so figures from it may be incomplete.`,
      );
    } else if (row.coverage === 'sample') {
      sentences.push(
        `${row.label} is a sample of rows, not a ranking: no figure should come from it.`,
      );
    }
  }

  let tone: CoverageLine['tone'] = 'warning';
  if (!sentences.length) {
    tone = 'success';
    const read = new Map<string, number | null>();
    for (const row of rows) {
      if (row.coverage !== 'whole-table' && row.coverage !== 'top-n') continue;
      for (const table of evidenceOf(message, row.index)?.tables ?? []) {
        if (!read.has(table.entity) || read.get(table.entity) === null) {
          read.set(table.entity, table.rows);
        }
      }
    }
    if (read.size) {
      const names = [...read].map(([entity, size]) =>
        size === null ? tableName(entity) : `${tableName(entity)} (${formatCount(size)} rows)`,
      );
      if (read.size === 1) {
        const [[entity, size]] = [...read];
        sentences.push(
          size === null
            ? `The whole ${tableName(entity)} table was read.`
            : `The whole ${tableName(entity)} table was read (${formatCount(size)} rows).`,
        );
      } else {
        sentences.push(`The whole ${joinNames(names)} tables were read.`);
      }
    }
  }

  return {
    text: sentences.join(' '),
    tone,
    linkLabel: rows.length === 1 ? 'Inspect the query' : `Inspect the ${rows.length} queries`,
    linkIndex: rows[0].index,
  };
}
