import { Component, computed, input, signal } from '@angular/core';
import {
  DataMode,
  JsonToken,
  SchemaNode,
  cellText,
  jsonTokens,
  schemaOf,
  tableOf,
} from './workflow-data-view.util';

const MODE_LABELS: Record<DataMode, string> = {
  json: 'JSON',
  table: 'Table',
  schema: 'Schema',
};

interface SchemaRow {
  name: string;
  type: string;
  depth: number;
}

function flatten(nodes: SchemaNode[], depth = 0): SchemaRow[] {
  return nodes.flatMap((n) => [
    { name: n.name, type: n.type, depth },
    ...flatten(n.children, depth + 1),
  ]);
}

/** A value as JSON, a table or an inferred schema, with a mode switch. */
@Component({
  selector: 'app-workflow-data-view',
  templateUrl: './workflow-data-view.html',
})
export class WorkflowDataView {
  readonly value = input<unknown>(undefined);
  /** The value was larger than 20 000 characters and was not kept. */
  readonly truncated = input(false);
  readonly modes = input<DataMode[]>(['json', 'table', 'schema']);
  readonly emptyText = input('');

  private readonly chosen = signal<DataMode | null>(null);

  readonly labels = MODE_LABELS;
  readonly tokenClass: Record<JsonToken['kind'], string> = {
    key: 'text-(--qti-context-skills)',
    string: 'text-(--qti-context-dataset)',
    number: 'text-(--qti-context-chat-history)',
    literal: 'text-(--qti-context-chat-history)',
    plain: '',
  };
  readonly hasValue = computed(
    () => this.value() !== undefined && this.value() !== null,
  );
  readonly table = computed(() => tableOf(this.value()));
  readonly tokens = computed(() =>
    this.hasValue() ? jsonTokens(this.value()) : [],
  );
  readonly schema = computed(() => flatten(schemaOf(this.value())));

  /** The modes the switch offers: Table only when the value has rows. */
  readonly available = computed(() =>
    this.modes().filter((m) => m !== 'table' || this.table() !== null),
  );
  readonly active = computed<DataMode>(() => {
    const chosen = this.chosen();
    const available = this.available();
    if (chosen && available.includes(chosen)) return chosen;
    return available[0] ?? 'json';
  });

  choose(mode: DataMode): void {
    this.chosen.set(mode);
  }

  cell(value: unknown): string {
    return cellText(value);
  }
}
