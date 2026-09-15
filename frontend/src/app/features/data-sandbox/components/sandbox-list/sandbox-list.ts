import { Component, OnInit, inject, output, signal } from '@angular/core';
import {
  LucideAngularModule,
  EllipsisVertical,
  LayoutGrid,
  Loader2,
  Lock,
  Plus,
  Search,
  Trash2,
  Workflow,
} from 'lucide-angular';
import { Sandbox, SandboxApiService } from '../../services/sandbox-api.service';
import { ToastService } from '../../../../core/toast/toast.service';

interface SandboxSection {
  label: string;
  items: Sandbox[];
}

@Component({
  selector: 'app-sandbox-list',
  imports: [LucideAngularModule],
  templateUrl: './sandbox-list.html',
  styleUrl: './sandbox-list.scss',
})
export class SandboxList implements OnInit {
  readonly EllipsisVertical = EllipsisVertical;
  readonly LayoutGrid = LayoutGrid;
  readonly Loader2 = Loader2;
  readonly Lock = Lock;
  readonly Plus = Plus;
  readonly Search = Search;
  readonly Trash2 = Trash2;
  readonly Workflow = Workflow;

  private readonly api = inject(SandboxApiService);
  private readonly toast = inject(ToastService);

  readonly filters = ['All', 'Pinned', 'Yours', 'Shared with you'];
  readonly activeFilter = signal('All');
  readonly newSandbox = output<void>();
  readonly openSandbox = output<Sandbox>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly sections = signal<SandboxSection[]>([]);
  /** Name of the sandbox whose contextual menu is open. */
  readonly menuOpen = signal<string | null>(null);

  ngOnInit(): void {
    this.api.getSandboxes().subscribe({
      next: (res) => {
        this.sections.set(groupByMonth(res.sandboxes));
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
  }

  toggleMenu(name: string): void {
    this.menuOpen.set(this.menuOpen() === name ? null : name);
  }

  deleteSandbox(sandbox: Sandbox): void {
    this.menuOpen.set(null);
    this.api.deleteSandbox(sandbox.name).subscribe({
      next: (res) => {
        if (res.ok) {
          this.toast.success(res.message);
          this.sections.set(
            this.sections()
              .map((s) => ({
                ...s,
                items: s.items.filter((i) => i.name !== sandbox.name),
              }))
              .filter((s) => s.items.length > 0),
          );
        } else {
          this.toast.error(res.message);
        }
      },
      error: (err) => {
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  editedLabel(sandbox: Sandbox): string {
    const date = sandbox.updatedAt ? new Date(sandbox.updatedAt) : null;
    const when = date
      ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';
    return `Edited ${when} · ${sandbox.tables.length} entities`;
  }
}

/** Group sandboxes (already newest-first) into month sections. */
function groupByMonth(sandboxes: Sandbox[]): SandboxSection[] {
  const sections: SandboxSection[] = [];
  for (const sandbox of sandboxes) {
    const date = sandbox.updatedAt ? new Date(sandbox.updatedAt) : null;
    const label = date
      ? date.toLocaleDateString('en-US', { month: 'long', year: undefined })
      : 'Earlier';
    const last = sections[sections.length - 1];
    if (last && last.label === label) last.items.push(sandbox);
    else sections.push({ label, items: [sandbox] });
  }
  return sections;
}
