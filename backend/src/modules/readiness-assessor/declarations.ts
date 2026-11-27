// What the assessment always declares: the items not evaluated (guardrail
// 7.3) and the reasons a human must look at it (rubric "escala a un humano
// cuando"). Pure.
import type { Ledger } from './ledger';
import type { Judgement } from './levels';
import type { AvailabilityMeasure, GovernanceMeasure } from './measures';
import { AI_NOT_EVALUATED, ALWAYS_NOT_EVALUATED, DIMENSIONS } from './rubric';
import type {
  DimensionResult,
  GateResult,
  ReadinessAssessment,
  ReadinessDimension,
  ReadinessScope,
} from './readiness.types';

interface Collected {
  availability: AvailabilityMeasure[];
  governance: GovernanceMeasure[];
}

export function declareNotEvaluated(
  ledger: Ledger,
  scope: ReadinessScope,
  dimensions: DimensionResult[],
  judgements: Record<ReadinessDimension, Judgement[]>,
): void {
  const applicable = new Set(
    dimensions.filter((d) => d.applicable).map((d) => d.dimension),
  );
  for (const n of ALWAYS_NOT_EVALUATED) {
    if (applicable.has(n.dimension))
      ledger.addNotEvaluated(`${n.dimension}: ${n.item}`, n.reason);
  }
  if (scope.useType === 'ml' || scope.useType === 'rag-agent') {
    for (const n of AI_NOT_EVALUATED[scope.useType])
      ledger.addNotEvaluated(`D6: ${n.item}`, n.reason);
  }
  for (const d of DIMENSIONS) {
    for (const j of judgements[d].filter((x) => x.level === 'N/E')) {
      ledger.addNotEvaluated(`${d} of ${j.entity}`, j.reason);
    }
  }
}

/** Rubric "escala a un humano cuando", plus gates not evaluated on a critical source (4.8). */
export function escalations(
  scope: ReadinessScope,
  verdict: ReadinessAssessment['verdict'],
  gates: GateResult[],
  c: Collected,
): string[] {
  const out: string[] = [];
  const unowned = [
    ...new Set(
      c.availability.filter((a) => !a.owner).map((a) => a.dataset || a.entity),
    ),
  ];
  for (const d of unowned)
    out.push(`No identifiable owner for the critical source ${d}.`);
  const pii = c.governance.flatMap((g) =>
    g.pii.map((p) => `${g.entity}.${p.column} (${p.type})`),
  );
  if (pii.length && !scope.legalBasis?.trim()) {
    out.push(
      `Personal data without classification or a clear legal basis: ${pii.join(', ')}. Requires Legal / Privacy review.`,
    );
  } else if (gates.find((g) => g.gate === 'G3')?.status === 'fail') {
    out.push(
      'The use needs personal data and no legal basis was documented. Requires Legal / Privacy review.',
    );
  }
  if (scope.risk === 'high' && verdict !== 'ready') {
    out.push(`High-risk use and the verdict is ${verdict}, not ready.`);
  }
  for (const g of gates.filter((x) => x.status === 'not-evaluated')) {
    out.push(`Gate ${g.gate} not evaluated on a critical source: ${g.reason}`);
  }
  return out;
}
