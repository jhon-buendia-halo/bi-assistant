// Strategy → value source (plan 2.4). `foreign-key` columns are drawn by generate.ts
// from the parents' keys; without a usable relationship they fall back here by type.

import { isIntegerType } from '../../profile/classify-column';
import type { ValueContext, ValueSource } from './context';
import {
  booleanSource,
  categoricalSource,
  numericRangeSource,
  temporalRangeSource,
} from './distributions';
import { patternSource } from './pattern';
import { formatTemplateSource, wordsSource } from './text';
import {
  sequenceSource,
  uniquePatternSource,
  uniqueRangeSource,
  uuidSource,
} from './unique';

export type { ValueContext, ValueSource } from './context';

export function valueSource(ctx: ValueContext): ValueSource {
  const c = ctx.column;
  switch (c.strategy) {
    case 'sequence':
      return sequenceSource();
    case 'unique-range':
      return uniqueRangeSource(ctx);
    case 'uuid':
      return uuidSource(ctx);
    case 'unique-pattern':
      return uniquePatternSource(ctx);
    case 'foreign-key':
      // No relationship to draw from (dropped parent): generated as an identifier.
      if (isIntegerType(c.type)) return sequenceSource();
      if (c.semanticType === 'uuid') return uuidSource(ctx);
      return uniquePatternSource(ctx);
    case 'categorical':
      return categoricalSource(ctx);
    case 'numeric-range':
      return numericRangeSource(ctx);
    case 'temporal-range':
      return temporalRangeSource(ctx);
    case 'boolean-rate':
      return booleanSource(ctx);
    case 'format-template':
      return formatTemplateSource(ctx);
    case 'pattern':
      return patternSource(ctx);
    case 'words':
      return wordsSource(ctx);
    case 'null-only':
      return () => null;
    case 'constant':
      return () => ({ kind: 'neutral' });
  }
}
