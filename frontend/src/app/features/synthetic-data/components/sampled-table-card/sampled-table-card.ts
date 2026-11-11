import { Component, computed, input } from '@angular/core';
import {
  SampledColumn,
  SampledRelationship,
  SampledTable,
} from '../../models/synthetic-data.model';
import {
  methodChipText,
  methodTooltip,
  percent,
  rangeText,
  strategyChipText,
} from '../../models/synthetic-data.format';

const TOP_VALUES_SHOWN = 5;

/** One table of a sampled profile: method chip, error line, column rows. */
@Component({
  selector: 'app-sampled-table-card',
  templateUrl: './sampled-table-card.html',
})
export class SampledTableCard {
  readonly table = input.required<SampledTable>();
  readonly tables = input<SampledTable[]>([]);
  readonly relationships = input<SampledRelationship[]>([]);

  readonly methodText = computed(() => methodChipText(this.table()));
  readonly methodTip = computed(() => methodTooltip(this.table().method));

  readonly percent = percent;
  readonly rangeText = rangeText;

  strategy(column: SampledColumn): string {
    return strategyChipText(
      column,
      this.table(),
      this.relationships(),
      this.tables(),
    );
  }

  shownTop(column: SampledColumn): { value: string; fraction: number }[] {
    return (column.topValues ?? []).slice(0, TOP_VALUES_SHOWN);
  }

  moreTop(column: SampledColumn): number {
    return Math.max(0, (column.topValues?.length ?? 0) - TOP_VALUES_SHOWN);
  }
}
