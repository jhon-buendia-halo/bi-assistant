import { Injectable, computed, signal } from '@angular/core';
import {
  EMPTY_FILTERS,
  LlmCallFilters,
  PageSize,
} from '../models/llm-call.model';
import {
  EMPTY_SESSION_FILTERS,
  SessionFilters,
} from '../models/session-flow.model';

export type MonitoringTab = 'calls' | 'sessions';

/** True when any key differs from its empty value. */
function differs<T extends object>(values: T, empty: T): boolean {
  return (Object.keys(empty) as (keyof T)[]).some(
    (key) => values[key] !== empty[key],
  );
}

/**
 * The Monitoring page's chosen tab and, per tab, its filters, page and page
 * size (roadmap 1.21.14, 1.21.16). App wide, so they are kept while a call
 * or a session is open and on the way back.
 */
@Injectable({ providedIn: 'root' })
export class MonitoringStateService {
  readonly tab = signal<MonitoringTab>('calls');

  // LLM calls tab
  readonly filters = signal<LlmCallFilters>({ ...EMPTY_FILTERS });
  readonly page = signal(1);
  readonly pageSize = signal<PageSize>(25);

  /** True when any filter is set (enables Clear filters). */
  readonly hasFilters = computed(() =>
    differs(this.filters(), EMPTY_FILTERS),
  );

  // Sessions tab
  readonly sessionFilters = signal<SessionFilters>({ ...EMPTY_SESSION_FILTERS });
  readonly sessionPage = signal(1);
  readonly sessionPageSize = signal<PageSize>(25);

  readonly hasSessionFilters = computed(() =>
    differs(this.sessionFilters(), EMPTY_SESSION_FILTERS),
  );

  setTab(tab: MonitoringTab): void {
    this.tab.set(tab);
  }

  /** Changes one filter and goes back to page 1. */
  setFilter<K extends keyof LlmCallFilters>(
    key: K,
    value: LlmCallFilters[K],
  ): void {
    this.filters.update((filters) => {
      const next = { ...filters, [key]: value };
      // Leaving Custom forgets its dates.
      if (key === 'range' && value !== 'custom') {
        next.from = '';
        next.to = '';
      }
      return next;
    });
    this.page.set(1);
  }

  clearFilters(): void {
    this.filters.set({ ...EMPTY_FILTERS });
    this.page.set(1);
  }

  setPageSize(size: PageSize): void {
    this.pageSize.set(size);
    this.page.set(1);
  }

  setPage(page: number): void {
    this.page.set(Math.max(1, page));
  }

  /** Changes one Sessions filter and goes back to page 1. */
  setSessionFilter<K extends keyof SessionFilters>(
    key: K,
    value: SessionFilters[K],
  ): void {
    this.sessionFilters.update((filters) => {
      const next = { ...filters, [key]: value };
      if (key === 'range' && value !== 'custom') {
        next.from = '';
        next.to = '';
      }
      return next;
    });
    this.sessionPage.set(1);
  }

  clearSessionFilters(): void {
    this.sessionFilters.set({ ...EMPTY_SESSION_FILTERS });
    this.sessionPage.set(1);
  }

  setSessionPageSize(size: PageSize): void {
    this.sessionPageSize.set(size);
    this.sessionPage.set(1);
  }

  setSessionPage(page: number): void {
    this.sessionPage.set(Math.max(1, page));
  }
}
