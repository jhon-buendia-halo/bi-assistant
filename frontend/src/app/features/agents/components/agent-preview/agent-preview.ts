import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { Loader2, LucideAngularModule } from 'lucide-angular';
import { SessionChat } from '../../../sessions/components/session-chat/session-chat';
import { AgentEditorService } from '../../services/agent-editor.service';

/**
 * The agent editor's preview chat, the Details panel body while the editor
 * is open (agents-evals R60, R61, ui.md 4.5.1). It runs the saved draft in a
 * preview session that is never listed; the panel closing discards it.
 */
@Component({
  selector: 'app-agent-preview',
  imports: [LucideAngularModule, SessionChat],
  template: `
    @switch (editor.preview().kind) {
      @case ('ready') {
        @if (session(); as session) {
          <app-session-chat
            class="min-h-0 flex-1"
            [session]="session"
            [beforeSend]="editor.beforePreviewSend"
            (sessionUpdated)="editor.previewUpdated($event)"
          />
        }
      }
      @case ('no-dataset') {
        <p class="px-6 py-6 text-[13px] text-fg-muted">{{ message() }}</p>
      }
      @case ('error') {
        <p
          class="mx-6 my-6 rounded-md bg-danger-soft px-3 py-2.5 text-[13px] text-on-danger-soft"
        >
          {{ message() }}
        </p>
      }
      @default {
        <div class="flex items-center gap-2.5 px-6 py-6 text-fg-muted">
          <lucide-angular [img]="Loader2" [size]="16" class="animate-spin" />
          <span>Starting preview…</span>
        </div>
      }
    }
  `,
  host: { class: 'flex min-h-0 flex-col' },
})
export class AgentPreview implements OnInit, OnDestroy {
  readonly Loader2 = Loader2;
  readonly editor = inject(AgentEditorService);

  session() {
    const state = this.editor.preview();
    return state.kind === 'ready' ? state.session : null;
  }

  message(): string {
    const state = this.editor.preview();
    return state.kind === 'no-dataset' || state.kind === 'error'
      ? state.message
      : '';
  }

  ngOnInit(): void {
    // Opening the panel on the editor (Preview, or the expand button) shows
    // the preview chat; Preview has usually started it already.
    if (this.editor.preview().kind === 'idle') void this.editor.startPreview();
  }

  ngOnDestroy(): void {
    // Closing the panel, or leaving the editor, discards the preview (R61).
    this.editor.discardPreview();
  }
}
