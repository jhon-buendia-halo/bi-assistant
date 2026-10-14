import { Component, computed, input } from '@angular/core';
import {
  chipClass,
  promptSegments,
} from '../../services/prompt-links';

/**
 * Read-only text with its `[[skill:…]]` and `[[tool:…]]` links shown as chips:
 * a skill `chip-info`, a tool `chip-neutral`, a link to something that does
 * not exist `chip-danger` (ADR-0023).
 */
@Component({
  selector: 'app-linked-text',
  template: `@for (segment of segments(); track $index) {@if (segment.kind === 'text') {<span>{{ segment.text }}</span>} @else {<span
          [class]="classes(segment.kind, segment.name)"
          [attr.data-link]="segment.kind + ':' + segment.name"
          [attr.title]="known().has(segment.kind + ':' + segment.name) ? null : 'Not found'"
          >{{ segment.name }}</span
        >}}`,
})
export class LinkedText {
  readonly text = input.required<string>();
  /** The names that exist, as `kind:name`; other links show as not found. */
  readonly known = input.required<ReadonlySet<string>>();

  protected readonly segments = computed(() => promptSegments(this.text()));

  protected classes(kind: 'skill' | 'tool', name: string): string {
    return chipClass(kind, name, this.known());
  }
}
