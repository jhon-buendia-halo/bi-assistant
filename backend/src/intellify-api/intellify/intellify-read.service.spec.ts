import { NotFoundException } from '@nestjs/common';
import type { DbService } from '../db/db.service';
import { IntellifyReadService } from './intellify-read.service';

/** A DbService whose client answers every statement with no rows. */
function emptyDb(): { db: DbService; statements: string[] } {
  const statements: string[] = [];
  const client = {
    query: (text: string) => {
      statements.push(text);
      return Promise.resolve({ rows: [] });
    },
  };
  const db = {
    schema: 'intellify',
    readOnly: (fn: (c: unknown) => Promise<unknown>) => fn(client),
  } as unknown as DbService;
  return { db, statements };
}

describe('IntellifyReadService', () => {
  it('answers 404 for an unknown client on every per-client read', async () => {
    const { db } = emptyDb();
    const svc = new IntellifyReadService(db);
    const calls = [
      () => svc.clientDetail('NOPE'),
      () => svc.renewals('NOPE'),
      () => svc.program('NOPE'),
      () => svc.plan('NOPE', 'pd'),
      () => svc.clientFinancials('NOPE'),
      () => svc.clientCensus('NOPE'),
      () => svc.commercials('NOPE'),
      () => svc.wizards('NOPE'),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toThrow(
        new NotFoundException('Client "NOPE" not found'),
      );
    }
  });

  it('pages a collection with the requested window', async () => {
    const { db } = emptyDb();
    const svc = new IntellifyReadService(db);
    const res = await svc.products({ page: 3, per_page: 5 });
    expect(res).toEqual({ data: [], page: 3, per_page: 5, total: 0 });
  });

  it('only runs statements that start with SELECT', async () => {
    const { db, statements } = emptyDb();
    const svc = new IntellifyReadService(db);
    await svc.clients({ page: 1, per_page: 5 }).catch(() => undefined);
    await svc.clientDetail('x').catch(() => undefined);
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) expect(s.trimStart()).toMatch(/^SELECT/i);
  });
});
