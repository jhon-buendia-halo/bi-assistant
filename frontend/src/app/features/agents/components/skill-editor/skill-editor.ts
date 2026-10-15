import {
  Component,
  OnDestroy,
  OnInit,
  inject,
  input,
  output,
} from '@angular/core';
import {
  ArrowLeft,
  Loader2,
  LucideAngularModule,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-angular';
import { PromptEditor } from '../prompt-editor/prompt-editor';
import { SkillEditorService } from '../../services/skill-editor.service';
import { SKILL_FIELD_LIMITS } from '../../services/skill-editor.util';

/**
 * The skill editor (agents-evals R70-R73, ui.md 4.5.3): a skill as a form,
 * with Save and Delete. Its state lives in `SkillEditorService`, which the
 * app shell shares to ask before leaving with unsaved changes.
 */
@Component({
  selector: 'app-skill-editor',
  imports: [LucideAngularModule, PromptEditor],
  templateUrl: './skill-editor.html',
})
export class SkillEditor implements OnInit, OnDestroy {
  readonly ArrowLeft = ArrowLeft;
  readonly Loader2 = Loader2;
  readonly Plus = Plus;
  readonly Save = Save;
  readonly Trash2 = Trash2;
  readonly X = X;

  readonly limits = SKILL_FIELD_LIMITS;
  readonly bodyHint =
    'Type / to link a tool. A skill can link tools only; the agent gets a linked tool when it links this skill.';
  readonly descriptionHint =
    'Start with "Use when…". The agent reads the skill only when a question matches it.';

  readonly editor = inject(SkillEditorService);
  /** The skill to edit; null opens an empty editor for a new one. */
  readonly skillId = input<string | null>(null);
  /** Back; the shell asks first when there are unsaved changes (R71). */
  readonly back = output<void>();
  /** Deleted; the shell returns to the library (R72). */
  readonly deleted = output<void>();

  ngOnInit(): void {
    this.editor.open(this.skillId());
  }

  ngOnDestroy(): void {
    this.editor.close();
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

  save(): void {
    void this.editor.save();
  }

  async remove(): Promise<void> {
    if (await this.editor.remove()) this.deleted.emit();
  }
}
