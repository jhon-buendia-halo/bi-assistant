import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, Loader2, Plus, Trash2, X } from 'lucide-angular';
import { PersonasApiService } from '../../services/personas-api.service';
import {
  PERSONA_EXPERTISE,
  PERSONA_LIMITS,
  PersonaExpertise,
  PersonaInput,
  UserPersona,
} from '../../models/persona.model';
import { ToastService } from '../../../../core/toast/toast.service';

/**
 * Create/edit panel for a user persona. `persona` null means "new persona";
 * setting it prefills the form and switches "Create" to "Save".
 */
@Component({
  selector: 'app-persona-form',
  imports: [LucideAngularModule],
  templateUrl: './persona-form.html',
  styleUrl: './persona-form.scss',
})
export class PersonaForm {
  readonly Loader2 = Loader2;
  readonly Plus = Plus;
  readonly Trash2 = Trash2;
  readonly X = X;
  readonly expertiseOptions = PERSONA_EXPERTISE;
  readonly limits = PERSONA_LIMITS;

  private readonly api = inject(PersonasApiService);
  private readonly toast = inject(ToastService);

  readonly persona = input<UserPersona | null>(null);

  readonly saved = output<UserPersona>();
  readonly cancelled = output<void>();

  readonly name = signal('');
  readonly role = signal('');
  readonly description = signal('');
  readonly goals = signal('');
  readonly typicalQuestions = signal<string[]>(['']);
  readonly expertise = signal<PersonaExpertise>('intermediate');
  readonly answerStyle = signal('');
  readonly saving = signal(false);
  /** The backend's reason for the last failed save, shown inline. */
  readonly error = signal<string | null>(null);

  readonly canSave = computed(
    () => !this.saving() && this.name().trim() !== '',
  );
  readonly canAddQuestion = computed(
    () => this.typicalQuestions().length < PERSONA_LIMITS.typicalQuestions,
  );

  constructor() {
    // Re-sync whenever the parent swaps in a different persona (or clears it).
    effect(() => {
      const current = this.persona();
      this.error.set(null);
      if (current) {
        this.name.set(current.name);
        this.role.set(current.role ?? '');
        this.description.set(current.description ?? '');
        this.goals.set(current.goals ?? '');
        this.typicalQuestions.set(
          current.typicalQuestions?.length ? [...current.typicalQuestions] : [''],
        );
        this.expertise.set(current.expertise ?? 'intermediate');
        this.answerStyle.set(current.answerStyle ?? '');
      } else {
        this.reset();
      }
    });
  }

  addQuestion(): void {
    if (!this.canAddQuestion()) return;
    this.typicalQuestions.update((list) => [...list, '']);
  }

  removeQuestion(index: number): void {
    this.typicalQuestions.update((list) => list.filter((_, i) => i !== index));
  }

  setQuestion(index: number, value: string): void {
    this.typicalQuestions.update((list) =>
      list.map((q, i) => (i === index ? value : q)),
    );
  }

  /** What Save sends: trimmed fields, blank question rows dropped. */
  buildInput(): PersonaInput {
    return {
      name: this.name().trim(),
      role: this.role().trim(),
      description: this.description().trim(),
      goals: this.goals().trim(),
      typicalQuestions: this.typicalQuestions()
        .map((q) => q.trim())
        .filter(Boolean),
      expertise: this.expertise(),
      answerStyle: this.answerStyle().trim(),
    };
  }

  save(): void {
    if (!this.canSave()) return;
    const input = this.buildInput();
    const existing = this.persona();
    this.saving.set(true);
    this.error.set(null);
    const request = existing
      ? this.api.update(existing.id, input)
      : this.api.create(input);
    request.subscribe({
      next: (result) => {
        this.saving.set(false);
        this.toast.success(existing ? 'Persona updated' : 'Persona created');
        this.saved.emit(result);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set(errorMessage(err));
      },
    });
  }

  cancel(): void {
    this.cancelled.emit();
  }

  private reset(): void {
    this.name.set('');
    this.role.set('');
    this.description.set('');
    this.goals.set('');
    this.typicalQuestions.set(['']);
    this.expertise.set('intermediate');
    this.answerStyle.set('');
  }
}

/** Nest's validation errors send `message` as an array; join it. */
function errorMessage(err: { error?: { message?: unknown } }): string {
  const message = err?.error?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' && message
    ? message
    : 'Backend unreachable';
}
