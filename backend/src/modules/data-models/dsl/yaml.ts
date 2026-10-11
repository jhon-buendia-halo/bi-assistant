/**
 * The DSL's on-disk/on-screen form: our own YAML, not a generic "dump the
 * JSON" serialization. Parsing and serializing both go through here so a
 * model saved by `serializeDataModel` and reloaded by `parseDataModelYaml`
 * is the same value (the round trip the spec tests), and so every
 * validation issue — syntax, structural, semantic, or snapshot-drift —
 * ends up with a `line`/`col` an editor can jump to, not just a JSON path.
 */
import { Document, LineCounter, parseDocument, visit, isSeq } from 'yaml';
import type {
  Attribute,
  Binding,
  DataModel,
  Entity,
  Metric,
  ModelIssue,
  Predicate,
  Relationship,
} from '../entities/data-model.entity';
import { parsePath, validateDataModel } from '../schema/data-model.schema';

type ParseResult = { model: DataModel; issues: [] } | { issues: ModelIssue[] };

/**
 * Parses, structurally + semantically validates, and locates every issue
 * against the source text in one pass. A YAML syntax error short-circuits
 * before validation even runs — there is no parsed value to validate.
 */
export function parseDataModelYaml(text: string): ParseResult {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false });

  if (doc.errors.length) {
    return {
      issues: doc.errors.map((error) => {
        // `prettyErrors: false` (used so `error.message` is the clean,
        // one-line reason rather than a message with a source snippet
        // baked in) also suppresses `error.linePos` — computed here
        // instead, from the raw offset the parser always provides.
        const pos = lineCounter.linePos(error.pos[0]);
        return {
          path: '',
          message: error.message,
          line: pos.line,
          col: pos.col,
        };
      }),
    };
  }

  const value = (doc.toJS() ?? {}) as unknown;
  const result = validateDataModel(value);
  if (result.model) return { model: result.model, issues: [] };
  return { issues: locateAll(doc, lineCounter, result.issues) };
}

/**
 * Positions issues that were produced *after* a successful parse (snapshot
 * drift, from `validateAgainstSnapshot`) against the same source text —
 * the service holds the YAML already, so re-parsing here is cheap and
 * keeps the line/col logic in one place instead of duplicated per caller.
 * Falls back to leaving the issues untouched if the text itself does not
 * parse (it should not, since the caller got this far only because it
 * already parsed once).
 */
export function attachPositions(
  text: string,
  issues: ModelIssue[],
): ModelIssue[] {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false });
  if (doc.errors.length) return issues;
  return locateAll(doc, lineCounter, issues);
}

function locateAll(
  doc: Document,
  lineCounter: LineCounter,
  issues: ModelIssue[],
): ModelIssue[] {
  return issues.map((issue) => locateIssue(doc, lineCounter, issue));
}

/** A YAML node's `range` is `[start, valueEnd, end]` source offsets. */
function rangeStartOf(node: unknown): number | null {
  if (!node || typeof node !== 'object' || !('range' in node)) return null;
  const range = (node as { range?: unknown }).range;
  return Array.isArray(range) && typeof range[0] === 'number' ? range[0] : null;
}

/**
 * Walks the issue's path from the full node up to the document root,
 * stopping at the first ancestor that actually exists in the source — a
 * "needs X" issue about a missing key has nothing at the full path to
 * point at, so it points at the object that is missing the key instead.
 */
function locateIssue(
  doc: Document,
  lineCounter: LineCounter,
  issue: ModelIssue,
): ModelIssue {
  const segments = parsePath(issue.path);
  for (let len = segments.length; len >= 0; len -= 1) {
    const node =
      len === 0 ? doc.contents : doc.getIn(segments.slice(0, len), true);
    const start = rangeStartOf(node);
    if (start === null) continue;
    const pos = lineCounter.linePos(start);
    return { ...issue, line: pos.line, col: pos.col };
  }
  return issue;
}

/** Keeps only defined values, in the given key order — our stable YAML shape. */
function pick<T extends object>(obj: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function orderAttribute(attribute: Attribute) {
  return pick(attribute, [
    'name',
    'type',
    'role',
    'nullable',
    'description',
    'samples',
  ]);
}

function orderBinding(binding: Binding) {
  switch (binding.kind) {
    case 'sql':
      return pick(binding, ['kind', 'datasource', 'table', 'columns']);
    case 'rest':
      return pick(binding, [
        'kind',
        'datasource',
        'endpoint',
        'recordPath',
        'columns',
      ]);
    case 'mongo':
      return pick(binding, ['kind', 'datasource', 'collection']);
    case 'file':
      return pick(binding, [
        'kind',
        'datasource',
        'path',
        'format',
        'recordPath',
      ]);
  }
}

function orderEntity(entity: Entity) {
  return pick(
    {
      ...entity,
      bindings: entity.bindings.map(orderBinding),
      attributes: entity.attributes.map(orderAttribute),
    },
    ['name', 'label', 'description', 'key', 'bindings', 'attributes'],
  );
}

function orderRelationship(relationship: Relationship) {
  return pick(relationship, [
    'name',
    'from',
    'to',
    'cardinality',
    'source',
    'description',
  ]);
}

function orderPredicate(predicate: Predicate): Predicate {
  if ('and' in predicate) {
    return { and: predicate.and.map(orderPredicate) };
  }
  if ('or' in predicate) {
    return { or: predicate.or.map(orderPredicate) };
  }
  if ('not' in predicate) {
    return { not: orderPredicate(predicate.not) };
  }
  return pick(predicate, ['attr', 'op', 'value']) as Predicate;
}

function orderMetric(metric: Metric) {
  return pick(
    {
      ...metric,
      where: metric.where ? orderPredicate(metric.where) : undefined,
    },
    [
      'name',
      'label',
      'description',
      'entity',
      'agg',
      'of',
      'numerator',
      'denominator',
      'where',
      'dimensions',
      'expressions',
      'sourceVerifiedQueryId',
    ],
  );
}

function orderModel(model: DataModel) {
  return pick(
    {
      ...model,
      entities: model.entities.map(orderEntity),
      relationships: model.relationships.map(orderRelationship),
      metrics: model.metrics.map(orderMetric),
    },
    ['model', 'version', 'description', 'entities', 'relationships', 'metrics'],
  );
}

/** Sequence keys short enough to read better as `[a, b]` than one-per-line. */
const FLOW_SEQUENCE_KEYS = new Set(['samples', 'key']);

/**
 * Stable, readable YAML: keys in the order declared on the TypeScript
 * interfaces (not alphabetical, not insertion order of whatever produced
 * the `DataModel`), `undefined` fields omitted entirely rather than
 * written as `null`, no anchors (every sub-object here is freshly built,
 * so none would be needed even if the library's duplicate-object aliasing
 * were left on — it is turned off anyway so a future shared-reference bug
 * upstream cannot introduce one).
 */
export function serializeDataModel(model: DataModel): string {
  const ordered = orderModel(model);
  const doc = new Document(ordered, { aliasDuplicateObjects: false });

  visit(doc, {
    Pair(_key, pair) {
      const keyValue = (pair.key as { value?: unknown } | null)?.value;
      if (
        typeof keyValue === 'string' &&
        FLOW_SEQUENCE_KEYS.has(keyValue) &&
        isSeq(pair.value)
      ) {
        pair.value.flow = true;
      }
    },
  });

  return doc.toString();
}
