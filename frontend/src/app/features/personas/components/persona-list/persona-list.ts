import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  LucideAngularModule,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  Users,
} from 'lucide-angular';
import { PersonasApiService } from '../../services/personas-api.service';
import {
  UserPersona,
  expertiseChipClass,
  expertiseLabel,
} from '../../models/persona.model';
import { ToastService } from '../../../../core/toast/toast.service';
import { PersonaForm } from '../persona-form/persona-form';

/** The Context area's "User personas" section (roadmap 1.21.6). */
@Component({
  selector: 'app-persona-list',
  imports: [LucideAngularModule, PersonaForm],
  templateUrl: './persona-list.html',
  styleUrl: './persona-list.scss',
})
export class PersonaList implements OnInit {
  readonly Loader2 = Loader2;
  readonly Pencil = Pencil;
  readonly Plus = Plus;
  readonly Trash2 = Trash2;
  readonly UserRound = UserRound;
  readonly Users = Users;

  readonly expertiseLabel = expertiseLabel;
  readonly expertiseChipClass = expertiseChipClass;

  private readonly api = inject(PersonasApiService);
  private readonly toast = inject(ToastService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly personas = signal<UserPersona[]>([]);

  readonly formOpen = signal(false);
  readonly editingPersona = signal<UserPersona | null>(null);
  readonly deletingId = signal<string | null>(null);

  readonly sortedPersonas = computed(() =>
    [...this.personas()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    ),
  );

  ngOnInit(): void {
    this.loadPersonas();
  }

  private loadPersonas(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.list().subscribe({
      next: (personas) => {
        this.personas.set(personas);
        this.loading.set(false);
      },
      error: (err) => {
        const detail = err?.error?.message;
        this.error.set(
          typeof detail === 'string' && detail
            ? `Could not load personas: ${detail}`
            : 'Could not load personas',
        );
        this.loading.set(false);
      },
    });
  }

  openNew(): void {
    this.editingPersona.set(null);
    this.formOpen.set(true);
  }

  openEdit(persona: UserPersona): void {
    this.editingPersona.set(persona);
    this.formOpen.set(true);
  }

  cancelForm(): void {
    this.formOpen.set(false);
    this.editingPersona.set(null);
  }

  onPersonaSaved(): void {
    this.formOpen.set(false);
    this.editingPersona.set(null);
    this.loadPersonas();
  }

  deletePersona(persona: UserPersona): void {
    if (!window.confirm(`Delete persona "${persona.name}"?`)) return;
    this.deletingId.set(persona.id);
    this.api.remove(persona.id).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.personas.update((list) =>
          list.filter((item) => item.id !== persona.id),
        );
        this.toast.success('Persona deleted');
      },
      error: (err) => {
        this.deletingId.set(null);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }
}
