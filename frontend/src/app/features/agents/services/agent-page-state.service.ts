import { Injectable, computed, signal } from '@angular/core';
import type { AgentTabId } from './agent-page.util';

/**
 * Unsaved edits on the agent page, so the app shell asks before leaving
 * (`Discard unsaved changes?`): the System Prompt being edited, and the
 * inline skill form of the Skills tab.
 */
@Injectable({ providedIn: 'root' })
export class AgentPageState {
  readonly promptDirty = signal(false);
  readonly skillDirty = signal(false);
  /**
   * A tab the next agent page opens on, asked for by a background task's
   * Open (the Evals tab); the page takes it once the agent has loaded.
   */
  readonly requestedTab = signal<AgentTabId | null>(null);
  readonly dirty = computed(() => this.promptDirty() || this.skillDirty());

  reset(): void {
    this.promptDirty.set(false);
    this.skillDirty.set(false);
  }
}
