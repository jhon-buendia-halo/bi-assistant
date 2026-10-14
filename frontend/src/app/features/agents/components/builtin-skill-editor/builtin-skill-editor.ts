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
  RotateCcw,
} from 'lucide-angular';
import { BuiltInSkillEditorService } from '../../services/builtin-skill-editor.service';
import {
  BUILT_IN_BANNER,
  BUILT_IN_DRIFT_NOTICE,
} from '../../services/builtin-skill-editor.util';
import { SKILL_FIELD_LIMITS } from '../../services/skill-editor.util';

/**
 * The built-in skill editor (agents-evals R76-R80, ui.md 4.5.4). Its state
 * lives in `BuiltInSkillEditorService`, shared with the app shell.
 */
@Component({
  selector: 'app-builtin-skill-editor',
  imports: [LucideAngularModule],
  templateUrl: './builtin-skill-editor.html',
})
export class BuiltInSkillEditor implements OnInit, OnDestroy {
  readonly ArrowLeft = ArrowLeft;
  readonly Loader2 = Loader2;
  readonly RotateCcw = RotateCcw;

  readonly limits = SKILL_FIELD_LIMITS;
  readonly banner = BUILT_IN_BANNER;
  readonly driftNotice = BUILT_IN_DRIFT_NOTICE;

  readonly editor = inject(BuiltInSkillEditorService);

  /** The built-in skill to edit. */
  readonly skillName = input.required<string>();
  /** Back; the shell asks first when there are unsaved changes. */
  readonly back = output<void>();

  ngOnInit(): void {
    this.editor.open(this.skillName());
  }

  ngOnDestroy(): void {
    this.editor.close();
  }

  onText(field: 'description' | 'body', event: Event): void {
    this.editor.update({ [field]: (event.target as HTMLInputElement).value });
  }

  onFile(index: number, event: Event): void {
    this.editor.setFileContent(index, (event.target as HTMLInputElement).value);
  }

  save(): void {
    void this.editor.save();
  }

  reset(): void {
    void this.editor.reset();
  }
}
