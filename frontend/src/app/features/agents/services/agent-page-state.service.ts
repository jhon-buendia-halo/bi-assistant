import { Injectable, computed, signal } from '@angular/core';

/**
 * Unsaved edits on the agent page, so the app shell asks before leaving
 * (`Discard unsaved changes?`): the System Prompt being edited, and the
 * inline skill form of the Skills tab.
 */
@Injectable({ providedIn: 'root' })
export class AgentPageState {
  readonly promptDirty = signal(false);
  readonly skillDirty = signal(false);
  readonly dirty = computed(() => this.promptDirty() || this.skillDirty());

  reset(): void {
    this.promptDirty.set(false);
    this.skillDirty.set(false);
  }
}
