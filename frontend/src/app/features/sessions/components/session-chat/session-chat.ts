import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, Copy } from 'lucide-angular';
import {
  ChatMessage,
  Session,
  PanelItemEvent,
  ReadinessPanelItem,
  ReadinessReportRef,
  VisualEvent,
} from '../../models/session.model';
import { ToastService } from '../../../../core/toast/toast.service';
import {
  readinessPanelItemId,
  readinessPanelTitle,
} from '../../models/readiness.model';
import {
  ChatHistoryItem,
  ChatHistoryNav,
} from '../../../../shared/components/chat-history-nav/chat-history-nav';
import { AnswerView } from '../answer-view/answer-view';
import { QUERY_EVIDENCE_API } from '../../../../shared/query-evidence/query-evidence.model';
import { QueryInspector } from '../../../../shared/query-evidence/query-inspector/query-inspector';
import {
  QueryOpener,
  focusQueryOpener,
  queryOpenerOf,
} from '../../../../shared/query-evidence/query-opener';
import {
  SessionMessageRef,
  SessionQueryEvidenceApi,
} from '../../services/session-query-evidence-api';
import { SessionsApiService } from '../../services/sessions-api.service';

/**
 * A past chat (past-chats R66): its transcript, read-only. Since 1.23.22
 * nothing starts or continues a chat, so there is no composer, no rating and
 * no clarification answer; the reader can still open a visual or a
 * scorecard, and copy a question.
 */
@Component({
  selector: 'app-session-chat',
  imports: [LucideAngularModule, AnswerView, QueryInspector, ChatHistoryNav],
  templateUrl: './session-chat.html',
  styleUrl: './session-chat.scss',
  providers: [
    SessionQueryEvidenceApi,
    { provide: QUERY_EVIDENCE_API, useExisting: SessionQueryEvidenceApi },
  ],
})
export class SessionChat {
  readonly Copy = Copy;

  private readonly toast = inject(ToastService);
  private readonly sessions = inject(SessionsApiService);
  private readonly evidenceApi = inject(SessionQueryEvidenceApi);

  readonly session = input.required<Session>();
  readonly viewVisual = output<VisualEvent>();
  /** The reader opened a scorecard in the right panel (`panel-item`). */
  readonly panelItem = output<PanelItemEvent>();

  /**
   * Messages a query-evidence call answered, by index, for the session they
   * belong to: the chat shows them in place of the session's own copy and
   * never changes its input. A refresh of the same session keeps them.
   */
  private readonly updated = signal<{
    sessionId: string;
    byIndex: Record<number, ChatMessage>;
  } | null>(null);

  readonly messages = computed(() => {
    const session = this.session();
    const updated = this.updated();
    return updated === null || updated.sessionId !== session.id
      ? session.messages
      : session.messages.map(
          (message, index) => updated.byIndex[index] ?? message,
        );
  });

  /** The query open in the sheet: the message (its index in the session) and the query. */
  private readonly openAt = signal<{ message: number; query: number } | null>(
    null,
  );
  protected readonly openQuery = computed(() => {
    const open = this.openAt();
    const answer = open === null ? undefined : this.messages()[open.message];
    return open !== null &&
      answer !== undefined &&
      answer.role === 'assistant' &&
      answer.data?.[open.query] !== undefined
      ? { ...open, answer }
      : null;
  });
  /** The messages whose evidence was already requested (api.md 144): once each. */
  private prepared = new Set<number>();
  private opener: QueryOpener | null = null;

  /** The user messages, for the chat-history navigation (ui.md). */
  readonly historyItems = computed<ChatHistoryItem[]>(() =>
    this.messages().flatMap((message, index) =>
      message.role === 'user'
        ? [{ id: String(index), label: message.content }]
        : [],
    ),
  );

  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');
  protected readonly scrollerElement = computed(
    () => this.scroller()?.nativeElement,
  );
  private syncedSessionId: string | null = null;

  constructor() {
    // Opening another past chat shows its end, as a transcript opens.
    effect(() => {
      const id = this.session().id;
      if (id === this.syncedSessionId) return;
      this.syncedSessionId = id;
      this.scrollToBottom();
      untracked(() => {
        this.openAt.set(null);
        this.opener = null;
        this.prepared = new Set();
        this.updated.set(null);
        this.bindEvidence();
        // The last answer's evidence is built when the chat opens, in the background.
        const messages = this.session().messages;
        for (let i = messages.length - 1; i >= 0; i--) {
          if (this.hasQueries(messages[i])) {
            this.prepareMessage(i);
            break;
          }
        }
      });
    });
  }

  /** An assistant message with data shows the answer view in inspector mode. */
  protected hasQueries(message: ChatMessage | undefined): boolean {
    return (
      message !== undefined &&
      message.role === 'assistant' &&
      (message.data?.length ?? 0) > 0
    );
  }

  /** The user message before an answer: the question it replies to. */
  protected questionBefore(index: number): string | null {
    const before = this.messages()[index - 1];
    return before?.role === 'user' ? before.content : null;
  }

  /** A chip or a row of one answer: its query opens in the sheet. */
  protected inspectQuery(message: number, query: number): void {
    if (this.openAt() === null) {
      const active = window.document.activeElement;
      this.opener = active === null ? null : queryOpenerOf(active);
    }
    this.openAt.set({ message, query });
    this.bindEvidence();
    this.prepareMessage(message);
  }

  protected closeQuery(): void {
    this.openAt.set(null);
    this.bindEvidence();
    focusQueryOpener(this.opener);
    this.opener = null;
  }

  /** Point the inspector's adapter at the open message. */
  private bindEvidence(): void {
    const open = this.openAt();
    this.evidenceApi.bind(
      open === null
        ? null
        : { sessionId: this.session().id, message: open.message },
      (ref, message) => this.showMessage(ref, message),
    );
  }

  /** Show the message a call answered, when its session is still the one shown. */
  private showMessage(ref: SessionMessageRef, message: ChatMessage): void {
    if (ref.sessionId !== this.session().id) return;
    const current = this.updated();
    this.updated.set({
      sessionId: ref.sessionId,
      byIndex: {
        ...(current?.sessionId === ref.sessionId ? current.byIndex : {}),
        [ref.message]: message,
      },
    });
  }

  /** Build one answer's evidence once, in the background; a failure is silent. */
  private prepareMessage(index: number): void {
    if (this.prepared.has(index)) return;
    this.prepared.add(index);
    const ref = { sessionId: this.session().id, message: index };
    this.sessions.prepareEvidence(ref.sessionId, index).subscribe({
      next: (response) => this.showMessage(ref, response.message),
      error: () => undefined,
    });
  }

  /**
   * Open scorecard: show the report's panel item (the saved one, else the
   * same item the orchestrator writes) and open the panel. Always a fresh
   * object, so a scorecard showing a past assessment comes back to this one.
   */
  openScorecard(ref: ReadinessReportRef): void {
    const id = readinessPanelItemId(ref.reportId);
    const saved = this.session().panelItems?.find(
      (item): item is ReadinessPanelItem =>
        item.kind === 'readiness' && item.id === id,
    );
    this.panelItem.emit({
      item: saved
        ? { ...saved }
        : {
            id,
            kind: 'readiness',
            title: readinessPanelTitle(ref.datasourceName),
            shownAt: ref.generatedAt,
            reportId: ref.reportId,
          },
    });
  }

  /** Copy a user message (an answer's copy button lives in `AnswerView`). */
  copyMessage(content: string): void {
    void navigator.clipboard.writeText(content).then(
      () => this.toast.success('Copied to clipboard'),
      () => this.toast.error('Copy failed'),
    );
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
