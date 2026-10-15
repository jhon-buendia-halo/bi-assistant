import { Component, input } from '@angular/core';
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';

/** A Markdown document the agent composed, rendered sanitised (ui.md 3.5). */
@Component({
  selector: 'app-panel-document-view',
  imports: [MarkdownPipe],
  template: `
    <div
      class="prose-dark h-full overflow-y-auto px-5 py-4 text-[13px]"
      [innerHTML]="markdown() | markdown"
    ></div>
  `,
})
export class PanelDocumentView {
  readonly markdown = input.required<string>();
}
