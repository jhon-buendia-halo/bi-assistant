import { Component, effect, inject, input, signal } from '@angular/core';
import { FilePanelItem } from '../../models/session.model';
import { SessionsApiService } from '../../services/sessions-api.service';
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';

/** A workspace file the agent showed: `.md` as Markdown, others as monospace text. */
@Component({
  selector: 'app-panel-file-view',
  imports: [MarkdownPipe],
  template: `
    @if (loading()) {
      <p class="px-5 py-4 text-[12px] text-fg-muted">Loading file…</p>
    } @else if (error(); as message) {
      <p
        role="alert"
        class="m-4 rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-on-danger-soft"
      >
        {{ message }}
      </p>
    } @else if (isMarkdown()) {
      <div
        class="prose-dark h-full overflow-y-auto px-5 py-4 text-[13px]"
        [innerHTML]="text() | markdown"
      ></div>
    } @else {
      <pre
        class="m-0 h-full overflow-auto bg-surface-muted px-4 py-3 font-mono text-[12px] leading-5 whitespace-pre text-fg"
        >{{ text() }}</pre
      >
    }
  `,
})
export class PanelFileView {
  private readonly api = inject(SessionsApiService);

  readonly sessionId = input.required<string>();
  readonly item = input.required<FilePanelItem>();

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly text = signal('');

  protected isMarkdown(): boolean {
    return /\.(md|markdown)$/i.test(this.item().path);
  }

  constructor() {
    effect((onCleanup) => {
      const sessionId = this.sessionId();
      const itemId = this.item().id;
      this.loading.set(true);
      this.error.set(null);
      this.text.set('');
      const sub = this.api.getPanelItemFile(sessionId, itemId).subscribe({
        next: (res) => {
          this.text.set(res.text);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err?.error?.message ?? 'Could not load the file');
          this.loading.set(false);
        },
      });
      onCleanup(() => sub.unsubscribe());
    });
  }
}
