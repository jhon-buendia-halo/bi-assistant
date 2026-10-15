import {
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  Loader2,
  LucideAngularModule,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-angular';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../../../../core/toast/toast.service';
import { AgentPageState } from '../../services/agent-page-state.service';
import { skillLinked, skillsCount } from '../../services/agent-page.util';
import {
  builtInRowNotice,
  loadingChipLabel,
} from '../../services/builtin-skill-editor.util';
import { SkillEditorService } from '../../services/skill-editor.service';
import {
  SKILL_FIELD_LIMITS,
  skillDeleteConfirm,
} from '../../services/skill-editor.util';
import {
  BuiltInSkillSummary,
  SkillSummary,
  SkillsApiService,
} from '../../services/skills-api.service';
import { PromptEditor } from '../prompt-editor/prompt-editor';

/**
 * The Skills tab of a user agent (agents-evals R88, ui.md 4.5), as in the
 * agent-poc reference: the owner's library inline, each skill marked Linked
 * or Not linked from the draft's links, with New, Edit and Delete in place,
 * then the built-in skills. The form is the skill editor's (R70-R72), kept in
 * `SkillEditorService`.
 */
@Component({
  selector: 'app-agent-skills-inline',
  imports: [LucideAngularModule, PromptEditor],
  templateUrl: './agent-skills-inline.html',
})
export class AgentSkillsInline implements OnDestroy {
  readonly Loader2 = Loader2;
  readonly Pencil = Pencil;
  readonly Plus = Plus;
  readonly Trash2 = Trash2;
  readonly X = X;

  private readonly skillsApi = inject(SkillsApiService);
  private readonly toast = inject(ToastService);
  private readonly pageState = inject(AgentPageState);
  readonly editor = inject(SkillEditorService);

  readonly limits = SKILL_FIELD_LIMITS;
  readonly bodyHint =
    'Type / to link a tool. A skill can link tools only; the agent gets a linked tool when it links this skill.';
  readonly descriptionHint =
    'Start with "Use when…". The agent reads the skill only when a question matches it.';
  readonly loadingLabel = loadingChipLabel;
  readonly notice = builtInRowNotice;

  /** The agent's draft instructions: what decides Linked. */
  readonly instructions = input.required<string>();
  readonly agentKey = input.required<string>();
  readonly library = input.required<SkillSummary[]>();
  readonly builtIn = input.required<BuiltInSkillSummary[]>();
  /** A skill was created, saved or deleted; the page reloads the library. */
  readonly changed = output<void>();
  /** An admin's Edit on a built-in row. */
  readonly openBuiltIn = output<string>();

  /** `null` closed, `'new'`, or the skill id being edited. */
  readonly editing = signal<string | null>(null);

  readonly canChange = computed(() => true);
  readonly canEditBuiltIn = computed(() => true);
  readonly count = computed(() =>
    skillsCount(this.instructions(), this.library(), this.builtIn().length),
  );
  readonly deleting = signal<string | null>(null);

  linked(name: string): boolean {
    return skillLinked(this.instructions(), name);
  }

  constructor() {
    // Another agent starts with the form closed.
    effect(() => {
      this.agentKey();
      untracked(() => this.editing.set(null));
    });
    effect(() => {
      this.pageState.skillDirty.set(
        this.editing() !== null && this.editor.changed(),
      );
    });
  }

  newSkill(): void {
    this.editor.open(null);
    this.editing.set('new');
  }

  edit(skill: SkillSummary): void {
    this.editor.open(skill.id);
    this.editing.set(skill.id);
  }

  cancel(): void {
    this.editor.close();
    this.editing.set(null);
  }

  async save(): Promise<void> {
    if (await this.editor.save()) {
      this.editor.close();
      this.editing.set(null);
      this.changed.emit();
    }
  }

  async remove(skill: SkillSummary): Promise<void> {
    if (this.deleting()) return;
    if (!window.confirm(skillDeleteConfirm(skill.name, skill.agents))) return;
    this.deleting.set(skill.id);
    try {
      const res = await firstValueFrom(this.skillsApi.delete(skill.id));
      if (!res.ok) {
        this.toast.error(res.message);
        return;
      }
      this.toast.success(res.message);
      if (this.editing() === skill.id) this.cancel();
      this.changed.emit();
    } catch (err) {
      const error = err as { error?: { message?: string } };
      this.toast.error(error?.error?.message ?? 'Backend unreachable');
    } finally {
      this.deleting.set(null);
    }
  }

  onBody(value: string): void {
    this.editor.update({ body: value });
  }

  onText(field: 'name' | 'description', event: Event): void {
    this.editor.update({ [field]: (event.target as HTMLInputElement).value });
  }

  onFile(index: number, field: 'path' | 'content', event: Event): void {
    this.editor.setFile(index, {
      [field]: (event.target as HTMLInputElement).value,
    });
  }

  ngOnDestroy(): void {
    if (this.editing() !== null) this.editor.close();
    this.pageState.skillDirty.set(false);
  }
}
