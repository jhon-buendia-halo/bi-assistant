import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  ChevronDown,
  Download,
  FileText,
  Layers,
  LucideAngularModule,
  Sparkles,
  Table2,
  BarChart3,
} from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import {
  DataPointSelection,
  InteractiveVisualization,
  PanelItem,
  PanelItemKind,
  Session,
  SessionActionResult,
} from '../../models/session.model';
import { SessionsApiService } from '../../services/sessions-api.service';
import { InteractiveVisualPanel } from '../interactive-visual-panel/interactive-visual-panel';
import { PanelDocumentView } from '../panel-document-view/panel-document-view';
import { PanelFileView } from '../panel-file-view/panel-file-view';
import { PanelTableView } from '../panel-table-view/panel-table-view';
import { slug } from '../../services/slug';

export type PanelDownloadFormat = 'pdf' | 'md';

/** Whether the item is Markdown: a document or a `.md` file, so it downloads as PDF or Markdown. */
export function panelIsMarkdown(item: PanelItem | null): boolean {
  return (
    item?.kind === 'document' ||
    (item?.kind === 'file' && /\.md$/i.test(item.path))
  );
}

/**
 * File name a downloaded item gets (mirrors the backend's attachment name).
 * A Markdown item downloads as PDF unless `format` says `md`.
 */
export function panelDownloadName(
  item: PanelItem,
  format?: PanelDownloadFormat,
): string | null {
  const pdf = panelIsMarkdown(item) && format !== 'md';
  switch (item.kind) {
    case 'file': {
      const name = item.path.split('/').pop() || 'file.txt';
      return pdf ? name.replace(/\.md$/i, '.pdf') : name;
    }
    case 'document':
      return `${slug(item.title) || 'document'}.${pdf ? 'pdf' : 'md'}`;
    case 'table':
      return `${slug(item.title) || 'table'}.csv`;
    default:
      return null;
  }
}

/** The tooltip of the Download button for an item, or null when none applies. */
export function panelDownloadTitle(item: PanelItem | null): string | null {
  if (panelIsMarkdown(item)) return 'Download PDF';
  switch (item?.kind) {
    case 'file':
      return 'Download file';
    case 'table':
      return 'Download (.csv)';
    default:
      return null;
  }
}

/**
 * The right panel of a session: shows what the agent chose to show (a file,
 * a document, a query result, a visual) with a menu of
 * everything shown so far. A visual renders the interactive visual panel.
 */
@Component({
  selector: 'app-session-panel',
  imports: [
    NgTemplateOutlet,
    LucideAngularModule,
    InteractiveVisualPanel,
    PanelDocumentView,
    PanelFileView,
    PanelTableView,
  ],
  templateUrl: './session-panel.html',
})
export class SessionPanel {
  readonly ChevronDown = ChevronDown;
  readonly Download = Download;
  readonly Layers = Layers;
  readonly Sparkles = Sparkles;
  readonly kindIcons = {
    file: FileText,
    document: FileText,
    table: Table2,
    visual: BarChart3,
  } satisfies Record<PanelItemKind, unknown>;

  private readonly api = inject(SessionsApiService);
  private readonly toast = inject(ToastService);

  readonly session = input.required<Session>();
  /** The item the panel shows; null until the agent shows something. */
  readonly item = input<PanelItem | null>(null);
  // The visual panel's own inputs, passed through unchanged.
  readonly visualization = input<InteractiveVisualization | null>(null);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  readonly downloading = input(false);

  readonly selectItem = output<PanelItem>();
  readonly downloadVisual = output<InteractiveVisualization>();
  readonly selectVersion = output<number>();
  readonly revertVersion = output<number>();
  readonly visualRefreshed = output<SessionActionResult>();
  readonly dataPointSelected = output<DataPointSelection>();

  readonly menuOpen = signal(false);
  readonly downloadingItem = signal(false);
  readonly downloadMenuOpen = signal(false);

  /** Everything shown in this session, newest first. */
  readonly history = computed(() =>
    [...(this.session().panelItems ?? [])].sort((a, b) =>
      b.shownAt.localeCompare(a.shownAt),
    ),
  );

  /** What the body renders: the item's kind, or the empty state. */
  readonly view = computed<PanelItemKind | 'empty'>(
    () => this.item()?.kind ?? 'empty',
  );

  readonly heading = computed(() => this.item()?.title ?? 'Panel');

  readonly downloadTitle = computed(() => panelDownloadTitle(this.item()));
  /** A Markdown item offers PDF and Markdown in a menu. */
  readonly markdownItem = computed(() => panelIsMarkdown(this.item()));

  pick(item: PanelItem): void {
    this.menuOpen.set(false);
    this.selectItem.emit(item);
  }

  formatTime(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  download(format?: PanelDownloadFormat): void {
    this.downloadMenuOpen.set(false);
    const item = this.item();
    const name = item ? panelDownloadName(item, format) : null;
    if (!item || !name || this.downloadingItem()) return;
    this.downloadingItem.set(true);
    const asFormat = panelIsMarkdown(item) ? (format ?? 'pdf') : undefined;
    this.api.downloadPanelItem(this.session().id, item.id, asFormat).subscribe({
      next: (blob) => {
        this.downloadingItem.set(false);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        this.toast.success(`Downloaded ${name}`);
      },
      error: () => {
        this.downloadingItem.set(false);
        this.toast.error('Download failed');
      },
    });
  }
}
