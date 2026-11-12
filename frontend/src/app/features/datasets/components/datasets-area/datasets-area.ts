import { Component, inject, signal } from '@angular/core';
import { ShellState } from '../../../../core/shell/shell-state';
import { Dataset } from '../../services/datasets-api.service';
import { CatalogBrowser } from '../catalog-browser/catalog-browser';
import { DatasetList } from '../dataset-list/dataset-list';

/** The Datasets area: the dataset list and the catalog browser. */
@Component({
  selector: 'app-datasets-area',
  imports: [DatasetList, CatalogBrowser],
  templateUrl: './datasets-area.html',
  styles: ':host { display: contents; }',
})
export class DatasetsArea {
  readonly shell = inject(ShellState);
  /** Dataset being edited in the catalog browser; null = creating a new one. */
  readonly editingDataset = signal<Dataset | null>(null);

  openDatasetEditor(dataset: Dataset | null): void {
    if (!this.shell.confirmLeaveAgentEditor()) return;
    this.editingDataset.set(dataset);
    this.shell.mainView.set('dataset-new');
  }
}
