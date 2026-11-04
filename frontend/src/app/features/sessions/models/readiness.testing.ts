// Test data for the readiness scorecard, card and stream specs. Imported by
// specs only; plain data, so it type-checks in the app build too.

import {
  READINESS_DIMENSION_ORDER,
  READINESS_UNASSESSED,
  ReadinessFinding,
  ReadinessReport,
} from './readiness.model';
import { ReadinessPanelItem } from './session.model';

export function sampleReadinessFindings(): ReadinessFinding[] {
  return [
    {
      dimension: 'validity',
      level: 'entity',
      namespace: 'public',
      entity: 'matches',
      field: 'score',
      severity: 'low',
      measured: 0.02,
      description: 'Some scores are out of range.',
      recommendation: 'Add a check constraint.',
    },
    {
      dimension: 'completeness',
      level: 'entity',
      namespace: 'public',
      entity: 'players',
      field: 'birth_date',
      severity: 'high',
      measured: 0.4,
      description: '40% of birth dates are missing.',
      recommendation: 'Backfill birth dates.',
    },
    {
      dimension: 'accessibility',
      level: 'source',
      namespace: 'public',
      severity: 'info',
      description: 'One table could not be read.',
      recommendation: 'Grant SELECT on it.',
    },
    {
      dimension: 'completeness',
      level: 'entity',
      namespace: 'public',
      entity: 'teams',
      field: 'coach',
      severity: 'medium',
      measured: 0.1,
      description: '10% of coaches are missing.',
      recommendation: 'Fill in coaches.',
    },
    {
      dimension: 'uniqueness',
      level: 'entity',
      namespace: 'public',
      entity: 'matches',
      field: 'id',
      severity: 'high',
      measured: 3,
      description: 'Duplicate match ids.',
      recommendation: 'Add a primary key.',
    },
  ];
}

export function sampleReadinessReport(
  overrides: Partial<ReadinessReport> = {},
): ReadinessReport {
  return {
    id: 'r1',
    datasourceId: 'ds1',
    datasourceName: 'World Cup',
    datasourceKind: 'postgres',
    generatedAt: '2026-11-03T10:00:00.000Z',
    overallScore: 82,
    maturity: 'Managed',
    dimensionScores: READINESS_DIMENSION_ORDER.map((dimension, i) => {
      const assessed = !READINESS_UNASSESSED.includes(dimension);
      return {
        dimension,
        score: assessed ? 90 - i : 0,
        findingCount: assessed ? i : 0,
        maxSeverity: null,
        assessed,
        totalChecks: assessed ? 10 + i : 0,
      };
    }),
    findings: sampleReadinessFindings(),
    entityCount: 3,
    ...overrides,
  };
}

export function sampleReadinessPanelItem(
  reportId = 'r1',
): ReadinessPanelItem {
  return {
    id: `readiness:${reportId}`,
    kind: 'readiness',
    title: 'Data readiness — World Cup',
    shownAt: '2026-11-03T10:00:01.000Z',
    reportId,
  };
}
