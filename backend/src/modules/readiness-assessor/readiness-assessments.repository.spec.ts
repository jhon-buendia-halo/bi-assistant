import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import {
  ReadinessAssessmentsRepository,
  type ReadinessAssessmentDoc,
} from './readiness-assessments.repository';
import type { ReadinessAssessment } from './readiness.types';

/** Real `SqliteDocStore` over an in-memory database, as the other repos test. */
function build() {
  const db = new BetterSqlite3(':memory:');
  const store = new SqliteDocStore<ReadinessAssessmentDoc>(
    db,
    'readiness_assessments',
  );
  return { db, repository: new ReadinessAssessmentsRepository(store) };
}

const assessment = (
  id: string,
  useCaseKey: string,
  createdAt: string,
): ReadinessAssessment =>
  ({
    id,
    useCaseKey,
    createdAt,
    rubricVersion: '1.0',
    verdict: 'ready',
    dimensions: [],
    gates: [],
  }) as unknown as ReadinessAssessment;

describe('ReadinessAssessmentsRepository', () => {
  it('returns null when nothing was assessed for the key', async () => {
    const { db, repository } = build();
    expect(await repository.latest('x|a')).toBeNull();
    db.close();
  });

  it('returns the newest assessment of the key, intact', async () => {
    const { db, repository } = build();
    await repository.save(assessment('a1', 'x|a', '2026-11-01T00:00:00.000Z'));
    await repository.save(assessment('a2', 'x|a', '2026-11-20T00:00:00.000Z'));
    await repository.save(assessment('b1', 'y|a', '2026-11-25T00:00:00.000Z'));
    const latest = await repository.latest('x|a');
    expect(latest).toEqual(assessment('a2', 'x|a', '2026-11-20T00:00:00.000Z'));
    db.close();
  });
});
