// Pure, DI-free relevance ranking for L2 (`rankedKnowledge`) — scores
// knowledge snippets and governed metrics against a question and the
// entities named in it, so `KnowledgeService.contextFor` and
// `MetricsService.definitionBlock` can fill their budgets best-first instead
// of newest-first. No Nest DI, same pattern as `context-blocks.ts` and
// `tool-services.ts`.

/** Common English stopwords dropped before scoring token overlap. */
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'in',
  'on',
  'at',
  'by',
  'for',
  'to',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'and',
  'or',
  'but',
  'if',
  'then',
  'else',
  'when',
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'why',
  'how',
  'this',
  'that',
  'these',
  'those',
  'with',
  'as',
  'from',
  'into',
  'about',
  'above',
  'below',
  'between',
  'through',
  'during',
  'before',
  'after',
  'over',
  'under',
  'again',
  'further',
  'once',
  'here',
  'there',
  'all',
  'any',
  'both',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'can',
  'could',
  'should',
  'would',
  'will',
  'just',
  'do',
  'does',
  'did',
  'doing',
  'have',
  'has',
  'had',
  'having',
  'i',
  'you',
  'he',
  'she',
  'it',
  'we',
  'they',
  'them',
  'their',
  'its',
  'my',
  'your',
  'his',
  'her',
  'our',
  'me',
  'us',
  'am',
  'per',
  'up',
  'down',
  'out',
  'off',
  'also',
  'give',
  'show',
]);

/**
 * Lowercase, split on every run of non-alphanumeric characters (including
 * `_`), drop stopwords, lightly stem plurals. Purely numeric tokens (years,
 * ids) pass through unstemmed and are never treated as stopwords.
 */
export function tokenize(text: string | undefined | null): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map(stem)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token));
}

/** Light plural stemming — numeric tokens are returned unchanged. */
function stem(token: string): string {
  if (/^\d+$/.test(token)) return token;
  if (token.length > 4 && token.endsWith('ies')) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 4 && /(?:s|x|z|ch|sh)es$/.test(token)) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * The last two dot-segments of a fully-qualified entity string
 * (`catalog.schema.table` → `schema.table`) — the same normalisation
 * `suiteDatasetError` (`mastra/evals/suite-loader.ts`) applies before
 * comparing a dataset's table inventory to a suite's required entities, so a
 * knowledge snippet's `entities` line up with a dataset's table keys
 * regardless of whether either side carries a catalog prefix.
 */
export function normalizeEntityKey(entity: string): string {
  const segments = entity.split('.').filter(Boolean);
  return segments.slice(-2).join('.');
}

/** Exact match, or a match on the last two dot-segments of both sides. */
export function entityKeysMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return normalizeEntityKey(a) === normalizeEntityKey(b);
}

/** The question and entity context a snippet/metric is scored against. */
export interface RankQuery {
  /** Pre-tokenized question text. */
  questionTokens: string[];
  /** Entity names mentioned in the question or otherwise in scope, raw (not tokenized). */
  entityNames: string[];
}

/** Minimal shape `scoreSnippet`/`rankSnippets` need — matches `KnowledgeSnippet`. */
export interface RankableSnippet {
  kind: string;
  title: string;
  body: string;
  synonyms?: string[];
  entities?: string[];
  column?: string;
}

/** Higher priors rank ahead on a token-overlap tie; `default_filter` also gets the never-dropped floor below. */
const KIND_PRIOR: Record<string, number> = {
  default_filter: 3,
  instruction: 2,
  term: 1,
};

/** Added when the snippet/metric names an entity the query also names. */
const ENTITY_MATCH_BONUS = 5;

/**
 * A `default_filter` snippet that survived the dataset/global scope filter in
 * `KnowledgeService.contextFor` is already "in scope" for the datasets in
 * play — this floor outweighs any plausible token-overlap + kind-prior score
 * from a `term`/`instruction` snippet, so best-first budget filling picks
 * every in-scope default filter before anything else and effectively never
 * drops one.
 */
const DEFAULT_FILTER_FLOOR = 1_000;

/** Per-match weight for token overlap between the query and the snippet/metric text. */
const OVERLAP_WEIGHT = 10;

function queryTokenSet(query: RankQuery): Set<string> {
  const entityTokens = query.entityNames.flatMap((name) => tokenize(name));
  return new Set([...query.questionTokens, ...entityTokens]);
}

function overlapScore(text: string, queryTokens: Set<string>): number {
  const textTokens = new Set(tokenize(text));
  let overlap = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) overlap += 1;
  }
  return overlap * OVERLAP_WEIGHT;
}

/**
 * Relevance score for a knowledge snippet: token overlap of the question +
 * entity-name tokens against title + body + synonyms + entities (+ column),
 * plus a kind prior, plus an entity-match bonus, plus the `default_filter`
 * floor. Higher is more relevant.
 */
export function scoreSnippet(
  snippet: RankableSnippet,
  query: RankQuery,
): number {
  const queryTokens = queryTokenSet(query);
  const text = [
    snippet.title,
    snippet.body,
    ...(snippet.synonyms ?? []),
    ...(snippet.entities ?? []),
    snippet.column,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ');

  let score = overlapScore(text, queryTokens);
  score += KIND_PRIOR[snippet.kind] ?? 0;

  const entityMatch = (snippet.entities ?? []).some((entity) =>
    query.entityNames.some((name) => entityKeysMatch(entity, name)),
  );
  if (entityMatch) score += ENTITY_MATCH_BONUS;
  if (snippet.kind === 'default_filter') score += DEFAULT_FILTER_FLOOR;

  return score;
}

/**
 * Stable relevance sort: highest `scoreSnippet` first, ties broken by the
 * snippets' original order in `snippets` (today's order — dataset-scoped
 * before global, newest-first within each group — is what callers pass in).
 */
export function rankSnippets<T extends RankableSnippet>(
  snippets: T[],
  query: RankQuery,
): T[] {
  return snippets
    .map((snippet, index) => ({
      snippet,
      index,
      score: scoreSnippet(snippet, query),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.snippet);
}

/** Minimal shape `scoreMetric`/`rankMetrics` need — matches `MetricDoc`. */
export interface RankableMetric {
  name: string;
  label: string;
  description?: string;
  expression: string;
  entity: string;
}

/**
 * Relevance score for a governed metric: token overlap of the question +
 * entity-name tokens against name + label + description + expression, plus
 * an entity-match bonus. Higher is more relevant.
 */
export function scoreMetric(metric: RankableMetric, query: RankQuery): number {
  const queryTokens = queryTokenSet(query);
  const text = [
    metric.name,
    metric.label,
    metric.description,
    metric.expression,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' ');

  let score = overlapScore(text, queryTokens);
  if (query.entityNames.some((name) => entityKeysMatch(metric.entity, name))) {
    score += ENTITY_MATCH_BONUS;
  }
  return score;
}

/** Stable relevance sort for metrics — same tie-break rule as `rankSnippets`. */
export function rankMetrics<T extends RankableMetric>(
  metrics: T[],
  query: RankQuery,
): T[] {
  return metrics
    .map((metric, index) => ({
      metric,
      index,
      score: scoreMetric(metric, query),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.metric);
}
