import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';
import { QueryInspector } from '../../../../shared/query-evidence/query-inspector/query-inspector';
import { QUERY_EVIDENCE_API } from '../../../../shared/query-evidence/query-evidence.model';
import { focusQueryOpener } from '../../../../shared/query-evidence/query-opener';
import {
  PREVIEW_GONE_MESSAGE,
  TryItInspector,
} from '../../services/try-it-inspector';

/**
 * The query inspector's sheet for Try it (ui.md 4.5.1): over the app's main
 * column, flush with the Details panel's left edge, at most 720 px. The app
 * shell places it in its (positioned) main column; the Try it panel, in the
 * Details panel, tells it which query is open through TryItInspector.
 */
@Component({
  selector: 'app-agent-try-it-sheet',
  imports: [QueryInspector, LucideAngularModule],
  providers: [{ provide: QUERY_EVIDENCE_API, useExisting: TryItInspector }],
  template: `
    @if (inspector.open(); as open) {
      <div
        data-testid="query-inspector-sheet"
        class="absolute inset-y-0 right-0 z-20 w-full max-w-[720px] border-l border-border bg-surface shadow-lg"
      >
        @if (inspector.expired()) {
          <div
            class="flex h-full flex-col gap-3 p-4"
            (keydown.escape)="close()"
          >
            <button
              #goneClose
              type="button"
              data-testid="query-inspector-close"
              aria-label="Close query inspector"
              class="btn-icon ml-auto"
              (click)="close()"
            >
              <lucide-angular [img]="X" [size]="16" />
            </button>
            <p
              role="alert"
              data-testid="agent-tryit-gone"
              class="m-0 text-[13px] text-fg-muted"
            >
              {{ goneMessage }}
            </p>
          </div>
        } @else {
          <app-query-inspector
            [message]="open.answer"
            [index]="open.index"
            (close)="close()"
            (navigate)="inspector.inspect($event)"
          />
        }
      </div>
    }
  `,
})
export class AgentTryItSheet {
  protected readonly inspector = inject(TryItInspector);
  protected readonly X = X;
  private readonly goneClose =
    viewChild<ElementRef<HTMLButtonElement>>('goneClose');
  protected readonly goneMessage = PREVIEW_GONE_MESSAGE;

  constructor() {
    // The expired message replaces the inspector: the focus stays inside the sheet.
    effect(() => this.goneClose()?.nativeElement.focus());
  }

  protected close(): void {
    focusQueryOpener(this.inspector.close());
  }
}
