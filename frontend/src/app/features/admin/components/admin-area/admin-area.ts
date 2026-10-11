import { Component, ElementRef, signal, viewChildren } from '@angular/core';
import { LayoutDashboard, LucideAngularModule } from 'lucide-angular';

export type AdminTab = 'overview' | 'users' | 'roles';

export const ADMIN_TABS: readonly { key: AdminTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users & groups' },
  { key: 'roles', label: 'Roles & permissions' },
];

/**
 * The Admin area's frame (admin R34, R35; ui.md 4.18.1): the header and the
 * three tabs, Overview selected each time the area opens. The tabs' screens
 * arrive with BA-164 (Overview), BA-165/BA-166 (Users & groups) and BA-167
 * (Roles & permissions), each with its header action (admin R37).
 */
@Component({
  selector: 'app-admin-area',
  imports: [LucideAngularModule],
  templateUrl: './admin-area.html',
  host: { class: 'flex flex-col' },
})
export class AdminArea {
  readonly LayoutDashboard = LayoutDashboard;
  readonly tabs = ADMIN_TABS;
  readonly selected = signal<AdminTab>('overview');

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
}
