import { Injectable, computed, signal } from '@angular/core';
import {
  EMPTY_FILTERS,
  LlmCallFilters,
  PageSize,
} from '../models/llm-call.model';

/**
 * The LLM calls table's filters, page and page size (roadmap 1.21.14). App
 * wide, so they are kept while a call is open and on the way back.
 */
@Injectable({ providedIn: 'root' })
export class MonitoringStateService {
  readonly filters = signal<LlmCallFilters>({ ...EMPTY_FILTERS });
  readonly page = signal(1);
  readonly pageSize = signal<PageSize>(25);

  /** True when any filter is set (enables Clear filters). */
  readonly hasFilters = computed(() => {
    const filters = this.filters();
    return (Object.keys(EMPTY_FILTERS) as (keyof LlmCallFilters)[]).some(
      (key) => filters[key] !== EMPTY_FILTERS[key],
    );
  });

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
}
