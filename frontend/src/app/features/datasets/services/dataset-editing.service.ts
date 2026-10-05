import { Injectable, signal } from '@angular/core';
import { Dataset } from './datasets-api.service';

/**
 * The saved dataset currently open in the catalog browser's edit mode (null
 * for "new dataset" or when nothing is being edited). `CatalogBrowser` sets
 * it on init and after every save, re-profile or description update;
 * `EntityDetails` reads it to merge persisted column profiles, references
 * and descriptions into the live catalog tree it renders from
 * `DatasetSelectionService`, without either component needing a direct
 * input/output wire through `app.ts`.
 */
@Injectable({ providedIn: 'root' })
export class DatasetEditingService {
  readonly dataset = signal<Dataset | null>(null);

  set(dataset: Dataset | null): void {
    this.dataset.set(dataset);
  }

  clear(): void {
    this.dataset.set(null);
  }
}
