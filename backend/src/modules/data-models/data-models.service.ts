/**
 * Orchestrates the data model DSL (ADR-0006): bootstrap on first save,
 * merge-on-resave for newly included tables (`mergeSnapshot`, review
 * finding 1), drift reporting, YAML-edited versions, revert, reference
 * resolution, and the metrics-panel sync (`syncMetric` / `removeMetric`)
 * `MetricsService` calls after every write to the legacy `metrics` store.
 *
 * Deliberately reads `DATASETS_STORE` / `METRICS_STORE` directly rather than
 * injecting `DatasetsService` / `MetricsService` — both of those modules
 * depend on this service (bootstrap-on-save, metrics-panel sync), so
 * injecting them back here would be a circular dependency. The store tokens
 * are the same seam every repository in the app already goes through.
 */
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  DATASETS_STORE,
  METRICS_STORE,
} from '../../infrastructure/database/doc-store';
import type { DocStore } from '../../infrastructure/database/doc-store';
import type { DatasetDoc } from '../datasets/repositories/datasets.repository';
import type { MetricDoc } from '../metrics/entities/metric.entity';
import {
  bindingAddress,
  bootstrapFromSnapshot,
  buildEntity,
  buildRelationships,
  deriveEntityNames,
  lastSegment,
  safeName,
  toModelMetric,
} from './bootstrap';
import { driftReport } from './drift';
import type { DriftReport } from './drift';
import {
  attachPositions,
  parseDataModelYaml,
  serializeDataModel,
} from './dsl/yaml';
import { resolveRef } from './dsl/references';
import {
  validateAgainstSnapshot,
  validateDataModel,
} from './schema/data-model.schema';
import type { SnapshotTable } from './schema/data-model.schema';
import type {
  Attribute,
  DataModel,
  Entity,
  Metric,
  ModelIssue,
  Relationship,
} from './entities/data-model.entity';
import {
  DataModelsRepository,
  type DataModelDoc,
  type DataModelVersion,
} from './repositories/data-models.repository';

/** A single `resolve()` result — one per requested ref, in request order. */
export interface ResolveResult {
  ref: string;
  resolved: boolean;
  kind?: 'entity' | 'attribute' | 'metric' | 'relationship';
  target?: unknown;
}

function toSnapshotTables(dataset: DatasetDoc): SnapshotTable[] {
  return (dataset.entities ?? []).map((entity) => ({
    table: entity.key,
    columns: entity.columns.map((column) => column.name),
  }));
}

@Injectable()
export class DataModelsService implements OnModuleInit {
  private readonly logger = new Logger(DataModelsService.name);

  constructor(
    private readonly repository: DataModelsRepository,
    @Inject(DATASETS_STORE)
    private readonly datasetsStore: DocStore<DatasetDoc>,
    @Inject(METRICS_STORE)
    private readonly metricsStore: DocStore<MetricDoc>,
  ) {}

  /**
   * Every existing dataset gets a model v1 with no user action (ADR-0006).
   * One dataset's bootstrap failing (an invalid snapshot, a storage hiccup)
   * must never take the rest of the app down with it — each is isolated in
   * its own try/catch, logged, and skipped (review finding 4).
   */
  async onModuleInit(): Promise<void> {
    const datasets = await this.datasetsStore.find({ name: { $exists: true } });
    let bootstrapped = 0;
    for (const dataset of datasets) {
      try {
        const existing = await this.repository.findByDataset(dataset.name);
        if (!existing) {
          await this.ensureBootstrapped(dataset);
          bootstrapped += 1;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to bootstrap data model for dataset "${dataset.name}": ${message}`,
        );
      }
    }
    if (bootstrapped) {
      this.logger.log(`Bootstrapped ${bootstrapped} data models`);
    }
  }

  async get(datasetName: string): Promise<DataModelDoc | null> {
    return this.repository.findByDataset(datasetName);
  }

  /**
   * The current version's `DataModel` for every dataset named, paired with
   * its dataset — exactly the shape `composeSessionModel` (ADR-0007) takes.
   * A dataset with no model yet (should not happen post-bootstrap, but a
   * session can still name a since-deleted dataset) is silently skipped
   * rather than failing the whole session's context.
   */
  async getCurrentModels(
    datasetNames: string[],
  ): Promise<{ dataset: string; model: DataModel }[]> {
    const docs = await Promise.all(
      datasetNames.map((name) => this.repository.findByDataset(name)),
    );
    const pairs: { dataset: string; model: DataModel }[] = [];
    docs.forEach((doc, i) => {
      if (!doc) return;
      const current = doc.versions.find(
        (v) => v.version === doc.currentVersion,
      );
      if (current) {
        pairs.push({ dataset: datasetNames[i], model: current.model });
      }
    });
    return pairs;
  }

  async getVersion(
    datasetName: string,
    version: number,
  ): Promise<DataModelVersion | null> {
    const doc = await this.repository.findByDataset(datasetName);
    return doc?.versions.find((v) => v.version === version) ?? null;
  }

  /** v1 from the physical snapshot — a no-op when a model already exists. */
  async ensureBootstrapped(dataset: DatasetDoc): Promise<DataModelDoc> {
    const existing = await this.repository.findByDataset(dataset.name);
    if (existing) return existing;

    const legacyMetrics = await this.metricsStore.find({});
    const model = this.requireValidModel(
      dataset.name,
      bootstrapFromSnapshot(dataset, legacyMetrics, 1),
    );
    const now = new Date().toISOString();
    const doc: DataModelDoc = {
      dataset: dataset.name,
      currentVersion: 1,
      versions: [
        {
          version: 1,
          createdAt: now,
          source: 'bootstrap',
          yaml: serializeDataModel(model),
          model,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    return (await this.repository.save(doc)) ?? doc;
  }

  /**
   * Compares the current version against a fresh snapshot and stores the
   * result as `lastDrift` — never creates a version (ADR-0006: "a changed
   * snapshot yields a drift report, not a new version").
   */
  async recordDrift(dataset: DatasetDoc): Promise<DriftReport> {
    const doc = await this.requireDoc(dataset.name);
    const current = this.currentVersionOf(doc);
    const report = driftReport(
      current.model,
      dataset,
      new Date().toISOString(),
    );
    await this.repository.save({ ...doc, lastDrift: report });
    return report;
  }

  /**
   * The last recorded report when a re-save produced one; otherwise computed
   * now against the stored snapshot, so a freshly bootstrapped dataset answers
   * with an empty report instead of a 404 the caller has to special-case.
   */
  async drift(datasetName: string): Promise<DriftReport> {
    const doc = await this.requireDoc(datasetName);
    if (doc.lastDrift) return doc.lastDrift;
    const dataset = await this.datasetsStore.findOne({ name: datasetName });
    if (!dataset) {
      throw new NotFoundException(`Dataset "${datasetName}" not found`);
    }
    return driftReport(
      this.currentVersionOf(doc).model,
      dataset,
      new Date().toISOString(),
    );
  }

  /**
   * A dataset re-save merge (review finding 1): always records a fresh
   * drift report (never auto-removes anything, however stale the current
   * version's attributes/tables have become), and — only when the snapshot
   * now includes tables with no bound entity yet — appends ONE new version
   * that adds just those entities (plus their relationships to/from what
   * already existed, and the shared metrics defined over them), leaving
   * every existing entity, attribute and metric untouched. No new tables,
   * nothing drifted structurally enough to add an entity -> no new version.
   */
  async mergeSnapshot(dataset: DatasetDoc): Promise<DataModelDoc> {
    await this.recordDrift(dataset);
    const doc = await this.requireDoc(dataset.name);
    const current = this.currentVersionOf(doc);

    const snapshotEntities = dataset.entities ?? [];
    const boundByTable = new Map<string, string>();
    for (const entity of current.model.entities) {
      const binding = entity.bindings[0];
      const address = binding ? bindingAddress(binding) : null;
      if (address) boundByTable.set(address.toLowerCase(), entity.name);
    }

    const unbound = snapshotEntities.filter(
      (snapshot) => !boundByTable.has(snapshot.key.toLowerCase()),
    );
    if (!unbound.length) return doc;

    // Name the new tables the same way a fresh bootstrap would (so a merge
    // and a from-scratch bootstrap of the same final table set agree), then
    // combine with the already-assigned names of existing entities so
    // relationships can be built across both.
    const derivedNames = deriveEntityNames(snapshotEntities);
    const nameByTableLower = new Map(boundByTable);
    const newNames = new Set<string>();
    for (const snapshot of unbound) {
      const name =
        derivedNames.get(snapshot.key) ?? safeName(lastSegment(snapshot.key));
      nameByTableLower.set(snapshot.key.toLowerCase(), name);
      newNames.add(name);
    }

    const attributesByEntityName = new Map<string, Attribute[]>(
      current.model.entities.map((e) => [e.name, e.attributes]),
    );
    const newEntities: Entity[] = unbound.map((snapshot) => {
      const name = nameByTableLower.get(snapshot.key.toLowerCase())!;
      const entity = buildEntity(dataset, snapshot, name);
      attributesByEntityName.set(name, entity.attributes);
      return entity;
    });

    // `<exact snapshot key> -> logical name`, covering old and new entities
    // together, so `buildRelationships` can see both directions: a new
    // entity's FK to something that already existed, and something that
    // already existed pointing at a newly-added table.
    const fullNameMap = new Map<string, string>();
    for (const snapshot of snapshotEntities) {
      const name = nameByTableLower.get(snapshot.key.toLowerCase());
      if (name) fullNameMap.set(snapshot.key, name);
    }
    const existingRelKeys = new Set(
      current.model.relationships.map((r) => `${r.from}->${r.to}`),
    );
    const newRelationships: Relationship[] = buildRelationships(
      snapshotEntities,
      fullNameMap,
    ).filter((rel) => {
      const touchesNew =
        newNames.has(rel.from.split('.')[0]) ||
        newNames.has(rel.to.split('.')[0]);
      return touchesNew && !existingRelKeys.has(`${rel.from}->${rel.to}`);
    });

    const legacyMetrics = await this.metricsStore.find({});
    const existingMetricNames = new Set(
      current.model.metrics.map((m) => m.name.toLowerCase()),
    );
    const newMetrics = legacyMetrics
      .filter((m) =>
        unbound.some(
          (snapshot) =>
            snapshot.key.toLowerCase() === (m.entity ?? '').toLowerCase(),
        ),
      )
      .filter((m) => !existingMetricNames.has(m.name.toLowerCase()))
      .filter((m) => !hasMetricName(doc.deletedMetricNames, m.name))
      .map((m) => {
        const name = nameByTableLower.get((m.entity ?? '').toLowerCase())!;
        const attributes = attributesByEntityName.get(name) ?? [];
        return toModelMetric(m, name, attributes);
      });

    const draft: DataModel = {
      ...current.model,
      entities: [...current.model.entities, ...newEntities],
      relationships: [...current.model.relationships, ...newRelationships],
      metrics: [...current.model.metrics, ...newMetrics],
    };

    return this.appendVersion(
      doc,
      draft,
      'bootstrap',
      `merged ${newEntities.length} new entities from the dataset snapshot`,
    );
  }

  /**
   * A fresh v+1 bootstrapped from the dataset's current snapshot, carrying
   * over the current version's metrics (union by name, current model wins)
   * so metrics a user added by hand survive a rebootstrap. A name the user
   * explicitly deleted through the model-metrics API (`deletedMetricNames`)
   * is removed again even though the legacy-store-derived `fresh` bootstrap
   * would otherwise re-include it — review finding 6: a rebootstrap must not
   * resurrect a metric the model has tombstoned.
   */
  async rebootstrap(datasetName: string): Promise<DataModelDoc> {
    const dataset = await this.datasetsStore.findOne({ name: datasetName });
    if (!dataset) {
      throw new NotFoundException(`Dataset "${datasetName}" not found`);
    }
    const doc = await this.repository.findByDataset(datasetName);
    if (!doc) return this.ensureBootstrapped(dataset);

    const legacyMetrics = await this.metricsStore.find({});
    const current = this.currentVersionOf(doc);
    const fresh = this.requireValidModel(
      datasetName,
      bootstrapFromSnapshot(dataset, legacyMetrics, 1),
    );
    const metricsByName = new Map(fresh.metrics.map((m) => [m.name, m]));
    for (const metric of current.model.metrics) {
      metricsByName.set(metric.name, metric);
    }
    for (const deletedName of doc.deletedMetricNames ?? []) {
      metricsByName.delete(deletedName);
    }

    return this.appendVersion(
      doc,
      { ...fresh, metrics: Array.from(metricsByName.values()) },
      'bootstrap',
    );
  }

  /**
   * Parses + validates the YAML (structural/semantic via `parseDataModelYaml`,
   * then against the dataset's live snapshot via `validateAgainstSnapshot`)
   * and appends a new version, or throws with located errors.
   */
  async saveYaml(
    datasetName: string,
    yaml: string,
  ): Promise<{ version: number }> {
    const doc = await this.requireDoc(datasetName);
    const model = await this.validateYamlForDataset(datasetName, yaml);
    const saved = await this.appendVersion(doc, model, 'user');
    return { version: saved.currentVersion };
  }

  /**
   * roadmap 1.2.3 — `POST /datasets/:name/model/import`: the same
   * validation path as `saveYaml` (one write path, one validator per
   * ADR-0006), but recorded as its own `source: 'import'` so the version
   * history can tell "typed/pasted in the editor" from "brought in from a
   * file" apart.
   */
  async importYaml(
    datasetName: string,
    yaml: string,
  ): Promise<{ version: number }> {
    const doc = await this.requireDoc(datasetName);
    const model = await this.validateYamlForDataset(datasetName, yaml);
    const saved = await this.appendVersion(doc, model, 'import');
    return { version: saved.currentVersion };
  }

  /** Shared by `saveYaml`/`importYaml`: parse, structural+semantic
   * validate, then validate against the dataset's live snapshot — the one
   * place both write paths can diverge from is their `source` tag. */
  private async validateYamlForDataset(
    datasetName: string,
    yaml: string,
  ): Promise<DataModel> {
    const parsed = parseDataModelYaml(yaml);
    if (!('model' in parsed)) {
      throw new BadRequestException({ ok: false, errors: parsed.issues });
    }

    const dataset = await this.datasetsStore.findOne({ name: datasetName });
    const snapshot = dataset ? toSnapshotTables(dataset) : [];
    const snapshotIssues = validateAgainstSnapshot(parsed.model, snapshot);
    if (snapshotIssues.length) {
      throw new BadRequestException({
        ok: false,
        errors: attachPositions(yaml, snapshotIssues),
      });
    }
    return parsed.model;
  }

  /**
   * roadmap 1.2.3 — `GET /datasets/:name/model/export`: hands back the
   * requested (or current) version's already-serialized YAML verbatim, so
   * the exported file is byte-identical to what `GET .../versions/:version`
   * would show, not a re-serialization that could drift from it.
   */
  async exportYaml(
    datasetName: string,
    version?: number,
  ): Promise<{ yaml: string; version: number }> {
    const doc = await this.requireDoc(datasetName);
    const chosen =
      version !== undefined
        ? doc.versions.find((v) => v.version === version)
        : this.currentVersionOf(doc);
    if (!chosen) {
      throw new NotFoundException(
        `Version ${version} not found for dataset "${datasetName}"`,
      );
    }
    return { yaml: chosen.yaml, version: chosen.version };
  }

  /**
   * roadmap 1.2.3 — `POST /datasets/:name/model/serialize`: the frontend's
   * structured forms build a plain `DataModel` object and need the exact
   * same YAML shape/key-order `saveYaml`/`exportYaml` produce (so a
   * structured edit's diff against the previous version stays small); this
   * is that one writer, exposed so the client never grows its own. Pure —
   * no dataset lookup, no persistence — but still runs the full structural
   * + semantic validation (review finding 12) so a malformed body fails
   * fast with the same `ModelIssue[]` shape every other write endpoint
   * uses, rather than silently coercing missing fields into an empty,
   * misleading YAML document the caller might mistake for a real one.
   */
  serializeModel(model: unknown): string {
    const validated = validateDataModel(model);
    if (!validated.model) {
      throw new BadRequestException({ ok: false, errors: validated.issues });
    }
    return serializeDataModel(validated.model);
  }

  // --- Model-scoped metrics (roadmap 1.2.3): the metrics panel's new
  // editor of record. Every write here goes straight into the model as a
  // `source: 'user'` version — no legacy `metrics` store involved — and
  // registers the metric's name in `localMetricNames` so a later legacy-panel
  // write (`syncMetric`/`removeMetric`, below) never stomps it. A delete
  // additionally tombstones the name in `deletedMetricNames` (review finding
  // 6) so `rebootstrap`/`mergeSnapshot`/`syncMetric` never resurrect a
  // metric the model explicitly removed just because the legacy store still
  // has one under that name. ---

  async listModelMetrics(datasetName: string): Promise<Metric[]> {
    const doc = await this.requireDoc(datasetName);
    return this.currentVersionOf(doc).model.metrics;
  }

  /**
   * All current-version metrics bound to any of `physicalEntities`
   * (`catalog.schema.table` / REST endpoint addresses), keyed by the
   * physical address — `MetricsService.definitionBlock` (review finding 1)
   * uses this so the governed-metrics prompt block reads the model, not the
   * legacy store, for any table a model has adopted. An address present in
   * the returned map (even with an empty array) means "a model binds this
   * table" — the caller should not also consult the legacy store for it.
   */
  async metricsBoundToEntities(
    physicalEntities: string[],
  ): Promise<Map<string, Metric[]>> {
    const result = new Map<string, Metric[]>();
    const wanted = new Set(physicalEntities.map((e) => e.toLowerCase()));
    if (wanted.size === 0) return result;

    const docs = await this.repository.list();
    for (const doc of docs) {
      const current = this.findCurrentVersion(doc);
      if (!current) continue;
      for (const entity of current.model.entities) {
        const binding = entity.bindings[0];
        const address = binding ? bindingAddress(binding) : null;
        if (!address || !wanted.has(address.toLowerCase())) continue;
        const metrics = current.model.metrics.filter(
          (m) => m.entity.toLowerCase() === entity.name.toLowerCase(),
        );
        result.set(address, [...(result.get(address) ?? []), ...metrics]);
      }
    }
    return result;
  }

  /** Every `sourceVerifiedQueryId` carried by a current-version model
   * metric, across every dataset — `MetricsService.candidates`/
   * `candidatesForDataset` (review finding 8) treat these as already
   * promoted regardless of which dataset's panel did the promoting. */
  async promotedVerifiedQueryIds(): Promise<Set<string>> {
    const docs = await this.repository.list();
    const ids = new Set<string>();
    for (const doc of docs) {
      const current = this.findCurrentVersion(doc);
      if (!current) continue;
      for (const metric of current.model.metrics) {
        if (metric.sourceVerifiedQueryId) ids.add(metric.sourceVerifiedQueryId);
      }
    }
    return ids;
  }

  async createModelMetric(
    datasetName: string,
    metric: Metric,
  ): Promise<{ version: number }> {
    const doc = await this.requireDoc(datasetName);
    const current = this.currentVersionOf(doc);
    const draft: DataModel = {
      ...current.model,
      metrics: [...current.model.metrics, metric],
    };
    const validated = this.validateMetricDraft(draft);
    const withLocal: DataModelDoc = {
      ...doc,
      localMetricNames: withMetricName(doc.localMetricNames, metric.name),
      // Recreating a previously-deleted name must not stay tombstoned —
      // the user just asked for it to exist again.
      deletedMetricNames: withoutMetricName(
        doc.deletedMetricNames,
        metric.name,
      ),
    };
    const saved = await this.appendVersion(
      withLocal,
      validated,
      'user',
      `metric ${metric.name} added`,
    );
    return { version: saved.currentVersion };
  }

  async updateModelMetric(
    datasetName: string,
    metricName: string,
    metric: Metric,
  ): Promise<{ version: number }> {
    const doc = await this.requireDoc(datasetName);
    const current = this.currentVersionOf(doc);
    const index = current.model.metrics.findIndex(
      (m) => m.name.toLowerCase() === metricName.toLowerCase(),
    );
    if (index === -1) {
      throw new NotFoundException(
        `Metric "${metricName}" not found on dataset "${datasetName}"`,
      );
    }
    const metrics = [...current.model.metrics];
    metrics[index] = metric;
    const draft: DataModel = { ...current.model, metrics };
    const validated = this.validateMetricDraft(draft);
    const withoutOldName = withoutMetricName(doc.localMetricNames, metricName);
    const withLocal: DataModelDoc = {
      ...doc,
      localMetricNames: withMetricName(withoutOldName, metric.name),
      deletedMetricNames: withoutMetricName(
        doc.deletedMetricNames,
        metric.name,
      ),
    };
    const saved = await this.appendVersion(
      withLocal,
      validated,
      'user',
      `metric ${metricName} updated`,
    );
    return { version: saved.currentVersion };
  }

  async deleteModelMetric(
    datasetName: string,
    metricName: string,
  ): Promise<{ version: number }> {
    const doc = await this.requireDoc(datasetName);
    const current = this.currentVersionOf(doc);
    if (
      !current.model.metrics.some(
        (m) => m.name.toLowerCase() === metricName.toLowerCase(),
      )
    ) {
      throw new NotFoundException(
        `Metric "${metricName}" not found on dataset "${datasetName}"`,
      );
    }
    const metrics = current.model.metrics.filter(
      (m) => m.name.toLowerCase() !== metricName.toLowerCase(),
    );
    const draft: DataModel = { ...current.model, metrics };
    // Validate like create/update (review finding 5) — deleting a metric
    // another metric's `ratio` numerator/denominator still points at must
    // be rejected with a clear error, not silently leave a dangling
    // reference.
    const validated = this.validateMetricDraft(draft);
    const withLocal: DataModelDoc = {
      ...doc,
      localMetricNames: withoutMetricName(doc.localMetricNames, metricName),
      deletedMetricNames: withMetricName(doc.deletedMetricNames, metricName),
    };
    const saved = await this.appendVersion(
      withLocal,
      validated,
      'user',
      `metric ${metricName} removed`,
    );
    return { version: saved.currentVersion };
  }

  /** Full-model structural+semantic validation (unique name, entity/of/
   * dimensions/where resolve, agg rules) for a metrics-panel write — reuses
   * the exact same checks a YAML save goes through, just without a source
   * text to attach a line/col to (the panel maps `path` back to a form
   * field instead). */
  private validateMetricDraft(draft: DataModel): DataModel {
    const validated = validateDataModel(draft);
    if (!validated.model) {
      throw new BadRequestException({ ok: false, errors: validated.issues });
    }
    return validated.model;
  }

  async revert(
    datasetName: string,
    version: number,
  ): Promise<{ currentVersion: number }> {
    const doc = await this.requireDoc(datasetName);
    const target = doc.versions.find((v) => v.version === version);
    if (!target) {
      throw new NotFoundException(
        `Version ${version} not found for dataset "${datasetName}"`,
      );
    }
    await this.repository.save({ ...doc, currentVersion: version });
    return { currentVersion: version };
  }

  async resolve(
    datasetName: string,
    refs: string[],
    version?: number,
  ): Promise<ResolveResult[]> {
    const doc = await this.requireDoc(datasetName);
    const chosen =
      version !== undefined
        ? doc.versions.find((v) => v.version === version)
        : this.currentVersionOf(doc);
    if (!chosen) {
      throw new NotFoundException(
        `Version ${version} not found for dataset "${datasetName}"`,
      );
    }
    return refs.map((ref) => {
      const resolved = resolveRef(chosen.model, ref);
      return resolved
        ? { ref, resolved: true, kind: resolved.kind, target: resolved.target }
        : { ref, resolved: false };
    });
  }

  async delete(datasetName: string): Promise<number> {
    return this.repository.delete(datasetName);
  }

  // --- Metrics-panel sync (called by `MetricsService` after every
  // create/update/delete against the legacy `metrics` store — the shared
  // store's write path, kept only for backward compatibility now that
  // roadmap 1.2.3 moves the panel onto the model directly; see that
  // module's header). One-directional: `DataModelsService` never reads the
  // legacy store except at bootstrap/merge time, and never calls back into
  // `MetricsService`.
  //
  // The merge rule as of 1.2.3: the model wins for any metric name it
  // manages itself (`localMetricNames`, written by the model-metrics API
  // above) — a legacy write of the same name is skipped on that model
  // entirely, rather than overwriting or deleting the model's own
  // definition. For every other name (nothing the model authored directly),
  // the legacy store stays authoritative and the mirror behaves exactly as
  // it did under ADR-0006/1.2.1. ---

  /**
   * Mirrors a metrics-panel write into every current model: first removes
   * any existing copy of this metric by name from every model (so renaming
   * the metric's physical entity leaves no stale copy on the old one),
   * then adds the converted metric to whichever models bind the metric's
   * (possibly new) physical table. Each affected model gets exactly one new
   * version, not one per removal and one per add — the two steps are
   * computed together before anything is persisted. No model binds the
   * table -> nothing to do, no error (a metric can exist before any dataset
   * includes its table). A model that manages this name itself
   * (`localMetricNames`) is skipped entirely — see the merge-rule note
   * above — and so is a model that has explicitly deleted this name
   * (`deletedMetricNames`, review finding 6): a legacy write must not
   * resurrect a metric the model's own panel removed.
   */
  async syncMetric(metric: MetricDoc): Promise<string[]> {
    const docs = await this.repository.list();
    const touched: string[] = [];
    const nameLower = metric.name.toLowerCase();
    const entityLower = (metric.entity ?? '').toLowerCase();

    for (const doc of docs) {
      const current = this.findCurrentVersion(doc);
      if (!current) continue;
      if (hasMetricName(doc.localMetricNames, metric.name)) continue;
      if (hasMetricName(doc.deletedMetricNames, metric.name)) continue;

      const withoutStale = current.model.metrics.filter(
        (m) => m.name.toLowerCase() !== nameLower,
      );
      const boundEntity = current.model.entities.find((e) => {
        const binding = e.bindings[0];
        const address = binding ? bindingAddress(binding) : null;
        return address?.toLowerCase() === entityLower;
      });
      const nextMetrics = boundEntity
        ? [
            ...withoutStale,
            toModelMetric(metric, boundEntity.name, boundEntity.attributes),
          ]
        : withoutStale;

      if (sameMetricNames(current.model.metrics, nextMetrics)) continue;
      await this.appendVersion(
        doc,
        { ...current.model, metrics: nextMetrics },
        'bootstrap',
        `metric ${metric.name} synced from the metrics panel`,
      );
      touched.push(doc.dataset);
    }
    return touched;
  }

  /** Mirrors a metrics-panel delete: removes `name` from every current
   * model that has it, one new version per model touched. A model that
   * manages this name itself (`localMetricNames`) is skipped — deleting an
   * unrelated legacy metric that happens to share a name must not take the
   * model's own definition down with it. */
  async removeMetric(name: string): Promise<string[]> {
    const docs = await this.repository.list();
    const touched: string[] = [];
    const nameLower = name.toLowerCase();

    for (const doc of docs) {
      const current = this.findCurrentVersion(doc);
      if (!current) continue;
      if (hasMetricName(doc.localMetricNames, name)) continue;
      if (
        !current.model.metrics.some((m) => m.name.toLowerCase() === nameLower)
      ) {
        continue;
      }
      const metrics = current.model.metrics.filter(
        (m) => m.name.toLowerCase() !== nameLower,
      );
      await this.appendVersion(
        doc,
        { ...current.model, metrics },
        'bootstrap',
        `metric ${name} removed from the metrics panel`,
      );
      touched.push(doc.dataset);
    }
    return touched;
  }

  // --- Shared helpers ---

  /** Logs and refuses to persist a bootstrap/merge result with validation
   * issues (review finding 4) rather than silently writing an invalid
   * model that would only fail later, confusingly, at query time. */
  private requireValidModel(
    datasetName: string,
    result: { model: DataModel; issues: ModelIssue[] },
  ): DataModel {
    if (result.issues.length) {
      const detail = result.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join('; ');
      this.logger.error(
        `Refusing to persist an invalid data model for dataset "${datasetName}": ${detail}`,
      );
      throw new BadRequestException({ ok: false, errors: result.issues });
    }
    return result.model;
  }

  private async requireDoc(datasetName: string): Promise<DataModelDoc> {
    const doc = await this.repository.findByDataset(datasetName);
    if (!doc) {
      throw new NotFoundException(`No data model for dataset "${datasetName}"`);
    }
    return doc;
  }

  private findCurrentVersion(doc: DataModelDoc): DataModelVersion | undefined {
    return doc.versions.find((v) => v.version === doc.currentVersion);
  }

  /** Same lookup as `findCurrentVersion`, for callers that already know a
   * current version must exist (just created or freshly bootstrapped). */
  private currentVersionOf(doc: DataModelDoc): DataModelVersion {
    const current = this.findCurrentVersion(doc);
    if (!current) {
      throw new NotFoundException(
        `Current version missing for dataset "${doc.dataset}"`,
      );
    }
    return current;
  }

  /**
   * Appends `model` (its `version`/`model` fields overridden to match the
   * new version number and dataset name) as the new current version, and
   * persists it. The one place every version-creating path funnels through.
   */
  private async appendVersion(
    doc: DataModelDoc,
    modelDraft: DataModel,
    source: DataModelVersion['source'],
    note?: string,
  ): Promise<DataModelDoc> {
    const nextVersion = doc.versions.length + 1;
    const model: DataModel = {
      ...modelDraft,
      version: nextVersion,
      model: doc.dataset,
    };
    const version: DataModelVersion = {
      version: nextVersion,
      createdAt: new Date().toISOString(),
      source,
      yaml: serializeDataModel(model),
      model,
      ...(note ? { note } : {}),
    };
    const updated: DataModelDoc = {
      ...doc,
      currentVersion: nextVersion,
      versions: [...doc.versions, version],
    };
    return (await this.repository.save(updated)) ?? updated;
  }
}

/** Metric-name-set equality — used to decide whether a sync actually
 * changed anything (skip creating a version when it did not). Content
 * changes (a relabel, a new expression) always produce a different object
 * reference and so are never mistaken for "unchanged" by this check; the
 * concern it exists for is purely "no entity bound the table, and the
 * metric was not present before either" — a true no-op. */
function sameMetricNames(
  before: DataModel['metrics'],
  after: DataModel['metrics'],
): boolean {
  if (before.length !== after.length) return false;
  const beforeByName = new Map(before.map((m) => [m.name, m]));
  return after.every((m) => {
    const prior = beforeByName.get(m.name);
    return prior !== undefined && JSON.stringify(prior) === JSON.stringify(m);
  });
}

/** Name-list lookup/mutation helpers shared by `localMetricNames` and
 * `deletedMetricNames` (roadmap 1.2.3's merge-rule flip and delete
 * tombstone, see `syncMetric`/`removeMetric`/the model-metrics methods
 * above) — case-insensitive, same as every other name comparison in this
 * module. Generic over which field they operate on: the two lists are the
 * same shape (a set of lowercase names) with different meanings. */
function hasMetricName(names: string[] | undefined, name: string): boolean {
  const wanted = name.toLowerCase();
  return (names ?? []).some((n) => n.toLowerCase() === wanted);
}

function withMetricName(names: string[] | undefined, name: string): string[] {
  const without = withoutMetricName(names, name);
  return [...without, name.toLowerCase()];
}

function withoutMetricName(
  names: string[] | undefined,
  name: string,
): string[] {
  const wanted = name.toLowerCase();
  return (names ?? []).filter((n) => n.toLowerCase() !== wanted);
}
