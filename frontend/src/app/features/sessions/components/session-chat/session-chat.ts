import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, Copy } from 'lucide-angular';
import { SessionsApiService } from '../../services/sessions-api.service';
import {
  AnalysisReport,
  Session,
  PanelItemEvent,
  ReadinessPanelItem,
  ReadinessReportRef,
  VisualEvent,
} from '../../models/session.model';
import { ToastService } from '../../../../core/toast/toast.service';
import { slug } from '../../services/slug';
import {
  readinessPanelItemId,
  readinessPanelTitle,
} from '../../models/readiness.model';
import { AnswerView } from '../answer-view/answer-view';

/**
 * A past chat (past-chats R66): its transcript, read-only. Since 1.23.22
 * nothing starts or continues a chat, so there is no composer, no rating and
 * no clarification answer; the reader can still open a visual, a scorecard,
 * download a report, and copy a question.
 */
@Component({
  selector: 'app-session-chat',
  imports: [LucideAngularModule, AnswerView],
  templateUrl: './session-chat.html',
  styleUrl: './session-chat.scss',
})
export class SessionChat {
  readonly Copy = Copy;

  private readonly api = inject(SessionsApiService);
  private readonly toast = inject(ToastService);

  readonly session = input.required<Session>();
  readonly viewVisual = output<VisualEvent>();
  /** The reader opened a scorecard in the right panel (`panel-item`). */
  readonly panelItem = output<PanelItemEvent>();

  readonly messages = computed(() => this.session().messages);
  /** Job id whose report is being downloaded right now. */
  readonly reportDownloading = signal<string | null>(null);

  /** Chat-history navigator (Conductor-style tick strip). */
  readonly historyOpen = signal(false);
  readonly historyItems = computed(() =>
    this.messages()
      .map((message, index) => ({ message, index }))
      .filter(({ message }) => message.role === 'user'),
  );

  private readonly scroller = viewChild<ElementRef<HTMLDivElement>>('scroller');
  private syncedSessionId: string | null = null;

  constructor() {
    // Opening another past chat shows its end, as a transcript opens.
    effect(() => {
      const id = this.session().id;
      if (id === this.syncedSessionId) return;
      this.syncedSessionId = id;
      this.scrollToBottom();
    });
  }

  /** Save one report's markdown to disk. */
  downloadReport(report: AnalysisReport): void {
    if (this.reportDownloading()) return;
    this.reportDownloading.set(report.jobId);
    this.api.downloadDeepAnalysis(this.session().id, report.jobId).subscribe({
      next: (blob) => {
        this.reportDownloading.set(null);
        const name =
          slug(report.title) || `deep-analysis-${report.jobId.slice(0, 8)}`;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${name}.md`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        this.toast.success('Report downloaded');
      },
      error: (err) => {
        this.reportDownloading.set(null);
        this.toast.error(err?.error?.message ?? 'Report download failed');
      },
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

  scrollToMessage(index: number): void {
    this.historyOpen.set(false);
    const el = this.scroller()?.nativeElement.querySelector(`#msg-${index}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}
