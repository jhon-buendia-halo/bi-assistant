import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, inject, signal, viewChildren } from '@angular/core';
import {
  Download,
  LayoutDashboard,
  Loader2,
  LucideAngularModule,
} from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import { AdminApiService } from '../../services/admin-api.service';
import {
  attachmentName,
  defaultReportName,
  errorMessage,
} from '../../services/admin-format';
import { AdminOverviewTab } from '../admin-overview/admin-overview';

export type AdminTab = 'overview' | 'users' | 'roles';

export const ADMIN_TABS: readonly { key: AdminTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users & groups' },
  { key: 'roles', label: 'Roles & permissions' },
];

/** The message of a failed blob download, whose error body is a Blob. */
async function blobErrorMessage(error: unknown): Promise<string> {
  if (error instanceof HttpErrorResponse && error.error instanceof Blob) {
    try {
      const body = JSON.parse(await error.error.text()) as { message?: unknown };
      if (typeof body.message === 'string' && body.message) return body.message;
    } catch {
      // Not JSON: fall through to the generic message.
    }
    return 'Backend unreachable';
  }
  return errorMessage(error);
}

/**
 * The Admin area (admin R34-R38; ui.md 4.18.1): the header with the
 * selected tab's action, and the three tabs, Overview selected each time the
 * area opens. Each tab's screen is created when its tab is selected, so it
 * loads its data each time (R38).
 */
@Component({
  selector: 'app-admin-area',
  imports: [AdminOverviewTab, LucideAngularModule],
  templateUrl: './admin-area.html',
  host: { class: 'flex flex-col' },
})
export class AdminArea {
  readonly Download = Download;
  readonly LayoutDashboard = LayoutDashboard;
  readonly Loader2 = Loader2;
  readonly tabs = ADMIN_TABS;
  readonly selected = signal<AdminTab>('overview');
  readonly exporting = signal(false);

  private readonly api = inject(AdminApiService);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);

  private readonly tabButtons =
    viewChildren<ElementRef<HTMLButtonElement>>('tabButton');

  select(tab: AdminTab): void {
    this.selected.set(tab);
  }

  /** Arrow keys move between tabs; Home and End go to the ends. */
  onTabKeydown(event: KeyboardEvent, index: number): void {
    const last = this.tabs.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % this.tabs.length
        : event.key === 'ArrowLeft'
          ? (index + last) % this.tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    this.select(this.tabs[next].key);
    this.tabButtons()[next]?.nativeElement.focus();
  }

  /**
   * **Export report** (admin R48): downloads `GET /admin/overview/export`
   * and saves it under the name the server gives it.
   */
  exportReport(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.api.exportOverview().subscribe({
      next: (res) => {
        this.exporting.set(false);
        if (!res.body) return;
        const name =
          attachmentName(res.headers.get('Content-Disposition')) ??
          defaultReportName();
        this.save(res.body, name);
      },
      error: async (err) => {
        this.exporting.set(false);
        this.toast.error(await blobErrorMessage(err));
      },
    });
  }

  private save(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const link = this.document.createElement('a');
    link.href = url;
    link.download = name;
    this.document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}
