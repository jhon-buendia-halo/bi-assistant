import { Inject, Injectable } from '@nestjs/common';
import { CONNECTIONS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import { DatabricksConnection } from '../entities/databricks-connection.entity';

/** Single saved Databricks connection, upserted by kind. */
@Injectable()
export class ConnectionsRepository {
  constructor(
    @Inject(CONNECTIONS_STORE)
    private readonly store: DocStore<DatabricksConnection>,
  ) {}

  get(): Promise<DatabricksConnection | null> {
    return this.store.findOne({ kind: 'databricks' });
  }

  save(
    connection: Omit<DatabricksConnection, 'kind'>,
  ): Promise<DatabricksConnection | null> {
    return this.store.update(
      { kind: 'databricks' },
      { kind: 'databricks', ...connection },
      { upsert: true },
    );
  }
}
