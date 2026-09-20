import { Injectable, signal } from '@angular/core';
import {
  CatalogInfo,
  SchemaInfo,
  TableInfo,
} from '../../datasources/models/datasource.model';

export type DatasetSelection =
  | { kind: 'catalog'; catalog: CatalogInfo }
  | { kind: 'schema'; catalogName: string; schema: SchemaInfo }
  | {
      kind: 'table';
      catalogName: string;
      schemaName: string;
      table: TableInfo;
    };

/** Currently selected datasource element, shown in the right panel. */
@Injectable({ providedIn: 'root' })
export class DatasetSelectionService {
  readonly selection = signal<DatasetSelection | null>(null);

  select(selection: DatasetSelection): void {
    this.selection.set(selection);
  }

  clear(): void {
    this.selection.set(null);
  }
}
