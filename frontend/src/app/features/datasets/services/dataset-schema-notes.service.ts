import { Injectable, signal } from '@angular/core';
import { DatasetSchemaNote, SchemaLayer } from './datasets-api.service';

/**
 * Schema notes (layer + description) of the dataset being edited, keyed by
 * `catalog.schema` (BA-318). Shared by the catalog browser (load, tree badge,
 * save) and the details panel (editing). Kept in the page until Save dataset.
 */
@Injectable({ providedIn: 'root' })
export class DatasetSchemaNotesService {
  readonly notes = signal<ReadonlyMap<string, DatasetSchemaNote>>(new Map());

  schemaKey(catalogName: string, schemaName: string): string {
    return `${catalogName}.${schemaName}`;
  }

  get(key: string): DatasetSchemaNote | undefined {
    return this.notes().get(key);
  }

  /** Replace every note, e.g. when a dataset opens; `[]` or undefined clears. */
  load(notes: DatasetSchemaNote[] | undefined): void {
    this.notes.set(new Map((notes ?? []).map((n) => [n.key, { ...n }])));
  }

  clear(): void {
    this.notes.set(new Map());
  }

  setLayer(key: string, layer: SchemaLayer | ''): void {
    this.patch(key, { layer: layer || undefined });
  }

  setDescription(key: string, description: string): void {
    this.patch(key, { description });
  }

  /**
   * Notes to send with Save dataset: only schemas that still have an included
   * entity, descriptions trimmed, empty notes dropped.
   */
  toSave(includedTableKeys: Iterable<string>): DatasetSchemaNote[] {
    const schemas = new Set<string>();
    for (const t of includedTableKeys) {
      const parts = t.split('.');
      if (parts.length === 3) schemas.add(`${parts[0]}.${parts[1]}`);
    }
    const out: DatasetSchemaNote[] = [];
    for (const note of this.notes().values()) {
      if (!schemas.has(note.key)) continue;
      const description = (note.description ?? '').trim();
      if (!note.layer && !description) continue;
      out.push({
        key: note.key,
        ...(note.layer ? { layer: note.layer } : {}),
        ...(description ? { description } : {}),
      });
    }
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }

  private patch(key: string, change: Partial<DatasetSchemaNote>): void {
    const next = new Map(this.notes());
    const merged: DatasetSchemaNote = { ...(next.get(key) ?? { key }), ...change };
    if (!merged.layer) delete merged.layer;
    next.set(key, merged);
    this.notes.set(next);
  }
}
