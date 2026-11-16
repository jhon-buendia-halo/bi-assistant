import { Injectable, inject, signal } from '@angular/core';
import { BackgroundTasksService } from '../../../core/background-tasks/background-tasks.service';
import type { BackgroundTask } from '../../../core/background-tasks/background-tasks.service';
import { ShellState } from '../../../core/shell/shell-state';
import type { DatasetTab } from '../components/catalog-browser/catalog-browser';
import { DatasourcesApiService } from '../../datasources/services/datasources-api.service';
import {
  DatasourceKind,
  InventoryResult,
} from '../../datasources/models/datasource.model';
import {
  Dataset,
  DatasetActionResult,
  DatasetEntitySnapshot,
  DatasetSchemaNote,
  DatasetsApiService,
} from './datasets-api.service';

export interface SaveDatasetRequest {
  name: string;
  tables: string[];
  entities: DatasetEntitySnapshot[];
  datasource: { id: string; kind: DatasourceKind; name: string };
  schemas?: DatasetSchemaNote[];
}

/** What the Datasets list shows on a row that is still being saved. */
export interface PendingSaveInfo {
  datasourceName: string;
  entityCount: number;
}

/**
 * Saving a dataset and loading a datasource inventory run as background
 * tasks (datasets spec, app-shell R58–R63): leaving the screen neither
 * cancels them nor loses their result.
 */
@Injectable({ providedIn: 'root' })
export class DatasetTasksService {
  readonly tasks = inject(BackgroundTasksService);
  private readonly datasetApi = inject(DatasetsApiService);
  private readonly datasourceApi = inject(DatasourcesApiService);
  private readonly shell = inject(ShellState);

  /** Dataset being edited in the catalog browser; null = creating a new one. */
  readonly editing = signal<Dataset | null>(null);
  /** Datasource the next new-dataset view opens on (set by Open on a task). */
  readonly preferredDatasourceId = signal<string | null>(null);
  /** The datasource the catalog browser is showing now, if it is shown. */
  readonly shownDatasourceId = signal<string | null>(null);
  /** Datasource name and entity count per dataset name being saved. */
  readonly pendingInfo = signal<ReadonlyMap<string, PendingSaveInfo>>(
    new Map(),
  );

  /** The editor tab to show when the catalog browser next opens a dataset. */
  readonly requestedTab = signal<DatasetTab | null>(null);

  /**
   * Opens a saved dataset in the editor on one tab (Open on an ontology or
   * profile task).
   */
  openDatasetTab(dataset: Dataset, tab: DatasetTab): void {
    if (!this.shell.confirmLeaveAgentEditor()) return;
    this.editing.set(dataset);
    this.requestedTab.set(tab);
    this.shell.settingsOpen.set(false);
    this.shell.mainView.set('dataset-new');
  }

  /** Starts saving a dataset (or returns the save already running). */
  save(req: SaveDatasetRequest): BackgroundTask {
    const name = req.name.trim();
    this.pendingInfo.set(
      new Map(this.pendingInfo()).set(name, {
        datasourceName: req.datasource.name,
        entityCount: req.tables.length,
      }),
    );
    return this.tasks.start<DatasetActionResult>({
      kind: 'dataset-save',
      key: name,
      title: `Saving dataset "${name}"`,
      work: () =>
        this.datasetApi.createDataset(
          name,
          req.tables,
          req.entities,
          { id: req.datasource.id, kind: req.datasource.kind },
          req.schemas,
        ),
      outcome: (res) => ({ ok: !!res?.ok, message: res?.message }),
      open: () => this.openSaved(req, name),
    });
  }

  /** Starts loading a datasource's inventory (or returns the running load). */
  loadInventory(
    id: string,
    datasourceName: string,
    refresh = false,
  ): BackgroundTask {
    return this.tasks.start<InventoryResult>({
      kind: 'inventory-refresh',
      key: id,
      title: `Loading the inventory of "${datasourceName}"`,
      work: () => this.datasourceApi.getInventory(id, { refresh }),
      outcome: (res) =>
        res?.ok
          ? { ok: true }
          : {
              ok: false,
              message: res?.message ?? 'Failed to load the inventory',
            },
      // The browser shows its own result; toast only failures, or a load
      // that ends while another screen (or datasource) is shown.
      toast: (task) =>
        task.status === 'failed' || this.shownDatasourceId() !== id,
      open: () => this.openInventory(id),
    });
  }

  private openSaved(req: SaveDatasetRequest, name: string): void {
    if (!this.shell.confirmLeaveAgentEditor()) return;
    this.editing.set({
      name,
      datasourceId: req.datasource.id,
      datasourceKind: req.datasource.kind,
      tables: req.tables,
      entities: req.entities,
      schemas: req.schemas,
    });
    this.shell.settingsOpen.set(false);
    this.shell.mainView.set('dataset-new');
  }

  private openInventory(id: string): void {
    if (!this.shell.confirmLeaveAgentEditor()) return;
    this.editing.set(null);
    this.preferredDatasourceId.set(id);
    this.shell.settingsOpen.set(false);
    this.shell.mainView.set('dataset-new');
  }
}
