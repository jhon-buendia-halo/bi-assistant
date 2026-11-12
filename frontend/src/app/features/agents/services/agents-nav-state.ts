import { Injectable, inject, signal } from '@angular/core';
import { ShellState } from '../../../core/shell/shell-state';
import { SessionsState } from '../../sessions/services/sessions-state';
import { AgentEditorService } from './agent-editor.service';
import { Agent } from './agents-api.service';

/**
 * The Agents area's navigation: which agent, skill or built-in skill is open
 * and the ways between the hub, the detail, the editors and the library. Every
 * way out of an editor asks about unsaved changes first (agents-evals R59).
 */
@Injectable({ providedIn: 'root' })
export class AgentsNavState {
  private readonly shell = inject(ShellState);
  private readonly sessions = inject(SessionsState);
  private readonly agentEditor = inject(AgentEditorService);

  /** Registry key of the agent open in the detail view. */
  readonly activeAgentKey = signal<string | null>(null);
  /** The user agent open in the editor; null = a new agent. */
  readonly editingAgentId = signal<string | null>(null);
  /** The built-in skill open in its editor. */
  readonly editingBuiltInName = signal<string | null>(null);
  /** The skill open in the skill editor; null = a new skill. */
  readonly editingSkillId = signal<string | null>(null);
  /** The built-in editor was opened from an agent's Skills tab. */
  private builtInFromAgent = false;

  openAgent(agent: Agent): void {
    if (!this.shell.confirmLeaveAgentEditor()) return;
    this.activeAgentKey.set(agent.key);
    this.shell.mainView.set('agent-detail');
  }

  /** An agent row on a workflow's page opens the agent's detail (R8). */
  openAgentByKey(key: string): void {
    if (!this.shell.confirmLeaveAgentEditor()) return;
    this.activeAgentKey.set(key);
    this.shell.mainView.set('agent-detail');
  }

  /** All agents, from an agent's page; asks about an unsaved edit first. */
  closeAgentDetail(): void {
    if (!this.shell.confirmLeaveAgentEditor()) return;
    this.shell.mainView.set('agents');
  }

  /** New agent on the hub, or Edit in a user agent's detail (R54). */
  openAgentEditor(agentId: string | null): void {
    if (!this.shell.confirmLeaveAgentEditor()) return;
    this.editingAgentId.set(agentId);
    this.shell.mainView.set('agent-editor');
  }

  /**
   * Back from the editor: to the agent's detail, or to the hub for an agent
   * that was never saved (R59).
   */
  closeAgentEditor(): void {
    if (!this.shell.confirmLeaveAgentEditor()) return;
    const id = this.agentEditor.agentId();
    if (id) {
      this.activeAgentKey.set(id);
      this.shell.mainView.set('agent-detail');
    } else {
      this.shell.mainView.set('agents');
    }
  }

  /** Skills on the hub, Back in the skill editor, or deleting a skill. */
  openSkillsLibrary(): void {
    if (!this.shell.confirmLeaveAgentEditor()) return;
    this.shell.mainView.set('skills');
  }

  /** New skill, or a row in the library. */
  openSkillEditor(skillId: string | null): void {
    this.editingSkillId.set(skillId);
    this.shell.mainView.set('skill-editor');
  }

  /** A built-in row in the library. */
  openBuiltInSkillEditor(name: string, fromAgent = false): void {
    if (fromAgent && !this.shell.confirmLeaveAgentEditor()) return;
    this.editingBuiltInName.set(name);
    this.builtInFromAgent = fromAgent;
    this.shell.mainView.set('builtin-skill-editor');
  }

  /** Back from the built-in editor: to the agent's page, or the library. */
  closeBuiltInSkillEditor(): void {
    if (this.builtInFromAgent && this.activeAgentKey()) {
      if (!this.shell.confirmLeaveAgentEditor()) return;
      this.shell.mainView.set('agent-detail');
      return;
    }
    this.openSkillsLibrary();
  }

  /**
   * Back to the hub after deleting a user agent. Its sessions now read
   * `<name> · agent deleted` (past-chats R59), so the list is reloaded.
   */
  onAgentDeleted(): void {
    this.shell.mainView.set('agents');
    this.sessions.loadSessions();
  }
}
