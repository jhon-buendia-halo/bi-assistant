import { Injectable, signal } from '@angular/core';
import {
  CatalogInfo,
  SchemaInfo,
  TableInfo,
} from '../../databricks/models/databricks.model';

export type SandboxSelection =
  | { kind: 'catalog'; catalog: CatalogInfo }
  | { kind: 'schema'; catalogName: string; schema: SchemaInfo }
  | {
      kind: 'table';
      catalogName: string;
      schemaName: string;
      table: TableInfo;
    };

/** Currently selected Databricks element, shown in the right panel. */
@Injectable({ providedIn: 'root' })
export class SandboxSelectionService {
  readonly selection = signal<SandboxSelection | null>(null);

  select(selection: SandboxSelection): void {
    this.selection.set(selection);
  }

  clear(): void {
    this.selection.set(null);
  }
}
