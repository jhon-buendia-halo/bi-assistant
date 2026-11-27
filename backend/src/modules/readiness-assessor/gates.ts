// Rubric 3.4: the blocking gates, from the measures and the scoping card.
// A gate passes only on evidence that its failing condition is absent; with
// no evidence it is `not-evaluated` (which never counts as a pass). Pure.
import { pct } from './ledger';
import type { Issue } from './levels';
import { freshnessFails } from './levels-freshness';
import { hasLegalBasis } from './levels-privacy';
import { fieldLevel } from './levels-quality';
import type {
  AvailabilityMeasure,
  FreshnessMeasure,
  GovernanceMeasure,
  QualityMeasure,
} from './measures';
import type {
  GateResult,
  GateStatus,
  ReadinessGate,
  ReadinessScope,
} from './readiness.types';

export interface GateInput {
  scope: ReadinessScope;
  /** The scoping card's evidence (owners, personal data, thresholds). */
  scopeEvidenceId: string;
  availability: AvailabilityMeasure[];
  quality: QualityMeasure[];
  freshness: FreshnessMeasure[];
  governance: GovernanceMeasure[];
}

const gate = (
  g: ReadinessGate,
  status: GateStatus,
  reason: string,
  evidenceIds: string[],
): GateResult => ({
  gate: g,
  status,
  reason,
  evidenceIds: [...new Set(evidenceIds)],
});

export function evaluateGates(input: GateInput): {
  gates: GateResult[];
  issues: Issue[];
} {
  const issues: Issue[] = [];
  const { scope, scopeEvidenceId: scopeEv } = input;
  const accessible = input.availability.filter((a) => a.accessible);

  // G1 Access: a critical source is not accessible (D1 = 0).
  const blocked = input.availability.filter((a) => !a.accessible);
  const g1Ev = input.availability.flatMap((a) => a.evidenceIds);
  const g1 = !input.availability.length
    ? gate(
        'G1',
        'fail',
        'No critical entity resolved in the session datasets.',
        [scopeEv],
      )
    : blocked.length
      ? gate(
          'G1',
          'fail',
          `Not accessible: ${blocked.map((b) => b.entity).join(', ')}.`,
          g1Ev,
        )
      : gate('G1', 'pass', 'Every critical entity answered a row count.', g1Ev);
  if (!input.availability.length) {
    issues.push({
      dimension: 'D1',
      gate: 'G1',
      severity: 'blocking',
      measured: '0 entities',
      threshold: '>= 1 critical entity',
      description:
        'No critical entity of the scope exists in the session datasets.',
      evidenceIds: [scopeEv],
    });
  }

  // G2 Owner: no critical source has an identifiable owner.
  const datasets = [
    ...new Set(input.availability.map((a) => a.dataset).filter(Boolean)),
  ];
  const owned = input.availability.filter((a) => a.owner);
  let g2: GateResult;
  if (owned.length) {
    g2 = gate(
      'G2',
      'pass',
      `Owner named for ${[...new Set(owned.map((o) => o.dataset))].join(', ')}.`,
      [scopeEv],
    );
  } else {
    g2 = gate(
      'G2',
      'fail',
      `No owner named for ${datasets.join(', ') || 'the critical sources'}.`,
      [scopeEv],
    );
    issues.push({
      dimension: 'D1',
      gate: 'G2',
      severity: 'blocking',
      measured: '0 owners',
      threshold: '>= 1 identifiable owner',
      description:
        'No critical source has an identifiable owner; the app keeps no owner metadata, so the owner must be named.',
      evidenceIds: [scopeEv],
    });
  }

  // G3 Legal basis: personal data without a legal basis or compatible purpose.
  const scanned = input.governance.filter((g) => g.scanned);
  const govEv = scanned.flatMap((g) => g.evidenceIds);
  const piiFound = scanned.some((g) => g.pii.length > 0);
  const personal = scope.personalDataNeeded || piiFound;
  let g3: GateResult;
  if (personal && !hasLegalBasis(scope)) {
    g3 = gate(
      'G3',
      'fail',
      `${scope.personalDataNeeded ? 'The use needs personal data' : 'Personal data was found'} and no legal basis was documented.`,
      [scopeEv, ...govEv],
    );
    issues.push({
      dimension: 'D5',
      gate: 'G3',
      severity: 'blocking',
      measured: 'no legal basis',
      threshold: 'a documented legal basis or compatible purpose',
      description:
        'Personal data without a documented legal basis or purpose: requires Legal / Privacy review.',
      evidenceIds: [scopeEv, ...govEv],
    });
  } else if (personal) {
    g3 = gate(
      'G3',
      'pass',
      'A legal basis was stated in the scoping card (its adequacy requires Legal / Privacy review).',
      [scopeEv, ...govEv],
    );
  } else if (scanned.length && scanned.length === accessible.length) {
    g3 = gate(
      'G3',
      'pass',
      'The use needs no personal data and none was found in the samples.',
      [scopeEv, ...govEv],
    );
  } else {
    g3 = gate(
      'G3',
      'not-evaluated',
      'Not every critical source could be scanned for personal data.',
      [scopeEv, ...govEv],
    );
  }

  // G4 Exposed PII: unclassified, unmasked PII in a use that does not need it.
  const piiCols = scanned.flatMap((g) =>
    g.pii.map(
      (p) => `${g.entity}.${p.column} (${p.type}, ${pct(p.matchRate)})`,
    ),
  );
  const g4 = scope.personalDataNeeded
    ? gate('G4', 'pass', 'The use needs personal data; G3 judges its basis.', [
        scopeEv,
        ...govEv,
      ])
    : piiCols.length
      ? gate(
          'G4',
          'fail',
          `Unclassified PII in a use that does not need it: ${piiCols.join(', ')}.`,
          govEv,
        )
      : scanned.length && scanned.length === accessible.length
        ? gate(
            'G4',
            'pass',
            'No PII pattern in the samples of the critical sources.',
            govEv,
          )
        : gate(
            'G4',
            'not-evaluated',
            'Not every critical source could be scanned for PII.',
            govEv,
          );

  // G5 Key field: an indispensable field has quality level <= 1.
  const indispensable = scope.criticalFields.filter((f) => f.indispensable);
  const fields = input.quality.flatMap((q) =>
    q.fields
      .filter((f) => f.indispensable)
      .map((f) => ({ entity: q.entity, f })),
  );
  const failing = fields.filter(({ f }) => {
    const l = fieldLevel(f);
    return l !== 'N/E' && l <= 1;
  });
  const fieldEv = fields.flatMap(({ f }) => f.evidenceIds);
  const g5 = !indispensable.length
    ? gate('G5', 'pass', 'No field was declared indispensable.', [scopeEv])
    : failing.length
      ? gate(
          'G5',
          'fail',
          `Indispensable field at quality level <= 1: ${failing.map(({ entity, f }) => `${entity}.${f.column}`).join(', ')}.`,
          failing.flatMap(({ f }) => f.evidenceIds),
        )
      : fields.length === indispensable.length &&
          fields.every(({ f }) => fieldLevel(f) !== 'N/E')
        ? gate(
            'G5',
            'pass',
            'Every indispensable field is above quality level 1.',
            fieldEv,
          )
        : gate(
            'G5',
            'not-evaluated',
            'The quality of some indispensable field could not be measured.',
            [scopeEv, ...fieldEv],
          );

  // G6 Critical freshness: below the minimum the use requires.
  const required = scope.requiredFreshnessHours;
  const measured = input.freshness.filter((f) => f.ageHours !== undefined);
  const freshEv = measured.flatMap((f) =>
    [f.maxEvidenceId, f.volume?.evidenceId].filter((id): id is string => !!id),
  );
  const stale = measured.filter((f) => freshnessFails(f, required));
  const g6 =
    required === undefined
      ? gate(
          'G6',
          'not-evaluated',
          'The scoping card states no required freshness.',
          [scopeEv],
        )
      : stale.length
        ? gate(
            'G6',
            'fail',
            `Below the required ${required} h: ${stale.map((s) => s.entity).join(', ')}.`,
            freshEv,
          )
        : measured.length
          ? gate('G6', 'pass', `Within the required ${required} h.`, freshEv)
          : gate(
              'G6',
              'not-evaluated',
              'No critical entity has a date column to measure.',
              [scopeEv],
            );

  return { gates: [g1, g2, g3, g4, g5, g6], issues };
}
