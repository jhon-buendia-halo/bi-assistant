// Rubric 3.3 for D5 Governance and D6 AI fitness (agents over structured
// data). Pure.
import { pct } from './ledger';
import type { Issue, Judgement } from './levels';
import type { AiFitnessMeasure, GovernanceMeasure } from './measures';
import { AI_DESCRIBED_LEVEL_1, AI_DESCRIBED_LEVEL_3 } from './rubric';
import type { ReadinessScope } from './readiness.types';

// D5 -----------------------------------------------------------------------

export const hasLegalBasis = (scope: ReadinessScope) =>
  !!scope.legalBasis?.trim();

export function governanceLevel(
  m: GovernanceMeasure,
  scope: ReadinessScope,
): Judgement {
  const base = {
    entity: m.entity,
    evidenceIds: m.evidenceIds,
    issues: [] as Issue[],
  };
  if (!m.scanned) {
    return {
      ...base,
      level: 'N/E',
      reason: `Not evaluated: no sample (${m.reason ?? 'unknown'}).`,
    };
  }
  const needed = scope.personalDataNeeded;
  for (const p of m.pii) {
    base.issues.push({
      dimension: 'D5',
      ...(needed ? {} : { gate: 'G4' as const }),
      severity: needed ? 'medium' : 'blocking',
      entity: m.entity,
      column: p.column,
      measured: `${p.type} pattern in ${pct(p.matchRate)} of ${p.checked} sampled values`,
      threshold: needed
        ? 'classified and masked'
        : 'no PII in a use that does not need it',
      description: `Unclassified ${p.type} data in \`${p.column}\` of ${m.entity} (types and rates only; requires Legal / Privacy review).`,
      evidenceIds: m.evidenceIds,
    });
  }
  if (m.nameHints.length) {
    base.issues.push({
      dimension: 'D5',
      severity: 'low',
      entity: m.entity,
      measured: `${m.nameHints.length} column(s) named like personal data`,
      description: `Columns whose names suggest personal data no pattern checks (names, addresses, birth dates) in ${m.entity}: ${m.nameHints.map((c) => `\`${c}\``).join(', ')}. Confirm their classification.`,
      evidenceIds: m.evidenceIds,
    });
  }
  const pii = m.pii.length > 0;
  if ((pii && !needed) || ((pii || needed) && !hasLegalBasis(scope))) {
    return {
      ...base,
      level: 1,
      reason:
        'Level 1: personal data without control (unclassified, unmasked, or without a legal basis).',
    };
  }
  if (pii || needed) {
    return {
      ...base,
      level: 2,
      reason:
        'Level 2: personal data the use needs, with a stated legal basis; classification, masking and access roles not verifiable.',
    };
  }
  return {
    ...base,
    level: 3,
    reason:
      'Level 3: no personal data in the sample. Classification labels, access roles, retention and audit not evaluated (level 4 unreachable).',
  };
}
// D6 -----------------------------------------------------------------------

export function aiFitnessLevel(m: AiFitnessMeasure): Judgement {
  const base = {
    entity: m.entity,
    evidenceIds: m.evidenceIds,
    issues: [] as Issue[],
  };
  if (!m.measured) {
    return {
      ...base,
      level: 'N/E',
      reason: 'Not evaluated: the dataset keeps no column metadata for it.',
    };
  }
  const gaps: string[] = [];
  const add = (
    severity: Issue['severity'],
    measured: string,
    threshold: string,
    text: string,
  ) => {
    gaps.push(text);
    base.issues.push({
      dimension: 'D6',
      severity,
      entity: m.entity,
      measured,
      threshold,
      description: `${m.entity}: ${text}.`,
      evidenceIds: m.evidenceIds,
    });
  };
  if (m.describedShare < AI_DESCRIBED_LEVEL_3) {
    add(
      m.describedShare < AI_DESCRIBED_LEVEL_1 ? 'high' : 'medium',
      `${pct(m.describedShare)} of columns described`,
      `>= ${pct(AI_DESCRIBED_LEVEL_3)}`,
      'too few machine-readable column descriptions',
    );
  }
  if (m.layer === 'landing')
    add(
      'medium',
      'landing layer',
      'a normalized or consumption layer',
      'the agent would read the raw landing layer',
    );
  if (m.piiColumns)
    add(
      'high',
      `PII in ${m.piiColumns} column(s)`,
      'no PII exposed to the agent',
      'personal data is exposed to the agent',
    );
  if (m.codedUndocumented.length) {
    add(
      'medium',
      `${m.codedUndocumented.length} coded column(s)`,
      'a dictionary for coded values',
      `coded values without a dictionary (${m.codedUndocumented.map((c) => `\`${c}\``).join(', ')})`,
    );
  }
  if (m.describedShare < AI_DESCRIBED_LEVEL_1) {
    return {
      ...base,
      level: 1,
      reason:
        'Level 1: an agent cannot tell the columns apart (insufficient descriptions).',
    };
  }
  if (gaps.length)
    return {
      ...base,
      level: 2,
      reason: `Level 2: usable with important gaps: ${gaps.join('; ')}.`,
    };
  return {
    ...base,
    level: 3,
    reason:
      'Level 3: described, curated layer, no exposed PII or undocumented codes. Level 4 needs versioning and monitoring, not evaluated.',
  };
}
