import { Injectable, signal } from '@angular/core';
import {
  CatalogInfo,
  SchemaInfo,
} from '../../datasources/models/datasource.model';
import { DatasetSelection } from './dataset-selection.service';

export type InclusionState = 'none' | 'partial' | 'full';

/**
 * Entities included in the dataset, tracked as fully-qualified table keys
 * (`catalog.schema.table`). Including a catalog/schema includes everything
 * underneath it; catalog/schema indicators are derived (full/partial/none).
 */
@Injectable({ providedIn: 'root' })
export class DatasetInclusionService {
  readonly included = signal<Set<string>>(new Set());

  tableKey(catalog: string, schema: string, table: string): string {
    return `${catalog}.${schema}.${table}`;
  }

  isTableIncluded(catalog: string, schema: string, table: string): boolean {
    return this.included().has(this.tableKey(catalog, schema, table));
  }

  schemaState(catalogName: string, schema: SchemaInfo): InclusionState {
    if (schema.tables.length === 0) return 'none';
    const set = this.included();
    let count = 0;
    for (const t of schema.tables) {
      if (set.has(this.tableKey(catalogName, schema.name, t.name))) count++;
    }
    if (count === 0) return 'none';
    return count === schema.tables.length ? 'full' : 'partial';
  }

  catalogState(catalog: CatalogInfo): InclusionState {
    const states = catalog.schemas
      .filter((s) => s.tables.length > 0)
      .map((s) => this.schemaState(catalog.name, s));
    if (states.length === 0) return 'none';
    if (states.every((s) => s === 'full')) return 'full';
    return states.some((s) => s !== 'none') ? 'partial' : 'none';
  }

  selectionState(sel: DatasetSelection): InclusionState {
    if (sel.kind === 'catalog') return this.catalogState(sel.catalog);
    if (sel.kind === 'schema')
      return this.schemaState(sel.catalogName, sel.schema);
    return this.isTableIncluded(sel.catalogName, sel.schemaName, sel.table.name)
      ? 'full'
      : 'none';
  }

  include(sel: DatasetSelection): void {
    this.mutate(sel, (set, key) => set.add(key));
  }

  remove(sel: DatasetSelection): void {
    this.mutate(sel, (set, key) => set.delete(key));
  }

  private mutate(
    sel: DatasetSelection,
    apply: (set: Set<string>, key: string) => unknown,
  ): void {
    const next = new Set(this.included());
    if (sel.kind === 'catalog') {
      for (const schema of sel.catalog.schemas) {
        for (const t of schema.tables) {
          apply(next, this.tableKey(sel.catalog.name, schema.name, t.name));
        }
      }
    } else if (sel.kind === 'schema') {
      for (const t of sel.schema.tables) {
        apply(next, this.tableKey(sel.catalogName, sel.schema.name, t.name));
      }
    } else {
      apply(
        next,
        this.tableKey(sel.catalogName, sel.schemaName, sel.table.name),
      );
    }
    this.included.set(next);
  }
}
