import { Component, computed, effect, inject, input, signal } from '@angular/core';
import {
  LucideAngularModule,
  ClipboardCopy,
  FileText,
  Loader2,
  TriangleAlert,
} from 'lucide-angular';
import { AgentsApiService } from '../../services/agents-api.service';
import { ToastService } from '../../../../core/toast/toast.service';
import {
  RunLogDiff,
  diffFlips,
  diffHeadline,
  diffNotComparableReasons,
  formatRate,
  orderedCategoryDeltas,
} from '../../models/eval.model';

/** The five levers the improvement loop pulls (`docs/evals/change-log.md`). */
const LEVER_OPTIONS = [
  'L1 — model & mode',
  'L2 — context',
  'L3 — tools & guards',
  'L4 — pipeline',
  'L5 — prompt',
] as const;

/**
 * Compares two run-log files: the pass^k headline, a not-comparable warning
 * when the two runs aren't like-for-like, per-category deltas worst-first,
 * verdict flips with SQL side by side, and a "draft a change-log entry" form
 * over the same pair. Self-contained — it fetches its own diff from
 * `agentKey`/`fileA`/`fileB` rather than being handed one, so it can be
 * reused wherever two runs need comparing.
 */
@Component({
  selector: 'app-eval-run-compare',
  imports: [LucideAngularModule],
  templateUrl: './eval-run-compare.html',
  styleUrl: './eval-run-compare.scss',
})
export class EvalRunCompare {
  readonly ClipboardCopy = ClipboardCopy;
  readonly FileText = FileText;
  readonly Loader2 = Loader2;
  readonly TriangleAlert = TriangleAlert;

  readonly leverOptions = LEVER_OPTIONS;

  private readonly api = inject(AgentsApiService);
  private readonly toast = inject(ToastService);

  readonly agentKey = input.required<string>();
  readonly fileA = input.required<string>();
  readonly fileB = input.required<string>();

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly diff = signal<RunLogDiff | null>(null);
  readonly markdown = signal<string>('');

  readonly headline = computed(() => {
    const diff = this.diff();
    return diff ? diffHeadline(diff) : '';
  });

  readonly notComparableReasons = computed(() => {
    const diff = this.diff();
    return diff ? diffNotComparableReasons(diff) : [];
  });

  readonly orderedCategories = computed(() => {
    const diff = this.diff();
    return diff ? orderedCategoryDeltas(diff) : [];
  });

  readonly flips = computed(() => {
    const diff = this.diff();
    return diff ? diffFlips(diff) : [];
  });

  readonly formatRate = formatRate;

  /** Expanded case ids — SQL side-by-side is collapsible per row. */
  readonly expandedFlips = signal<Set<string>>(new Set());

  toggleFlip(id: string): void {
    const next = new Set(this.expandedFlips());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expandedFlips.set(next);
  }

  isFlipExpanded(id: string): boolean {
    return this.expandedFlips().has(id);
  }

  /* ---- Draft change-log entry ----------------------------------------- */

  readonly lever = signal<string>('');
  readonly change = signal('');
  readonly why = signal('');
  readonly draftLoading = signal(false);
  readonly draftError = signal<string | null>(null);
  readonly draftMarkdown = signal<string | null>(null);
  readonly appendedTo = signal<string | null>(null);
  readonly appendLoading = signal(false);
  readonly appendError = signal<string | null>(null);

  readonly canDraft = computed(
    () => this.lever().trim() !== '' && this.change().trim() !== '' && this.why().trim() !== '',
  );

  constructor() {
    effect(() => {
      const key = this.agentKey();
      const a = this.fileA();
      const b = this.fileB();
      if (!a || !b) return;
      this.load(key, a, b);
    });
  }

  private load(key: string, a: string, b: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.diff.set(null);
    this.draftMarkdown.set(null);
    this.appendedTo.set(null);
    this.appendError.set(null);
    this.api.compareRunLogs(key, a, b).subscribe({
      next: (res) => {
        this.loading.set(false);
        if (!res.ok || !res.diff) {
          this.error.set(res.message ?? 'Could not compare these runs');
          return;
        }
        this.diff.set(res.diff);
        this.markdown.set(res.markdown ?? '');
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  onLeverChange(event: Event): void {
    this.lever.set((event.target as HTMLSelectElement).value);
  }

  onChangeInput(event: Event): void {
    this.change.set((event.target as HTMLTextAreaElement).value);
  }

  onWhyInput(event: Event): void {
    this.why.set((event.target as HTMLTextAreaElement).value);
  }

  /** Generates the markdown preview — never appends it. */
  preview(): void {
    if (!this.canDraft() || this.draftLoading()) return;
    this.draftLoading.set(true);
    this.draftError.set(null);
    this.appendedTo.set(null);
    this.appendError.set(null);
    this.api
      .draftChangeLog(this.agentKey(), {
        a: this.fileA(),
        b: this.fileB(),
        lever: this.lever(),
        change: this.change(),
        why: this.why(),
        append: false,
      })
      .subscribe({
        next: (res) => {
          this.draftLoading.set(false);
          if (!res.ok || !res.markdown) {
            this.draftError.set(res.message ?? 'Could not draft the entry');
            return;
          }
          this.draftMarkdown.set(res.markdown);
        },
        error: (err) => {
          this.draftLoading.set(false);
          this.draftError.set(err?.error?.message ?? 'Backend unreachable');
        },
      });
  }

  /**
   * Appends the previewed entry to `docs/evals/change-log.md`. Only reachable
   * once a preview exists (the template gates the button on `draftMarkdown()`
   * being set), and the outcome is read off the response rather than assumed:
   * `appendedTo` present means the backend found a checkout to write into;
   * absent means it could not (a packaged app has no checkout) and the text
   * stays in the preview for a manual copy.
   */
  append(): void {
    if (!this.draftMarkdown() || this.appendLoading()) return;
    this.appendLoading.set(true);
    this.appendError.set(null);
    this.api
      .draftChangeLog(this.agentKey(), {
        a: this.fileA(),
        b: this.fileB(),
        lever: this.lever(),
        change: this.change(),
        why: this.why(),
        append: true,
      })
      .subscribe({
        next: (res) => {
          this.appendLoading.set(false);
          if (!res.ok) {
            this.appendError.set(res.message ?? 'Could not append the entry');
            return;
          }
          if (res.markdown) this.draftMarkdown.set(res.markdown);
          if (res.appendedTo) {
            this.appendedTo.set(res.appendedTo);
            this.toast.success(`Appended to ${res.appendedTo}`);
          } else {
            this.appendError.set(
              'No checkout found on this backend — copy the text instead.',
            );
          }
        },
        error: (err) => {
          this.appendLoading.set(false);
          this.appendError.set(err?.error?.message ?? 'Backend unreachable');
        },
      });
  }

  copyMarkdown(): void {
    const text = this.draftMarkdown();
    if (!text) return;
    navigator.clipboard?.writeText(text).then(
      () => this.toast.success('Copied to clipboard'),
      () => this.toast.error('Could not copy — select and copy manually'),
    );
  }
}
