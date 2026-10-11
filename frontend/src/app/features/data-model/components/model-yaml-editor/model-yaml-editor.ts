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
import { LucideAngularModule, AlertTriangle, Loader2, Save } from 'lucide-angular';
import { DataModelApiService } from '../../services/data-model-api.service';
import { ModelIssue } from '../../models/data-model.model';
import { ToastService } from '../../../../core/toast/toast.service';

/**
 * Raw YAML editing (brief §2, `model-yaml-editor`): a `<textarea>` with a
 * synced line-number gutter, a 400 response's `ModelIssue[]` rendered as a
 * clickable error list, and "Save as new version" disabled until the text
 * actually differs from the loaded version. Deliberately a plain
 * `<textarea>` rather than a code-editor dependency — the brief calls for
 * line/column errors and a caret jump, not syntax highlighting.
 */
@Component({
  selector: 'app-model-yaml-editor',
  imports: [LucideAngularModule],
  templateUrl: './model-yaml-editor.html',
  styleUrl: './model-yaml-editor.scss',
})
export class ModelYamlEditor {
  readonly AlertTriangle = AlertTriangle;
  readonly Loader2 = Loader2;
  readonly Save = Save;

  private readonly api = inject(DataModelApiService);
  private readonly toast = inject(ToastService);

  readonly datasetName = input.required<string>();
  readonly yaml = input.required<string>();
  /** Emits the new current version on a successful save. */
  readonly saved = output<number>();

  private readonly textarea =
    viewChild<ElementRef<HTMLTextAreaElement>>('textareaEl');
  private readonly gutter = viewChild<ElementRef<HTMLDivElement>>('gutterEl');

  readonly text = signal('');
  readonly saving = signal(false);
  readonly errors = signal<ModelIssue[]>([]);
  /** Line highlighted by clicking an error, cleared once the text changes. */
  readonly highlightedLine = signal<number | null>(null);

  readonly lineNumbers = computed(() => {
    const count = this.text().split('\n').length;
    return Array.from({ length: count }, (_, i) => i + 1);
  });

  readonly dirty = computed(() => this.text() !== this.yaml());
  readonly canSave = computed(() => this.dirty() && !this.saving());

  constructor() {
    // Re-sync whenever the parent loads a different version's yaml (e.g.
    // after a revert) — but not on every keystroke, since `text` is this
    // component's own editable copy.
    effect(() => {
      this.text.set(this.yaml());
      this.errors.set([]);
      this.highlightedLine.set(null);
    });
  }

  onInput(value: string): void {
    this.text.set(value);
    this.highlightedLine.set(null);
  }

  /** Keeps the line-number gutter's scroll position matched to the
   * textarea's — the gutter is a plain `<div>`, not part of the same
   * scrollable element, so nothing syncs them automatically. */
  onScroll(el: HTMLTextAreaElement): void {
    const gutterEl = this.gutter()?.nativeElement;
    if (gutterEl) gutterEl.scrollTop = el.scrollTop;
  }

  save(): void {
    if (!this.canSave()) return;
    this.saving.set(true);
    this.errors.set([]);
    this.api.putYaml(this.datasetName(), this.text()).subscribe({
      next: (res) => {
        this.saving.set(false);
        if (!res.ok || res.version === undefined) {
          this.errors.set(res.errors ?? []);
          return;
        }
        this.toast.success(`Saved as version ${res.version}`);
        this.saved.emit(res.version);
      },
      error: (err) => {
        this.saving.set(false);
        const body = err?.error as { errors?: ModelIssue[] } | undefined;
        if (body?.errors) {
          this.errors.set(body.errors);
        } else {
          this.toast.error(err?.error?.message ?? 'Backend unreachable');
        }
      },
    });
  }

  /** Jumps the caret to an error's line/col and scrolls it into view —
   * approximated from the textarea's own line height since a plain
   * `<textarea>` has no per-line DOM nodes to measure directly. */
  jumpToError(issue: ModelIssue): void {
    if (issue.line === undefined) return;
    this.highlightedLine.set(issue.line);
    const el = this.textarea()?.nativeElement;
    if (!el) return;

    const lines = this.text().split('\n');
    const lineIndex = Math.max(0, Math.min(issue.line - 1, lines.length - 1));
    const col = Math.max(0, (issue.col ?? 1) - 1);
    const offset =
      lines.slice(0, lineIndex).reduce((sum, l) => sum + l.length + 1, 0) +
      col;

    el.focus();
    el.setSelectionRange(offset, offset + (lines[lineIndex]?.length ? 1 : 0));
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight || '18');
    el.scrollTop = Math.max(0, (lineIndex - 3) * lineHeight);
  }
}
