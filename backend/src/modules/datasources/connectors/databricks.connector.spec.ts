const clients: FakeClient[] = [];

jest.mock('@databricks/sql', () => ({
  DBSQLClient: jest.fn().mockImplementation(() => {
    const client = new FakeClient();
    clients.push(client);
    return client;
  }),
}));

import { Logger } from '@nestjs/common';
import { DatabricksConnector } from './databricks.connector';

/** Rows the fake warehouse answers with, keyed by a fragment of the SQL. */
type Responder = (sql: string) => Record<string, unknown>[];

let respond: Responder = () => [];

class FakeSession {
  readonly statements: string[] = [];
  closed = false;

  executeStatement(sql: string) {
    this.statements.push(sql);
    const rows = respond(sql);
    return Promise.resolve({ fetchAll: () => Promise.resolve(rows) });
  }

  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

class FakeClient {
  readonly sessions: FakeSession[] = [];
  readonly connectOptions: Record<string, unknown>[] = [];
  closed = false;

  connect(options: Record<string, unknown>) {
    this.connectOptions.push(options);
    return Promise.resolve(this);
  }

  openSession() {
    const session = new FakeSession();
    this.sessions.push(session);
    return Promise.resolve(session);
  }

  close() {
    this.closed = true;
    return Promise.resolve();
  }
}

const config = {
  host: 'example.cloud.databricks.com',
  token: 'secret',
  warehouseId: 'wh1',
};

/** Unity Catalog REST: `sales`/`ops` queryable, `archive` browse-only. */
function mockUcFetch(): jest.Mock {
  const fetchMock = jest.fn((url: string) => {
    const body = url.includes('/catalogs')
      ? {
          catalogs: [
            { name: 'sales' },
            { name: 'ops' },
            { name: 'archive', browse_only: true },
          ],
        }
      : { schemas: [{ name: 'public' }] };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function statements(): string[] {
  return clients.flatMap((c) => c.sessions.flatMap((s) => s.statements));
}

beforeEach(() => {
  clients.length = 0;
  respond = () => [];
  mockUcFetch();
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});

describe('DatabricksConnector inventory', () => {
  it('walks only catalogs with query access, in one bulk sweep', async () => {
    respond = (sql) => {
      if (sql.includes('SHOW CATALOGS')) {
        return [
          { catalog: 'sales' },
          { catalog: 'ops' },
          { catalog: 'archive' },
          { catalog: 'system' },
        ];
      }
      if (sql.includes('system.information_schema.tables')) {
        return [
          {
            table_catalog: 'sales',
            table_schema: 'public',
            table_name: 'orders',
          },
        ];
      }
      if (sql.includes('system.information_schema.columns')) {
        return [
          {
            table_catalog: 'sales',
            table_schema: 'public',
            table_name: 'orders',
            column_name: 'id',
            full_data_type: 'bigint',
            is_nullable: 'NO',
            ordinal_position: 1,
          },
        ];
      }
      return [];
    };

    const result = await new DatabricksConnector().inventory(config);

    // Browse-only and system catalogs never reach the warehouse.
    const bulk = statements().filter((s) => s.includes('system.information_'));
    expect(bulk).toHaveLength(2);
    for (const sql of bulk) {
      expect(sql).toContain("IN ('sales', 'ops')");
    }
    // One session for SHOW CATALOGS, one for the bulk sweep.
    expect(clients).toHaveLength(2);
    expect(result.map((c) => c.name)).toEqual(['ops', 'sales']);
    // A catalog with no visible tables still shows up.
    expect(result[0].schemas).toEqual([]);
    expect(result[1].schemas).toEqual([
      {
        name: 'public',
        tables: [
          {
            name: 'orders',
            columns: [{ name: 'id', type: 'bigint', nullable: false }],
            selectable: true,
          },
        ],
        selectable: true,
      },
    ]);
  });

  it('falls back to per-catalog walks on one shared client when the bulk sweep fails', async () => {
    respond = (sql) => {
      if (sql.includes('SHOW CATALOGS')) {
        return [{ catalog: 'sales' }, { catalog: 'ops' }];
      }
      if (sql.includes('system.information_schema')) {
        throw new Error('PERMISSION_DENIED: system.information_schema');
      }
      if (sql.includes('information_schema.tables')) {
        return [{ table_schema: 'public', table_name: 'orders' }];
      }
      return [];
    };

    const result = await new DatabricksConnector().inventory(config);

    // SHOW CATALOGS client, bulk client, then one shared fallback client with
    // a session per catalog.
    expect(clients).toHaveLength(3);
    const fallback = clients[2];
    expect(fallback.sessions).toHaveLength(2);
    expect(fallback.sessions.every((s) => s.closed)).toBe(true);
    expect(fallback.closed).toBe(true);
    expect(result.map((c) => c.name)).toEqual(['ops', 'sales']);
    expect(result[1].schemas[0].tables.map((t) => t.name)).toEqual(['orders']);
  });

  it('walks every catalog when the access pre-filter fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    respond = (sql) =>
      sql.includes('SHOW CATALOGS')
        ? [{ catalog: 'sales' }, { catalog: 'archive' }]
        : [];

    const result = await new DatabricksConnector().inventory(config);

    expect(
      statements().some((s) => s.includes("IN ('sales', 'archive')")),
    ).toBe(true);
    expect(result.map((c) => c.name)).toEqual(['archive', 'sales']);
  });

  it('opts every client out of driver telemetry', async () => {
    respond = (sql) => (sql.includes('SHOW CATALOGS') ? [] : []);

    await new DatabricksConnector().inventory(config);

    const options = clients.flatMap((c) => c.connectOptions);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => o.telemetryEnabled === false)).toBe(true);
  });
});

describe('DatabricksConnector foreignKeys', () => {
  /** One row as the informational-constraint query shapes it. */
  const fkRow = {
    from_catalog: 'sales',
    from_schema: 'public',
    from_table: 'orders',
    from_column: 'customer_id',
    to_catalog: 'sales',
    to_schema: 'public',
    to_table: 'customers',
    to_column: 'id',
  };

  it('queries information_schema per catalog and maps rows to edges', async () => {
    respond = (sql) =>
      sql.includes('referential_constraints') ? [fkRow] : [];

    const edges = await new DatabricksConnector().foreignKeys(config, [
      'sales.public.orders',
      'sales.public.customers',
    ]);

    const sql = statements();
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain('`sales`.information_schema.referential_constraints');
    expect(sql[0]).toContain('`sales`.information_schema.table_constraints');
    expect(sql[0]).toContain('`sales`.information_schema.key_column_usage');
    // Composite keys pair up column by column.
    expect(sql[0]).toContain('pk.ordinal_position = fk.ordinal_position');
    expect(edges).toEqual([
      {
        from: { entity: 'sales.public.orders', column: 'customer_id' },
        to: { entity: 'sales.public.customers', column: 'id' },
      },
    ]);
    // One shared client, session per catalog, everything closed.
    expect(clients).toHaveLength(1);
    expect(clients[0].sessions.every((s) => s.closed)).toBe(true);
    expect(clients[0].closed).toBe(true);
  });

  it('drops edges whose other end is not in the dataset', async () => {
    respond = (sql) =>
      sql.includes('referential_constraints') ? [fkRow] : [];

    const edges = await new DatabricksConnector().foreignKeys(config, [
      'sales.public.orders',
    ]);

    expect(edges).toEqual([]);
  });

  it('skips catalogs whose information_schema is unreadable', async () => {
    respond = (sql) => {
      if (!sql.includes('referential_constraints')) return [];
      if (sql.includes('`ops`')) throw new Error('PERMISSION_DENIED');
      return [fkRow];
    };

    const edges = await new DatabricksConnector().foreignKeys(config, [
      'sales.public.orders',
      'sales.public.customers',
      'ops.public.tickets',
    ]);

    expect(edges).toHaveLength(1);
    expect(clients[0].closed).toBe(true);
  });

  it('returns no edges when nothing is in scope', async () => {
    const edges = await new DatabricksConnector().foreignKeys(config, [
      'system.information_schema.tables',
      'bad-entity',
    ]);

    expect(clients).toHaveLength(0);
    expect(edges).toEqual([]);
  });
});
