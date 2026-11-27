// Baseline memory (source section 8): the key that ties assessments of the
// same use case and datasets together, and the delta against the previous
// one. Pure.
import { DIMENSIONS, GATES } from './rubric';
import type {
  ReadinessAssessment,
  ReadinessBaselineDelta,
} from './readiness.types';

/** Lower case, accents and punctuation dropped, spaces collapsed. */
export function normaliseUseCase(useCase: string): string {
  return useCase
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Same use case and datasets → same key: `<normalised use case>|<sorted dataset names>`. */
export function useCaseKey(useCase: string, datasets: string[]): string {
  const names = [
    ...new Set(datasets.map((d) => d.trim()).filter(Boolean)),
  ].sort();
  return `${normaliseUseCase(useCase)}|${names.join(',')}`;
}

/** Every dimension's move, and the gates whose status changed. */
export function baselineDelta(
  previous: ReadinessAssessment,
  current: Pick<ReadinessAssessment, 'dimensions' | 'gates'>,
): ReadinessBaselineDelta {
  const level = (a: Pick<ReadinessAssessment, 'dimensions'>, d: string) =>
    a.dimensions.find((x) => x.dimension === d)?.level ?? 'N/E';
  const status = (a: Pick<ReadinessAssessment, 'gates'>, g: string) =>
    a.gates.find((x) => x.gate === g)?.status ?? 'not-evaluated';
  const dims = new Set([
    ...previous.dimensions.filter((d) => d.applicable).map((d) => d.dimension),
    ...current.dimensions.filter((d) => d.applicable).map((d) => d.dimension),
  ]);
  return {
    previousId: previous.id,
    previousAt: previous.createdAt,
    previousRubricVersion: previous.rubricVersion,
    previousVerdict: previous.verdict,
    dimensions: DIMENSIONS.filter((d) => dims.has(d)).map((d) => ({
      dimension: d,
      from: level(previous, d),
      to: level(current, d),
    })),
    gates: GATES.map((g) => ({
      gate: g,
      from: status(previous, g),
      to: status(current, g),
    })).filter((g) => g.from !== g.to),
  };
}
