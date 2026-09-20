import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { VerifiedQueriesRepository } from './repositories/verified-queries.repository';
import type { VerifiedQueryDoc } from './entities/verified-query.entity';

/** Pairs injected per turn, and the character budget that block may take. */
const MAX_REFERENCE_PAIRS = 3;
const REFERENCE_BLOCK_CHARS = 3_000;

/** Words that carry no schema signal when comparing two questions. */
const STOPWORDS = new Set([
  'a',
  'all',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'get',
  'give',
  'has',
  'have',
  'how',
  'i',
  'in',
  'is',
  'it',
  'many',
  'me',
  'much',
  'my',
  'of',
  'on',
  'or',
  'our',
  'per',
  'show',
  'some',
  'that',
  'the',
  'their',
  'them',
  'there',
  'these',
  'they',
  'this',
  'to',
  'us',
  'was',
  'we',
  'were',
  'what',
  'when',
  'which',
  'who',
  'why',
  'with',
  'you',
  'your',
]);

export interface VerifiedQueryInput {
  question: string;
  sql: string;
  datasourceId?: string;
  entities?: string[];
  sourceSessionId: string;
  sourceMessageAt: string;
}

/**
 * Vanna-style verified query library. Lexical retrieval is enough at demo
 * scale — no embedding infrastructure, no background indexing.
 */
@Injectable()
export class VerifiedQueriesService {
  constructor(private readonly repository: VerifiedQueriesRepository) {}

  list(): Promise<VerifiedQueryDoc[]> {
    return this.repository.list();
  }

  /** Record (or refresh) the approved pair for one assistant answer. */
  save(input: VerifiedQueryInput): Promise<VerifiedQueryDoc> {
    return this.repository.save({
      id: randomUUID(),
      question: input.question.trim(),
      sql: input.sql.trim(),
      ...(input.datasourceId ? { datasourceId: input.datasourceId } : {}),
      entities: input.entities ?? [],
      sourceSessionId: input.sourceSessionId,
      sourceMessageAt: input.sourceMessageAt,
    });
  }

  /** Drop the pair for an answer — used when the user flips to thumbs-down. */
  removeForMessage(sessionId: string, messageAt: string): Promise<number> {
    return this.repository.deleteForMessage(sessionId, messageAt);
  }

  /**
   * Does this statement match a stored, user-approved query? Exact match on
   * the normalized text — a paraphrase is not a verified query. A stored pair
   * with no datasource recorded matches anywhere (provenance was ambiguous
   * when it was saved), otherwise the datasources must agree.
   */
  async isVerifiedSql(sql: string, datasourceId?: string): Promise<boolean> {
    const target = normalizeSql(sql);
    if (!target) return false;
    const all = await this.repository.list();
    return all.some(
      (doc) =>
        normalizeSql(doc.sql) === target &&
        (!datasourceId ||
          !doc.datasourceId ||
          doc.datasourceId === datasourceId),
    );
  }

  /** Top-k stored pairs whose question shares vocabulary with this one. */
  async findSimilar(
    question: string,
    k = MAX_REFERENCE_PAIRS,
  ): Promise<VerifiedQueryDoc[]> {
    const target = tokenize(question);
    if (target.size === 0) return [];
    const all = await this.repository.list();
    return all
      .map((doc) => ({
        doc,
        score: similarity(target, tokenize(doc.question)),
      }))
      .filter((scored) => scored.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, k))
      .map((scored) => scored.doc);
  }

  /**
   * The system block appended to the analysis prompt, or undefined when
   * nothing stored resembles the question.
   */
  async referenceBlock(question: string): Promise<string | undefined> {
    const similar = await this.findSimilar(question, MAX_REFERENCE_PAIRS);
    if (!similar.length) return undefined;
    const lines = [
      'Verified reference queries (user-approved earlier — reuse their tables, joins and filters when the question is similar):',
    ];
    let budget = REFERENCE_BLOCK_CHARS;
    for (const pair of similar) {
      const entry = `Q: ${pair.question}\nSQL: ${pair.sql}`;
      if (entry.length > budget) break;
      budget -= entry.length;
      lines.push(entry);
    }
    return lines.length > 1 ? lines.join('\n') : undefined;
  }
}

/**
 * Canonical form used to compare two statements: lowercase, whitespace
 * collapsed to single spaces, trailing semicolons dropped. The one place
 * SQL equality is defined.
 */
export function normalizeSql(sql: string): string {
  return (sql ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/;+$/, '')
    .trim()
    .toLowerCase();
}

/** Lowercase, split on non-word characters, drop stopwords and 1-char noise. */
function tokenize(text: string): Set<string> {
  return new Set(
    (text ?? '')
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((token) => token.length > 1 && !STOPWORDS.has(token)),
  );
}

/** Jaccard overlap of two token sets. */
function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared === 0 ? 0 : shared / (a.size + b.size - shared);
}
