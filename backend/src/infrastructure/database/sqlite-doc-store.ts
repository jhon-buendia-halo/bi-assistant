import type { Database } from 'better-sqlite3';
import {
  compareBySort,
  DocFilter,
  DocStore,
  FindOptions,
  matchesFilter,
  UpdateOptions,
} from './doc-store';

interface Row {
  rid: number;
  doc: string;
}

/**
 * `DocStore` adapter over an embedded SQLite file (better-sqlite3), mirrored
 * from data-readiness-agent. One table per collection, each row a JSON
 * document; filters/sorts are evaluated in-process — a deliberate trade at
 * prototype scale. Timestamps (`createdAt` / `updatedAt`, ISO strings) are
 * maintained here to mirror Mongoose's `timestamps: true`.
 */
export class SqliteDocStore<T extends object> implements DocStore<T> {
  constructor(
    private readonly db: Database,
    private readonly table: string,
  ) {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS "${table}" (rid INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL)`,
      )
      .run();
  }

  insert(doc: T): Promise<T> {
    const now = new Date().toISOString();
    const stored = { ...doc, createdAt: now, updatedAt: now };
    this.db
      .prepare(`INSERT INTO "${this.table}" (doc) VALUES (?)`)
      .run(JSON.stringify(stored));
    return Promise.resolve(stored as T);
  }

  find(filter: DocFilter = {}, options?: FindOptions): Promise<T[]> {
    const docs = this.rows()
      .map((r) => r.parsed)
      .filter((d) => matchesFilter(d, filter));
    if (options?.sort) docs.sort(compareBySort(options.sort));
    return Promise.resolve(docs as T[]);
  }

  async findOne(filter: DocFilter, options?: FindOptions): Promise<T | null> {
    const all = await this.find(filter, options);
    return all[0] ?? null;
  }

  update(
    filter: DocFilter,
    patch: Partial<T>,
    options?: UpdateOptions,
  ): Promise<T | null> {
    const now = new Date().toISOString();
    const match = this.firstRow(filter);

    if (match) {
      if (options?.setOnInsertOnly) {
        return Promise.resolve(match.parsed as T);
      }
      const updated = { ...match.parsed, ...patch, updatedAt: now };
      this.db
        .prepare(`UPDATE "${this.table}" SET doc = ? WHERE rid = ?`)
        .run(JSON.stringify(updated), match.rid);
      return Promise.resolve(updated as T);
    }

    if (options?.upsert) {
      const inserted = { ...patch, createdAt: now, updatedAt: now };
      this.db
        .prepare(`INSERT INTO "${this.table}" (doc) VALUES (?)`)
        .run(JSON.stringify(inserted));
      return Promise.resolve(inserted as T);
    }

    return Promise.resolve(null);
  }

  unset(filter: DocFilter, field: string): Promise<T | null> {
    const match = this.firstRow(filter);
    if (!match) return Promise.resolve(null);
    const updated: Record<string, unknown> = {
      ...match.parsed,
      updatedAt: new Date().toISOString(),
    };
    delete updated[field];
    this.db
      .prepare(`UPDATE "${this.table}" SET doc = ? WHERE rid = ?`)
      .run(JSON.stringify(updated), match.rid);
    return Promise.resolve(updated as T);
  }

  deleteOne(filter: DocFilter): Promise<number> {
    const match = this.firstRow(filter);
    if (!match) return Promise.resolve(0);
    this.db.prepare(`DELETE FROM "${this.table}" WHERE rid = ?`).run(match.rid);
    return Promise.resolve(1);
  }

  deleteMany(filter: DocFilter): Promise<number> {
    const rids = this.rows()
      .filter((r) => matchesFilter(r.parsed, filter))
      .map((r) => r.rid);
    const del = this.db.prepare(`DELETE FROM "${this.table}" WHERE rid = ?`);
    for (const rid of rids) del.run(rid);
    return Promise.resolve(rids.length);
  }

  private rows(): Array<{ rid: number; parsed: Record<string, unknown> }> {
    const raw = this.db
      .prepare(`SELECT rid, doc FROM "${this.table}"`)
      .all() as Row[];
    return raw.map((r) => ({
      rid: r.rid,
      parsed: JSON.parse(r.doc) as Record<string, unknown>,
    }));
  }

  private firstRow(
    filter: DocFilter,
  ): { rid: number; parsed: Record<string, unknown> } | undefined {
    return this.rows().find((r) => matchesFilter(r.parsed, filter));
  }
}
