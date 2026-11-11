// Column classification (plan 2.2). Pure: the first rule that matches wins.

import type { FormatRule, SemanticType } from '../../data-readiness/engine/types';
import type { ColumnKind, SynthesisStrategy } from '../types';

export interface ClassifyInput {
  name: string;
  /** Declared type, as the platform reports it. */
  type: string;
  semanticType: SemanticType;
  nullable: boolean;
  /** Non-null sampled values. */
  nonNull: number;
  distinct: number;
  /** In the primary key or a unique key. */
  inKey: boolean;
  /** Child end of a declared or inferred relationship. */
  isForeignKey: boolean;
  /** That relationship's parent is in the profile (and, if inferred, is a key there). */
  foreignKeyUsable: boolean;
  /** Name-detected format rule, already checked against the sample. */
  formatRule?: FormatRule;
  /** Distinct values seen at least 3 times, at most 20. */
  frequentValues: number;
  /** At least one non-null value parsed as its semantic type (numeric, temporal, boolean). */
  parsed: boolean;
}

export interface Classification {
  kind: ColumnKind;
  strategy: SynthesisStrategy;
  note?: string;
}

const ID_NAME = /(^id$|_id$|^uuid$|_uuid$|guid)/i;
const INTEGER_TYPE = /^(tiny|small|big)?int(eger)?[248]?$/i;

export const CATEGORICAL_MAX_DISTINCT = 20;
export const CATEGORICAL_MIN_COUNT = 3;
export const LONG_TEXT_MEAN_LENGTH = 40;

export const isIntegerType = (type: string): boolean => INTEGER_TYPE.test(type.trim());

function untouched(nullable: boolean, kind: ColumnKind, note: string): Classification {
  return { kind, strategy: nullable ? 'null-only' : 'constant', note };
}

/**
 * `meanLength` is only read for text columns that are neither categorical nor
 * formatted; pass the sample mean (0 when nothing was sampled).
 */
export function classifyColumn(c: ClassifyInput, meanLength: number): Classification {
  const type = c.type.toLowerCase().trim();

  // 1. unsupported
  if (c.semanticType === 'json' || c.semanticType === 'other' || type.startsWith('interval')) {
    return untouched(c.nullable, 'unsupported', unsupportedNote(c.nullable));
  }

  // 2. identifier. The sample distinct-ratio rule is limited to text, uuid and integer
  // columns, and never fires for a column with a (non-uuid) format rule: a unique email stays
  // formatted, and a decimal measure or a timestamp unique in 1,000 rows is not a key.
  const ratioRule =
    c.nonNull >= 50 &&
    (!c.formatRule || c.formatRule === 'uuid') &&
    c.distinct / c.nonNull >= 0.95 &&
    (c.semanticType === 'text' || c.semanticType === 'uuid' || isIntegerType(type));
  if (
    c.inKey ||
    c.isForeignKey ||
    c.semanticType === 'uuid' ||
    ID_NAME.test(c.name) ||
    ratioRule
  ) {
    let strategy: SynthesisStrategy;
    if (c.isForeignKey && c.foreignKeyUsable) strategy = 'foreign-key';
    else if (isIntegerType(type)) strategy = 'sequence';
    else if (c.semanticType === 'uuid' || c.formatRule === 'uuid') strategy = 'uuid';
    else strategy = 'unique-pattern';
    return { kind: 'identifier', strategy };
  }

  // 3-5. boolean, numeric, temporal
  const typed: [SemanticType, ColumnKind, SynthesisStrategy][] = [
    ['boolean', 'boolean', 'boolean-rate'],
    ['numeric', 'numeric', 'numeric-range'],
    ['temporal', 'temporal', 'temporal-range'],
  ];
  for (const [semantic, kind, strategy] of typed) {
    if (c.semanticType !== semantic) continue;
    if (c.nonNull === 0) return untouched(c.nullable, kind, emptyNote(c.nullable));
    if (!c.parsed) {
      return untouched(c.nullable, 'unsupported', unsupportedNote(c.nullable));
    }
    return { kind, strategy };
  }

  // Remaining semantic type is text.
  if (c.nonNull === 0) return untouched(c.nullable, 'text', emptyNote(c.nullable));

  // 6. formatted
  if (c.formatRule) return { kind: 'formatted', strategy: 'format-template' };

  // 7. categorical
  if (
    c.frequentValues >= 1 &&
    c.distinct >= 1 &&
    c.distinct <= CATEGORICAL_MAX_DISTINCT &&
    c.distinct <= Math.max(CATEGORICAL_MAX_DISTINCT, 0.1 * c.nonNull)
  ) {
    return { kind: 'categorical', strategy: 'categorical' };
  }

  // 8. text
  return { kind: 'text', strategy: meanLength > LONG_TEXT_MEAN_LENGTH ? 'words' : 'pattern' };
}

function unsupportedNote(nullable: boolean): string {
  return nullable
    ? 'Type not synthesized: generated as NULL'
    : 'Type not synthesized: generated as a neutral value';
}

function emptyNote(nullable: boolean): string {
  return nullable
    ? 'No sampled values: generated as NULL'
    : 'No sampled values: generated as a neutral value';
}
