import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import {
  ArrowLeft,
  Loader2,
  LucideAngularModule,
  MessageSquare,
  Plus,
  Save,
  Upload,
  X,
} from 'lucide-angular';
import { AgentEditorService } from '../../services/agent-editor.service';
import {
  AGENT_FIELD_LIMITS,
  REASONING_EFFORT_CHOICES,
  ReasoningEffortChoice,
  modelPlaceholder,
} from '../../services/agent-editor.util';

/**
 * The agent editor (agents-evals R54-R59, ui.md 4.5.1): a user agent's draft
 * as a form, with Preview, Save and Publish. Its state lives in
 * `AgentEditorService`, which the preview chat and the app shell share.
 */
@Component({
  selector: 'app-agent-editor',
  imports: [LucideAngularModule],
  templateUrl: './agent-editor.html',
})
export class AgentEditor implements OnInit, OnDestroy {
  readonly ArrowLeft = ArrowLeft;
  readonly Loader2 = Loader2;
  readonly MessageSquare = MessageSquare;
  readonly Plus = Plus;
  readonly Save = Save;
  readonly Upload = Upload;
  readonly X = X;

  readonly limits = AGENT_FIELD_LIMITS;
  readonly efforts = REASONING_EFFORT_CHOICES;
  readonly instructionsHint =
    "Added to the assistant's context in every turn. The assistant's own rules and the read-only guard still apply.";

  readonly editor = inject(AgentEditorService);

  /** The user agent to edit; null opens an empty editor for a new one. */
  readonly agentId = input<string | null>(null);
  /** Back; the shell asks first when there are unsaved changes (R59). */
  readonly back = output<void>();
  /** Preview; the shell opens the Details panel on the preview chat (R60). */
  readonly preview = output<void>();

  readonly modelPlaceholder = computed(() =>
    modelPlaceholder(this.editor.configuredModel()),
  );
  readonly canAddStarter = computed(
    () =>
      this.editor.form().starterQuestions.length <
      AGENT_FIELD_LIMITS.starterQuestions,
  );

  ngOnInit(): void {
    this.editor.open(this.agentId());
  }

  ngOnDestroy(): void {
    this.editor.close();
  }

  onText(
    field: 'name' | 'description' | 'instructions' | 'model',
    event: Event,
  ): void {
    this.editor.update({ [field]: (event.target as HTMLInputElement).value });
  }

  onEffort(event: Event): void {
    this.editor.update({
      reasoningEffort: (event.target as HTMLSelectElement)
        .value as ReasoningEffortChoice,
    });
  }

  onDataset(name: string, event: Event): void {
    this.editor.toggleDataset(name, (event.target as HTMLInputElement).checked);
  }

  onStarter(index: number, event: Event): void {
    this.editor.setStarter(index, (event.target as HTMLInputElement).value);
  }

  startPreview(): void {
    void this.editor.startPreview();
    this.preview.emit();
  }

  save(): void {
    void this.editor.save();
  }

  publish(): void {
    void this.editor.publish();
  }
}
