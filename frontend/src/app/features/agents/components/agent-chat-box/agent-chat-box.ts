import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  Loader2,
  LucideAngularModule,
  MessageSquarePlus,
  RotateCcw,
} from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { Session } from '../../../sessions/models/session.model';
import { SessionsApiService } from '../../../sessions/services/sessions-api.service';
import { SessionChat } from '../../../sessions/components/session-chat/session-chat';
import { startChatBlockedReason } from '../../services/agent-hub.util';
import { AgentDetail } from '../../services/agents-api.service';

/** The chat of a draft in the Chat Box (agents-evals R85). */
export type ChatBoxState =
  | { kind: 'starting' }
  | { kind: 'no-dataset'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; session: Session };

export const NO_DATASET_PREVIEW_MESSAGE =
  'Select at least one dataset to preview';

/**
 * The Chat Box tab (agents-evals R85, ui.md 4.5): a user agent's draft in a
 * preview session (in memory, never listed), discarded by New chat and when
 * the agent page closes; the Official assistant offers Start chat.
 */
@Component({
  selector: 'app-agent-chat-box',
  imports: [LucideAngularModule, SessionChat],
  templateUrl: './agent-chat-box.html',
  host: { class: 'flex min-h-0 flex-col' },
})
export class AgentChatBox implements OnInit, OnDestroy {
  readonly Loader2 = Loader2;
  readonly MessageSquarePlus = MessageSquarePlus;
  readonly RotateCcw = RotateCcw;

  private readonly sessionsApi = inject(SessionsApiService);

  readonly agent = input.required<AgentDetail>();
  /** True while the shell creates a session from the Official agent. */
  readonly starting = input(false);
  /** Start chat on the Official assistant; the shell opens the new session. */
  readonly startChat = output<AgentDetail>();
  /** Edit link of the no-dataset message. */
  readonly edit = output<AgentDetail>();

  readonly state = signal<ChatBoxState>({ kind: 'starting' });
  readonly isUserAgent = computed(() => this.agent().kind === 'user');
  readonly startBlockedReason = computed(() =>
    startChatBlockedReason(this.agent()),
  );

  private generation = 0;

  ngOnInit(): void {
    if (this.isUserAgent()) void this.start();
  }

  ngOnDestroy(): void {
    this.discard();
  }

  /** Discard the conversation and start an empty one. */
  newChat(): void {
    this.discard();
    void this.start();
  }

  sessionUpdated(session: Session): void {
    const state = this.state();
    if (state.kind === 'ready' && state.session.id === session.id) {
      this.state.set({ kind: 'ready', session });
    }
  }

  private async start(): Promise<void> {
    const generation = ++this.generation;
    this.state.set({ kind: 'starting' });
    try {
      const res = await firstValueFrom(
        this.sessionsApi.createPreview(this.agent().key),
      );
      if (generation !== this.generation) {
        // Discarded while it was being created.
        if (res.ok && res.session) this.deleteSession(res.session.id);
        return;
      }
      if (res.ok && res.session) {
        this.state.set({ kind: 'ready', session: res.session });
      } else if (res.message === NO_DATASET_PREVIEW_MESSAGE) {
        this.state.set({ kind: 'no-dataset', message: res.message });
      } else {
        this.state.set({ kind: 'error', message: res.message });
      }
    } catch (err) {
      if (generation !== this.generation) return;
      const error = err as { error?: { message?: string } };
      this.state.set({
        kind: 'error',
        message: error?.error?.message ?? 'Backend unreachable',
      });
    }
  }

  private discard(): void {
    this.generation++;
    const state = this.state();
    if (state.kind === 'ready') this.deleteSession(state.session.id);
    this.state.set({ kind: 'starting' });
  }

  private deleteSession(id: string): void {
    // Fire and forget: the backend also discards leftovers at its next start.
    this.sessionsApi.delete(id).subscribe({ error: () => undefined });
  }
}
