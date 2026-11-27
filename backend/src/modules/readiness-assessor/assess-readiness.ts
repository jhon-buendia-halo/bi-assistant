// The engine of Dana, the Data Readiness Assessor (plan section 1): inventory
// → D1..D6 measurements → gates → levels → verdict → baseline, saved. Dana
// quotes what this returns; she never computes or rounds the verdict.
import { randomUUID } from 'crypto';
import { baselineDelta, useCaseKey } from './baseline';
import { evaluateGates } from './gates';
import { buildInventory, type InventoryEntity } from './inventory';
import { attempt, Ledger, throwIfAborted, type MeasureContext } from './ledger';
import {
  availabilityLevel,
  combine,
  semanticsLevel,
  type Issue,
  type Judgement,
} from './levels';
import { freshnessLevel } from './levels-freshness';
import { aiFitnessLevel, governanceLevel } from './levels-privacy';
import { qualityLevel } from './levels-quality';
import { measureAiFitness } from './measure-ai-fitness';
import { measureAvailability } from './measure-availability';
import { measureFreshness } from './measure-freshness';
import { measureGovernance } from './measure-governance';
import { measureQuality, takeSample } from './measure-quality';
import { measureSemantics } from './measure-semantics';
import type {
  AvailabilityMeasure,
  FreshnessMeasure,
  GovernanceMeasure,
  QualityMeasure,
} from './measures';
import {
  DIMENSIONS,
  LARGE_TABLE_ROWS,
  LARGE_TABLE_WINDOW_DAYS,
  WEIGHTS,
} from './rubric';
import {
  READINESS_RUBRIC_VERSION,
  type AssessReadinessOptions,
  type DimensionResult,
  type GateResult,
  type ReadinessAssessment,
  type ReadinessDimension,
  type ReadinessPort,
  type ReadinessScope,
} from './readiness.types';
import { buildConditions, decideVerdict, weightedScore } from './verdict';
import { declareNotEvaluated, escalations } from './declarations';

const DAY_MS = 86_400_000;

interface Collected {
  availability: AvailabilityMeasure[];
  quality: QualityMeasure[];
  freshness: FreshnessMeasure[];
  governance: GovernanceMeasure[];
  judgements: Record<ReadinessDimension, Judgement[]>;
}

export async function assessReadiness(
  scope: ReadinessScope,
  port: ReadinessPort,
  options: AssessReadinessOptions,
): Promise<ReadinessAssessment> {
  const now = options.now ?? new Date();
  const ledger = new Ledger();
  const ctx: MeasureContext = {
    scope,
    port,
    ledger,
    now,
    signal: options.signal,
  };
  throwIfAborted(options.signal);
  const datasets = [...new Set(options.datasets)].sort();
  const key = useCaseKey(scope.useCase, datasets);
  const scopeEvidenceId = ledger.addEvidence({
    dimension: 'gate',
    description: 'The scoping card agreed with the requester',
    source: 'metadata',
    coverage: 'metadata',
    result: {
      use_type: scope.useType,
      risk: scope.risk,
      critical_entities: scope.entities.length,
      critical_fields: scope.criticalFields.length,
      indispensable_fields: scope.criticalFields.filter((f) => f.indispensable)
        .length,
      required_freshness_hours: scope.requiredFreshnessHours ?? null,
      personal_data_needed: scope.personalDataNeeded,
      legal_basis_documented: !!scope.legalBasis?.trim(),
      owners_named: scope.owners?.filter((o) => o.owner.trim()).length ?? 0,
    },
  });

  const snapshots = await attempt(ctx, () => port.datasets(datasets));
  if (!snapshots.ok)
    ledger.addNotEvaluated('Session datasets', snapshots.reason);
  const inventory = buildInventory(
    scope,
    datasets,
    snapshots.ok ? snapshots.value : [],
  );
  for (const name of inventory.missingDatasets) {
    ledger.addNotEvaluated(
      `Dataset ${name}`,
      'The session has no dataset with this name.',
    );
  }

  const c = await collect(ctx, inventory.entities);
  const issues: Issue[] = DIMENSIONS.flatMap((d) =>
    c.judgements[d].flatMap((j) => j.issues),
  );
  const gateEval = evaluateGates({ scope, scopeEvidenceId, ...c });
  for (const issue of [...issues, ...gateEval.issues]) ledger.addFinding(issue);

  const dimensions = DIMENSIONS.map((d) =>
    dimensionResult(scope, d, c.judgements[d]),
  );
  const gates = gateEval.gates.map(guardGate);
  const byDimension = buildConditions(dimensions, ledger.findings);
  const decision = decideVerdict(gates, dimensions, [...byDimension.keys()]);
  const score = weightedScore(dimensions);
  declareNotEvaluated(ledger, scope, dimensions, c.judgements);

  const assessment: ReadinessAssessment = {
    id: randomUUID(),
    createdAt: now.toISOString(),
    rubricVersion: READINESS_RUBRIC_VERSION,
    useCaseKey: key,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    datasets,
    scope,
    verdict: decision.verdict,
    weightedScore: score.score,
    ...(score.note ? { weightedScoreNote: score.note } : {}),
    conditions:
      decision.verdict === 'ready-with-conditions'
        ? [...byDimension.values()].flat()
        : [],
    gates,
    dimensions,
    findings: ledger.findings,
    evidence: ledger.evidence,
    notEvaluated: ledger.notEvaluated,
    escalations: escalations(scope, decision.verdict, gates, c),
  };

  const previous = await attempt(ctx, () => port.previous(key));
  if (!previous.ok) {
    ledger.addNotEvaluated(
      'Comparison with the previous assessment',
      previous.reason,
    );
  } else if (previous.value) {
    assessment.previous = baselineDelta(previous.value, assessment);
    if (previous.value.rubricVersion !== READINESS_RUBRIC_VERSION) {
      ledger.addNotEvaluated(
        'Like-for-like comparison with the previous assessment',
        `The rubric changed from ${previous.value.rubricVersion} to ${READINESS_RUBRIC_VERSION}.`,
      );
    }
  }
  const saved = await attempt(ctx, () => port.save(assessment));
  if (!saved.ok)
    ledger.addNotEvaluated(
      'Baseline saved for the next assessment',
      saved.reason,
    );
  return assessment;
}

async function collect(
  ctx: MeasureContext,
  entities: InventoryEntity[],
): Promise<Collected> {
  const c: Collected = {
    availability: [],
    quality: [],
    freshness: [],
    governance: [],
    judgements: { D1: [], D2: [], D3: [], D4: [], D5: [], D6: [] },
  };
  const ai = ctx.scope.useType === 'rag-agent';
  for (const entity of entities) {
    const a = await measureAvailability(ctx, entity);
    c.availability.push(a);
    c.judgements.D1.push(availabilityLevel(a));
    if (entity.found)
      c.judgements.D4.push(semanticsLevel(measureSemantics(ctx, entity)));
    if (!a.accessible) {
      ctx.ledger.addNotEvaluated(
        `D2, D3, D5 and D6 of ${entity.key}`,
        'The source is not accessible, so no level is inferred for it.',
      );
      continue;
    }
    const f = await measureFreshness(ctx, entity);
    c.freshness.push(f);
    c.judgements.D3.push(freshnessLevel(f, ctx.scope));
    const window =
      (a.rowCount ?? 0) > LARGE_TABLE_ROWS && f.dateColumn
        ? {
            column: f.dateColumn,
            since: new Date(
              ctx.now.getTime() - LARGE_TABLE_WINDOW_DAYS * DAY_MS,
            ),
          }
        : undefined;
    const sample = await takeSample(ctx, entity);
    const q = await measureQuality(ctx, entity, sample, window);
    c.quality.push(q);
    c.judgements.D2.push(qualityLevel(q));
    const g = measureGovernance(ctx, entity, sample);
    c.governance.push(g);
    c.judgements.D5.push(governanceLevel(g, ctx.scope));
    if (ai)
      c.judgements.D6.push(
        aiFitnessLevel(measureAiFitness(ctx, entity, sample, g)),
      );
  }
  return c;
}

/** A level with no evidence is N/E (guardrail 7.3). */
function dimensionResult(
  scope: ReadinessScope,
  dimension: ReadinessDimension,
  judgements: Judgement[],
): DimensionResult {
  const weight = WEIGHTS[scope.useType][dimension];
  if (weight === null) {
    return {
      dimension,
      applicable: false,
      level: 'N/E',
      weight: null,
      reason: `Not applicable to ${scope.useType}.`,
      evidenceIds: [],
    };
  }
  if (dimension === 'D6' && scope.useType === 'ml') {
    return {
      dimension,
      applicable: true,
      level: 'N/E',
      weight,
      reason:
        'Not evaluated: ML labels, balance and leakage cannot be measured with the app.',
      evidenceIds: [],
    };
  }
  const r = combine(dimension, judgements);
  if (r.level !== 'N/E' && !r.evidenceIds.length) {
    return {
      dimension,
      applicable: true,
      level: 'N/E',
      weight,
      reason: 'Not evaluated: no evidence.',
      evidenceIds: [],
    };
  }
  return { dimension, applicable: true, weight, ...r };
}

/** A gate with no evidence is not evaluated (guardrail 7.3). */
function guardGate(g: GateResult): GateResult {
  return g.evidenceIds.length || g.status === 'not-evaluated'
    ? g
    : { ...g, status: 'not-evaluated', reason: `${g.reason} (no evidence)` };
}
