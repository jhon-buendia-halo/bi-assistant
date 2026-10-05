import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readEngineOptions } from '../../modules/engine/engine-options';
import {
  closestNames,
  editDistance,
} from '../../modules/sessions/sql-precheck';
import {
  getDatasetToolServices,
  type DatasetColumnSnapshot,
} from '../tool-services';
import {
  allowedEntities,
  datasetNames,
  RATIONALE_DESCRIPTION,
  resolveEntity,
  sessionDatasets,
  type EntityAccess,
} from './dataset.tools';

/**
 * L2 `lookupTools`: pull, not only push. The context blocks push curated
 * knowledge and sample values at the model up front; these two let it ask
 * for exactly the value or definition it is about to rely on:
 *
 * - `lookup_values` is Omni's field-values tool (engineering plan §9.7):
 *   "New Yrok" → `New York`, "paid" → `PAID`, *before* the query runs — so
 *   the `value-vocabulary` failure and its empty result never happen.
 * - `lookup_knowledge` fetches a definition, a default filter or a governed
 *   metric expression on demand.
 *
 * Both are registered on the assistant permanently; whether a turn may call
 * them is decided per call (`activeTools`, SessionsService), so the default
 * engine never offers them. Tool ids must stay equal to `LOOKUP_TOOL_NAMES`.
 */

/** Below this a candidate is a different word, not a misspelling. */
export const MATCH_THRESHOLD = 0.65;
const DEFAULT_LIMIT = 10;
/** Values shown when nothing matched — the profile keeps at most 25. */
const LISTED_VALUES = 25;
/** How many values the live lookup may return per call. */
const LIVE_LIMIT = 25;

/** Lower-case, accents stripped, punctuation to spaces: "São-Paulo" → "sao paulo". */
export function normalizeForMatch(text: string): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function trigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (const word of text.split(' ')) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1)
      grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

/**
 * How well a stored value matches what the user typed, 0..1. Edit distance
 * (a swapped pair is one typo) catches "yrok"; trigrams catch longer
 * misspellings; containment catches "york" → "New York"; the per-word pass
 * catches one misspelt word in a multi-word value.
 */
export function valueSimilarity(phrase: string, value: string): number {
  const a = normalizeForMatch(phrase);
  const b = normalizeForMatch(value);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  let score = 1 - editDistance(a, b) / longest;
  const ga = trigrams(a);
  const gb = trigrams(b);
  const shared = [...ga].filter((gram) => gb.has(gram)).length;
  score = Math.max(score, shared / (ga.size + gb.size - shared));
  if (Math.min(a.length, b.length) >= 3 && (b.includes(a) || a.includes(b))) {
    score = Math.max(
      score,
      0.7 + 0.25 * (Math.min(a.length, b.length) / longest),
    );
  }
  const wordsA = a.split(' ');
  const wordsB = b.split(' ');
  if (wordsA.length > 1 || wordsB.length > 1) {
    const perWord = wordsA.map((word) =>
      Math.max(
        ...wordsB.map(
          (other) =>
            1 - editDistance(word, other) / Math.max(word.length, other.length),
        ),
      ),
    );
    const coverage =
      Math.min(wordsA.length, wordsB.length) /
      Math.max(wordsA.length, wordsB.length);
    const mean = perWord.reduce((sum, x) => sum + x, 0) / perWord.length;
    score = Math.max(score, mean * (0.75 + 0.25 * coverage));
  }
  return Math.min(1, score);
}

export interface ValueMatch {
  value: string;
  count?: number;
  score: number;
}

/** Candidates at or above `MATCH_THRESHOLD`, best first (then most frequent). */
export function rankValues(
  phrase: string,
  candidates: { value: string; count?: number }[],
  limit = DEFAULT_LIMIT,
): ValueMatch[] {
  const seen = new Set<string>();
  const ranked: ValueMatch[] = [];
  for (const candidate of candidates) {
    const value = String(candidate?.value ?? '');
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const score = valueSimilarity(phrase, value);
    if (score < MATCH_THRESHOLD) continue;
    ranked.push({
      value,
      ...(typeof candidate.count === 'number'
        ? { count: candidate.count }
        : {}),
      score: Math.round(score * 100) / 100,
    });
  }
  return ranked
    .sort(
      (x, y) =>
        y.score - x.score ||
        (y.count ?? 0) - (x.count ?? 0) ||
        x.value.localeCompare(y.value),
    )
    .slice(0, limit);
}

/**
 * The values the stored snapshot knows for a column. `complete` when the
 * profile's `topValues` cover every distinct value (≤ 25) — then a live
 * lookup cannot find anything the profile does not already have.
 */
function storedValues(column: DatasetColumnSnapshot | undefined): {
  values: { value: string; count?: number }[];
  complete: boolean;
} {
  const top = column?.profile?.topValues;
  if (top?.length) {
    return {
      values: top.map((entry) => ({
        value: String(entry.value),
        count: entry.count,
      })),
      complete: (column?.profile?.distinctCount ?? Infinity) <= top.length,
    };
  }
  return {
    values: (column?.sampleValues ?? []).map((value) => ({
      value: String(value),
    })),
    complete: false,
  };
}

/**
 * The model is told to use fully-qualified names, but on Postgres it may
 * write `schema.table` — accept a suffix when it names exactly one entity.
 * Anything outside the session's datasets is still refused.
 */
function resolveLookupEntity(
  entities: EntityAccess[],
  entity: string,
  datasourceId?: string,
): EntityAccess | { error: string } {
  const exact = resolveEntity(entities, entity, datasourceId);
  if (!('error' in exact)) return exact;
  const wanted = (entity ?? '').toLowerCase();
  const bySuffix = entities.filter(
    (access) =>
      (!datasourceId || access.datasourceId === datasourceId) &&
      access.entity.toLowerCase().endsWith(`.${wanted}`),
  );
  const keys = new Set(bySuffix.map((access) => access.entity));
  if (keys.size === 1)
    return resolveEntity(entities, bySuffix[0].entity, datasourceId);
  return exact;
}

export const lookupValuesTool = createTool({
  id: 'lookup_values',
  description: [
    'Find the exact stored values of one column that match a word or phrase from the',
    'question — typos, casing and accents are fine ("new yrok" finds "New York", "paid"',
    'finds "PAID"). Call it before you filter on a text value you have not seen in the',
    'data, and after a query returns 0 rows because of a value filter. Put the exact value',
    'it returns in your filter. It matches spelling, not meaning: for business terms',
    '("approved", "active member") call lookup_knowledge.',
  ].join(' '),
  inputSchema: z.object({
    entity: z.string().describe('Fully-qualified catalog.schema.table'),
    column: z.string().describe('The column whose stored values to search'),
    phrase: z.string().describe('The word or phrase as the user wrote it'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Max candidates (default 10)'),
    datasourceId: z.string().optional().describe('Datasource containing it'),
    rationale: z.string().optional().describe(RATIONALE_DESCRIPTION),
  }),
  execute: async (
    { entity, column, phrase, limit, datasourceId },
    { requestContext },
  ) => {
    const entities = allowedEntities(await sessionDatasets(requestContext));
    const access = resolveLookupEntity(entities, entity, datasourceId);
    if ('error' in access) return { error: access.error };
    const columns = access.columns ?? [];
    const stored = columns.find(
      (candidate) =>
        candidate.name.toLowerCase() === (column ?? '').toLowerCase(),
    );
    if (!stored && columns.length) {
      return {
        error: `Column "${column}" is not on ${access.entity} — closest: ${closestNames(
          column,
          columns.map((candidate) => candidate.name),
        ).join(', ')}`,
      };
    }
    const columnName = stored?.name ?? column;
    const max = limit ?? DEFAULT_LIMIT;
    const known = storedValues(stored);
    let pool = known.values;
    let source: 'profile' | 'live' = 'profile';
    // Called through the bridge object, never detached (unbound-method).
    const bridge = getDatasetToolServices();
    // Sample values are five rows' worth and a high-cardinality profile keeps
    // only its most common values: ask the datasource for the rest.
    if (!known.complete && bridge.lookupValues && access.datasourceId) {
      try {
        const live = await bridge.lookupValues(
          access.datasourceId,
          access.entity,
          columnName,
          phrase,
          Math.max(max, LIVE_LIMIT),
        );
        if (Array.isArray(live) && live.length) {
          pool = live.map((entry) => ({
            value: String(entry.value),
            ...(typeof entry.count === 'number' ? { count: entry.count } : {}),
          }));
          source = 'live';
        }
      } catch {
        // The stored values are still worth ranking.
      }
    }
    const matches = rankValues(phrase, pool, max);
    return {
      entity: access.entity,
      column: columnName,
      matches,
      source,
      note: matches.length
        ? 'Use the exact value in your filter — stored values are case-sensitive.'
        : noMatchNote(
            columnName,
            phrase,
            pool,
            known.complete && source === 'profile',
          ),
    };
  },
});

function noMatchNote(
  column: string,
  phrase: string,
  pool: { value: string }[],
  complete: boolean,
): string {
  if (!pool.length) {
    return `No stored values are known for ${column} — inspect it with sample_rows or a SELECT DISTINCT before filtering on it.`;
  }
  const listed = pool
    .slice(0, LISTED_VALUES)
    .map((entry) => entry.value)
    .join(', ');
  return [
    `No stored value of ${column} resembles "${phrase}".`,
    `${complete ? 'It holds' : 'Known values include'}: ${listed}.`,
    'If the phrase is a business term, call lookup_knowledge; otherwise say the data holds no such value.',
  ].join(' ');
}

export const lookupKnowledgeTool = createTool({
  id: 'lookup_knowledge',
  description: [
    "Look up the data owner's curated definitions for a business term, a default filter",
    'or a governed metric — what "approved", "active member" or "net paid" means in this',
    'data, and the exact expression or filter to use. Call it when the question uses a',
    'term the schema does not spell out, before you pick columns, values or a formula for',
    'it. Pass entity (and column) to narrow the search. What it returns outranks your own',
    'reading of the columns; when it returns nothing, no definition exists — do not invent one.',
  ].join(' '),
  inputSchema: z.object({
    phrase: z.string().describe('The business term or phrase to define'),
    entity: z
      .string()
      .optional()
      .describe('Fully-qualified catalog.schema.table to narrow to'),
    column: z
      .string()
      .optional()
      .describe('Column of that entity to narrow to'),
    rationale: z.string().optional().describe(RATIONALE_DESCRIPTION),
  }),
  execute: async ({ phrase, entity, column }, { requestContext }) => {
    const engine = readEngineOptions(requestContext);
    let entityKey: string | undefined;
    if (entity) {
      const entities = allowedEntities(await sessionDatasets(requestContext));
      const access = resolveLookupEntity(entities, entity);
      if ('error' in access) return { error: access.error };
      entityKey = access.entity;
    }
    // The `bare` arm measures the schema alone — no curated knowledge by any route.
    if (engine.context === 'bare') {
      return {
        snippets: [],
        metrics: [],
        note: 'Curated knowledge is switched off for this run — work from the schema and the stored values.',
      };
    }
    const bridge = getDatasetToolServices();
    if (!bridge.knowledgeFor) {
      return {
        snippets: [],
        metrics: [],
        note: 'No curated knowledge is available in this session — work from the schema and the stored values.',
      };
    }
    try {
      const found = await bridge.knowledgeFor(datasetNames(requestContext), {
        phrase,
        ...(entityKey ? { entity: entityKey } : {}),
        ...(column ? { column } : {}),
      });
      const snippets = Array.isArray(found?.snippets) ? found.snippets : [];
      const metrics = Array.isArray(found?.metrics) ? found.metrics : [];
      return {
        snippets,
        metrics,
        note:
          snippets.length || metrics.length
            ? 'Curated by the data owner: follow these definitions, filters and metric expressions over your own reading of the columns.'
            : 'No curated definition matches — rely on the schema and the stored values, and do not invent a definition.',
      };
    } catch (err) {
      return {
        error: `Knowledge lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

/** Registered on the assistant; offered per turn only when `lookupTools` is on. */
export const lookupTools = {
  lookup_values: lookupValuesTool,
  lookup_knowledge: lookupKnowledgeTool,
};
