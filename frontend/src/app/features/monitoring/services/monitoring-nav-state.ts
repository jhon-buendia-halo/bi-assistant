import { Injectable, inject, signal } from '@angular/core';
import { ShellState } from '../../../core/shell/shell-state';

/** The Monitoring area's navigation: the open LLM call and session flow. */
@Injectable({ providedIn: 'root' })
export class MonitoringNavState {
  private readonly shell = inject(ShellState);

  /** The LLM call shown on the `llm-call` view (roadmap 1.21.15). */
  readonly activeLlmCallId = signal<string | null>(null);

  /**
   * The session page a call was opened from; null when it was opened from
   * the LLM calls table (its back control then reads Monitoring).
   */
  readonly llmCallFromSession = signal<string | null>(null);

  /** The session shown on the `monitoring-session` view (roadmap 1.21.16). */
  readonly activeMonitoringSessionId = signal<string | null>(null);

  /** Opens a call from the Monitoring table. */
  openLlmCall(id: string): void {
    this.llmCallFromSession.set(null);
    this.activeLlmCallId.set(id);
    this.shell.mainView.set('llm-call');
  }

  /** Opens a call from the session page; its back control returns there. */
  openLlmCallFromSession(id: string): void {
    this.llmCallFromSession.set(this.activeMonitoringSessionId());
    this.activeLlmCallId.set(id);
    this.shell.mainView.set('llm-call');
  }

  /** The call page's back control: to its session page, else the table. */
  backFromLlmCall(): void {
    const sessionId = this.llmCallFromSession();
    if (sessionId !== null) {
      this.activeMonitoringSessionId.set(sessionId);
      this.shell.mainView.set('monitoring-session');
      return;
    }
    this.shell.selectArea('monitoring');
  }

  /** Opens a session's execution flow from the Sessions tab. */
  openMonitoringSession(id: string): void {
    this.activeMonitoringSessionId.set(id);
    this.shell.mainView.set('monitoring-session');
  }

  /**
   * The session page's back control: the Monitoring page, on the Sessions
   * tab it was opened from (the tab is kept in MonitoringStateService).
   */
  backFromMonitoringSession(): void {
    this.shell.selectArea('monitoring');
  }
}
