import type { DbService } from '../db/db.service';
import { toErrorBody } from '../http-error.filter';
import type { RfpRepository } from './rfp.repository';
import { RfpService } from './rfp.service';

const ID = '11111111-2222-4333-8444-555555555555';

/** A DbService whose transactions hand `fn` a client answering `rows`. */
function fakeDb(rowsFor: (sql: string) => unknown[]) {
  const client = {
    query: jest.fn((sql: string) => Promise.resolve({ rows: rowsFor(sql) })),
  };
  const run = (fn: (c: unknown) => unknown) => Promise.resolve(fn(client));
  return {
    db: {
      schema: 'intellify',
      readOnly: run,
      write: run,
    } as unknown as DbService,
    client,
  };
}

function header(status = 'draft') {
  return {
    id: ID,
    clientOneCode: 'IC100100',
    clientName: 'Orchard',
    title: 't',
    planYear: 2027,
    effectiveDate: '2027-01-01',
    status,
    stage: 1,
    sections: { notes: 'n' },
    createdBy: null,
    createdAt: '2026-10-14T00:00:00.000Z',
    updatedAt: '2026-10-14T00:00:00.000Z',
  };
}

function fakeRepo(status = 'draft') {
  return {
    insert: jest.fn().mockResolvedValue(ID),
    findHeader: jest.fn().mockResolvedValue(header(status)),
    findFull: jest.fn().mockResolvedValue({
      ...header(status),
      lines: [],
      carriers: [],
      requirements: [],
      timeline: [],
    }),
    updateHeader: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<RfpRepository>;
}

describe('RfpService', () => {
  it('takes createdBy from the body first, then X-Qti-User', async () => {
    const { db } = fakeDb((sql) =>
      sql.includes('clients')
        ? [{ one_code: 'IC100100', name: 'Orchard' }]
        : [],
    );
    const repo = fakeRepo();
    const service = new RfpService(db, repo);
    await service.create(
      { clientOneCode: 'IC100100', planYear: 2027, createdBy: 'body' },
      'header',
    );
    await service.create(
      { clientOneCode: 'IC100100', planYear: 2027 },
      'header',
    );
    expect(repo.insert.mock.calls.map((c) => c[1].createdBy)).toEqual([
      'body',
      'header',
    ]);
    expect(repo.insert.mock.calls[0][1]).toMatchObject({
      title: 'Orchard — 2027 benefits RFP',
      effectiveDate: '2027-01-01',
    });
  });

  it('refuses an unknown client with 400 validation', async () => {
    const { db } = fakeDb(() => []);
    const error = await new RfpService(db, fakeRepo())
      .create({ clientOneCode: 'NOPE', planYear: 2027 })
      .catch((e: unknown) => e);
    expect(toErrorBody(error)).toMatchObject({
      statusCode: 400,
      code: 'validation',
      message: 'Client "NOPE" not found',
    });
  });

  it('answers 404 for an id that is not a UUID', async () => {
    const { db } = fakeDb(() => []);
    const error = await new RfpService(db, fakeRepo())
      .get('abc')
      .catch((e: unknown) => e);
    expect(toErrorBody(error)).toMatchObject({
      statusCode: 404,
      code: 'not_found',
      message: 'RFP "abc" not found',
    });
  });

  it('flags a record whose client is gone', async () => {
    const { db } = fakeDb(() => []);
    const rfp = await new RfpService(db, fakeRepo()).get(ID);
    expect(rfp.clientMissing).toBe(true);
  });

  it('merges sections and refuses a backward status on PATCH', async () => {
    const { db } = fakeDb(() => [{ one_code: 'IC100100' }]);
    const repo = fakeRepo('issued');
    const service = new RfpService(db, repo);
    await service.update(ID, { sections: { executiveSummary: 'e' } });
    expect(repo.updateHeader.mock.calls[0][2].sections).toEqual({
      executiveSummary: 'e',
      notes: 'n',
    });
    const error = await service
      .update(ID, { status: 'draft' })
      .catch((e: unknown) => e);
    expect(toErrorBody(error)).toMatchObject({
      statusCode: 409,
      code: 'conflict',
    });
    const deleting = await service.remove(ID).catch((e: unknown) => e);
    expect(toErrorBody(deleting)).toMatchObject({
      statusCode: 409,
      code: 'conflict',
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(repo.delete).not.toHaveBeenCalled();
  });
});
