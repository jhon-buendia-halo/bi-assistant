// The readiness rubric v1.0 as data (source spec section 3): dimensions,
// weights per use type, the thresholds the engine measures against and what
// the app can never evaluate. Pure data, no I/O.
import type {
  ReadinessDimension,
  ReadinessGate,
  ReadinessRisk,
  ReadinessUseType,
} from './readiness.types';

export const DIMENSIONS: ReadinessDimension[] = [
  'D1',
  'D2',
  'D3',
  'D4',
  'D5',
  'D6',
];

export const GATES: ReadinessGate[] = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'];

export const DIMENSION_NAMES: Record<ReadinessDimension, string> = {
  D1: 'Availability and access',
  D2: 'Quality',
  D3: 'Freshness and reliability',
  D4: 'Semantics and documentation',
  D5: 'Governance and privacy',
  D6: 'AI fitness',
};

export const GATE_NAMES: Record<ReadinessGate, string> = {
  G1: 'Access',
  G2: 'Owner',
  G3: 'Legal basis',
  G4: 'Exposed PII',
  G5: 'Key field',
  G6: 'Critical freshness',
};

/** Rubric 3.5. D6 is null (not applicable) for analytics and dashboards. */
export const WEIGHTS: Record<
  ReadinessUseType,
  Record<ReadinessDimension, number | null>
> = {
  analytics: { D1: 0.15, D2: 0.3, D3: 0.15, D4: 0.25, D5: 0.15, D6: null },
  dashboard: { D1: 0.1, D2: 0.25, D3: 0.25, D4: 0.25, D5: 0.15, D6: null },
  ml: { D1: 0.1, D2: 0.25, D3: 0.15, D4: 0.1, D5: 0.15, D6: 0.25 },
  'rag-agent': { D1: 0.1, D2: 0.15, D3: 0.15, D4: 0.2, D5: 0.2, D6: 0.2 },
};

/** A dimension is critical for the use type when it weighs >= 20% (plan 3). */
export const CRITICAL_WEIGHT = 0.2;

export function isCritical(weight: number | null): boolean {
  return weight !== null && weight >= CRITICAL_WEIGHT - 1e-9;
}

/** Sample size for the in-code checks, by risk (plan 3); the connector may cap it. */
export const SAMPLE_SIZE: Record<ReadinessRisk, number> = {
  low: 200,
  medium: 1000,
  high: 5000,
};

/** Defaults of the scoping card. */
export const DEFAULT_MAX_NULL_RATE = 0.05;
export const DEFAULT_MAX_DUPLICATE_RATE = 0.02;
/** Tolerated share of invalid formats in a key column's sample. */
export const MAX_INVALID_FORMAT_RATE = 0.05;
/** Tolerated share of orphan references. */
export const MAX_ORPHAN_RATE = 0.01;
/** Rubric 3.3 D2 level 1: "> 20% nulls, massive duplicates" (any rate above). */
export const SEVERE_RATE = 0.2;

/** D3: the window of the daily volume check. */
export const VOLUME_WINDOW_DAYS = 30;
/** D3 level 3: the SLA met in >= 95% of loads. */
export const ON_TIME_LEVEL_3 = 0.95;
/** D3 level 1: loads so irregular that fewer than half of the periods have data. */
export const ON_TIME_LEVEL_1 = 0.5;
/** Cadences longer than this have too few periods in the window to compute a share. */
export const MAX_CADENCE_DAYS_FOR_SHARE = 15;

/** Quality queries on a table above this size filter on its date column. */
export const LARGE_TABLE_ROWS = 1_000_000;
export const LARGE_TABLE_WINDOW_DAYS = 90;

/** D6 (rag-agent): machine-readable descriptions on at least this share of columns. */
export const AI_DESCRIBED_LEVEL_3 = 0.8;
/** D6 level 1: below this share an LLM cannot choose columns. */
export const AI_DESCRIBED_LEVEL_1 = 0.2;

/** PII: a column is flagged when this share of its sampled values matches. */
export const PII_MIN_RATE = 0.02;
export const PII_MIN_MATCHES = 2;
/** Without a name hint, number-like patterns must match most values. */
export const PII_UNHINTED_RATE = 0.5;

/** Sentinel values (quality profiling, "valores centinela"). 0 is left out: too common. */
export const SENTINEL_TEXT = ['n/a', 'test', '1900-01-01', '9999-12-31'];
export const SENTINEL_NUMBER = -1;

/** What the app cannot measure today, always declared (plan 3). */
export const ALWAYS_NOT_EVALUATED: {
  dimension: ReadinessDimension;
  item: string;
  reason: string;
}[] = [
  {
    dimension: 'D1',
    item: 'Owner metadata and support channel',
    reason:
      'The app keeps no owner catalog; owners come from the scoping card only.',
  },
  {
    dimension: 'D2',
    item: 'Accuracy against a source of truth',
    reason: 'No reconciliation source is connected.',
  },
  {
    dimension: 'D2',
    item: 'Existing data quality tests (dbt, Great Expectations, Soda)',
    reason:
      'The app cannot read test results; D2 level 4 needs them and is not reachable.',
  },
  {
    dimension: 'D3',
    item: 'Pipeline runs, SLA history and schema history',
    reason:
      'No orchestrator or schema history is connected; daily row volume is used as a proxy for loads.',
  },
  {
    dimension: 'D4',
    item: 'Governed metric definitions and lineage',
    reason: 'No semantic layer or lineage graph is connected.',
  },
  {
    dimension: 'D5',
    item: 'Classification labels, access policies, retention and audit',
    reason:
      'The app reads no policy metadata; PII is detected on a sample only (types and rates).',
  },
  {
    dimension: 'D5',
    item: 'Adequacy of the legal basis',
    reason:
      'Requires review by Legal / Privacy; the assessor gives no legal opinion.',
  },
];

export const AI_NOT_EVALUATED: Record<
  'ml' | 'rag-agent',
  { item: string; reason: string }[]
> = {
  ml: [
    {
      item: 'ML labels, class balance, leakage, representativeness and drift',
      reason: 'The app has no training-set tooling; D6 is not evaluated.',
    },
  ],
  'rag-agent': [
    {
      item: 'Semantic layer API and validated example queries',
      reason: 'Not connected; D6 covers descriptions, codes, layers and PII.',
    },
    {
      item: 'Document stores (coverage, freshness, contradictions)',
      reason: 'The app reads structured datasets only.',
    },
  ],
};
