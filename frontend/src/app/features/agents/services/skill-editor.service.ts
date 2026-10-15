import { Injectable, computed, signal } from '@angular/core';
import { inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../../../core/toast/toast.service';
import {
  SKILL_FIELD_LIMITS,
  SkillForm,
  canSaveSkill,
  emptySkillForm,
  skillDeleteConfirm,
  skillFormChanged,
  skillFormFromSkill,
  skillSaveInput,
} from './skill-editor.util';
import { SkillMutationResult, SkillsApiService } from './skills-api.service';

/**
 * State of the skill editor (agents-evals R70-R73), shared by the editor and
 * the app shell, which asks before leaving with unsaved changes.
 */
@Injectable({ providedIn: 'root' })
export class SkillEditorService {
  private readonly api = inject(SkillsApiService);
  private readonly toast = inject(ToastService);

  /** The skill's id once it exists; null for a new skill never saved. */
  readonly skillId = signal<string | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly form = signal<SkillForm>(emptySkillForm());
  readonly saved = signal<SkillForm>(emptySkillForm());
  /** Names of the agents that use the skill. */
  readonly usedBy = signal<string[]>([]);
  readonly saving = signal(false);
  readonly deleting = signal(false);

  readonly changed = computed(() =>
    skillFormChanged(this.form(), this.saved()),
  );
  readonly canSave = computed(() =>
    canSaveSkill({
      form: this.form(),
      changed: this.changed(),
      saving: this.saving(),
    }),
  );
  readonly title = computed(() =>
    this.skillId() === null ? 'New skill' : `Edit ${this.saved().name}`,
  );
  readonly canAddFile = computed(
    () => this.form().files.length < SKILL_FIELD_LIMITS.files,
  );

  private generation = 0;

  /** Open the editor on a skill, or empty for a new one. */
  open(skillId: string | null): void {
    const generation = ++this.generation;
    this.skillId.set(skillId);
    this.form.set(emptySkillForm());
    this.saved.set(emptySkillForm());
    this.usedBy.set([]);
    this.loadError.set(null);
    this.loading.set(skillId !== null);
    if (skillId === null) return;
    this.api.get(skillId).subscribe({
      next: (skill) => {
        if (generation !== this.generation) return;
        const form = skillFormFromSkill(skill);
        this.form.set(form);
        this.saved.set(form);
        this.usedBy.set(skill.agents);
        this.loading.set(false);
      },
      error: (err) => {
        if (generation !== this.generation) return;
        this.loadError.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
  }

  close(): void {
    this.generation++;
  }

  update(patch: Partial<SkillForm>): void {
    this.form.update((form) => ({ ...form, ...patch }));
  }

  setFile(index: number, patch: { path?: string; content?: string }): void {
    this.form.update((form) => ({
      ...form,
      files: form.files.map((file, i) =>
        i === index ? { ...file, ...patch } : file,
      ),
    }));
  }

  addFile(): void {
    if (!this.canAddFile()) return;
    this.form.update((form) => ({
      ...form,
      files: [...form.files, { path: '', content: '' }],
    }));
  }

  removeFile(index: number): void {
    this.form.update((form) => ({
      ...form,
      files: form.files.filter((_, i) => i !== index),
    }));
  }

  /** Create or save the skill, toasting the backend's message (R71). */
  async save(): Promise<boolean> {
    if (this.saving()) return false;
    const form = this.form();
    const generation = this.generation;
    const id = this.skillId();
    const input = skillSaveInput(form);
    this.saving.set(true);
    let res: SkillMutationResult;
    try {
      res = await firstValueFrom(
        id === null ? this.api.create(input) : this.api.save(id, input),
      );
    } catch (err) {
      const error = err as { error?: { message?: string } };
      this.toast.error(error?.error?.message ?? 'Backend unreachable');
      return false;
    } finally {
      this.saving.set(false);
    }
    if (!res.ok || !res.skill) {
      this.toast.error(res.message);
      return false;
    }
    this.toast.success(res.message);
    if (generation !== this.generation) return true;
    this.skillId.set(res.skill.id);
    // The snapshot that was sent, not what was typed while it was in flight.
    this.saved.set(form);
    this.usedBy.set(res.skill.agents ?? this.usedBy());
    return true;
  }

  /**
   * Delete after the native confirm (R72). Resolves true once deleted, so the
   * shell can return to the library.
   */
  async remove(): Promise<boolean> {
    const id = this.skillId();
    if (id === null || this.deleting()) return false;
    if (!window.confirm(skillDeleteConfirm(this.saved().name, this.usedBy()))) {
      return false;
    }
    this.deleting.set(true);
    try {
      const res = await firstValueFrom(this.api.delete(id));
      if (!res.ok) {
        this.toast.error(res.message);
        return false;
      }
      this.toast.success(res.message);
      // Nothing left to lose; leaving needs no confirmation.
      this.saved.set(this.form());
      return true;
    } catch (err) {
      const error = err as { error?: { message?: string } };
      this.toast.error(error?.error?.message ?? 'Backend unreachable');
      return false;
    } finally {
      this.deleting.set(false);
    }
  }
}
