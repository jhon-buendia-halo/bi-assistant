import { Component, inject } from '@angular/core';
import { ShellState } from '../../../../core/shell/shell-state';
import { WorkflowsNavState } from '../../../workflows/services/workflows-nav-state';
import { AgentsNavState } from '../../services/agents-nav-state';
import { AgentDetail } from '../agent-detail/agent-detail';
import { AgentEditor } from '../agent-editor/agent-editor';
import { AgentHub } from '../agent-hub/agent-hub';
import { BuiltInSkillEditor } from '../builtin-skill-editor/builtin-skill-editor';
import { SkillEditor } from '../skill-editor/skill-editor';
import { SkillsLibrary } from '../skills-library/skills-library';

/** The Agents area: the hub, an agent's page, its editor and the skills. */
@Component({
  selector: 'app-agents-area',
  imports: [
    AgentHub,
    AgentDetail,
    AgentEditor,
    SkillsLibrary,
    SkillEditor,
    BuiltInSkillEditor,
  ],
  templateUrl: './agents-area.html',
  styles: ':host { display: contents; }',
})
export class AgentsArea {
  readonly shell = inject(ShellState);
  readonly agents = inject(AgentsNavState);
  readonly workflows = inject(WorkflowsNavState);
}
