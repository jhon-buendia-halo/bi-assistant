import { Component, computed, input, output } from '@angular/core';
import { ChatMessage } from '../../../features/sessions/models/session.model';
import { coverageLine, queryRows } from '../query-labels';

/**
 * Under an answer in a host that shows the query inspector: the coverage line
 * and one row per query. A chip or a row asks the host to open that query.
 */
@Component({
  selector: 'app-query-evidence-summary',
  templateUrl: './query-evidence-summary.html',
})
export class QueryEvidenceSummary {
  readonly message = input.required<ChatMessage>();
  /** The index of the query (into the message's `data`) to inspect. */
  readonly inspect = output<number>();

  readonly rows = computed(() => queryRows(this.message()));
  readonly line = computed(() => coverageLine(this.message()));

  chipClass(tone: string | undefined): string {
    return tone ? `chip chip-${tone} shrink-0` : 'chip shrink-0';
  }
}
