import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../../../core/toast/toast.service';
import {
  BuiltInSkillForm,
  builtInFormChanged,
  builtInFormFromSkill,
  builtInResetConfirm,
  builtInSaveInput,
  canSaveBuiltIn,
  emptyBuiltInForm,
} from './builtin-skill-editor.util';
import { BuiltInSkill, SkillsApiService } from './skills-api.service';

/**
 * State of the built-in skill editor (agents-evals R76-R80), shared by the
 * editor and the app shell, which asks before leaving with unsaved changes.
 */
@Injectable({ providedIn: 'root' })
export class BuiltInSkillEditorService {
  private readonly api = inject(SkillsApiService);
  private readonly toast = inject(ToastService);
  readonly name = signal<string | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly skill = signal<BuiltInSkill | null>(null);
  readonly form = signal<BuiltInSkillForm>(emptyBuiltInForm());
  readonly saved = signal<BuiltInSkillForm>(emptyBuiltInForm());
  readonly saving = signal(false);
  readonly resetting = signal(false);
  readonly showShipped = signal(false);

  /** Saving and resetting need Edit policies and templates (R80). */
  readonly canEdit = computed(() => true);
  readonly changed = computed(() =>
    builtInFormChanged(this.form(), this.saved()),
  );
  readonly canSave = computed(() =>
    canSaveBuiltIn({
      canEdit: this.canEdit(),
      changed: this.changed(),
      saving: this.saving(),
    }),
  );
  readonly modified = computed(() => this.skill()?.modified ?? false);
  readonly builtInChanged = computed(
    () => this.modified() && (this.skill()?.builtInChanged ?? false),
  );

  private generation = 0;

  open(name: string): void {
    const generation = ++this.generation;
    this.name.set(name);
    this.skill.set(null);
    this.form.set(emptyBuiltInForm());
    this.saved.set(emptyBuiltInForm());
    this.showShipped.set(false);
    this.loadError.set(null);
    this.loading.set(true);
    this.api.getBuiltIn(name).subscribe({
      next: (skill) => {
        if (generation !== this.generation) return;
        this.apply(skill);
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

  private apply(skill: BuiltInSkill): void {
    const form = builtInFormFromSkill(skill);
    this.skill.set(skill);
    this.form.set(form);
    this.saved.set(form);
  }

  update(patch: Partial<BuiltInSkillForm>): void {
    if (!this.canEdit()) return;
    this.form.update((form) => ({ ...form, ...patch }));
  }

  setFileContent(index: number, content: string): void {
    if (!this.canEdit()) return;
    this.form.update((form) => ({
      ...form,
      files: form.files.map((file, i) =>
        i === index ? { ...file, content } : file,
      ),
    }));
  }

  toggleShipped(): void {
    this.showShipped.update((shown) => !shown);
  }

  async save(): Promise<boolean> {
    const name = this.name();
    if (name === null || !this.canSave()) return false;
    const form = this.form();
    const generation = this.generation;
    this.saving.set(true);
    try {
      const res = await firstValueFrom(
        this.api.saveBuiltIn(name, builtInSaveInput(form)),
      );
      if (!res.ok || !res.skill) {
        this.toast.error(res.message);
        return false;
      }
      this.toast.success(res.message);
      if (generation === this.generation) {
        this.skill.set(res.skill);
        // The snapshot that was sent, not what was typed while it was in flight.
        this.saved.set(form);
      }
      return true;
    } catch (err) {
      const error = err as { error?: { message?: string } };
      this.toast.error(error?.error?.message ?? 'Backend unreachable');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /** Reset after the native confirm (R78), then show the shipped content. */
  async reset(): Promise<boolean> {
    const name = this.name();
    if (name === null || !this.canEdit() || this.resetting()) return false;
    if (!window.confirm(builtInResetConfirm(name))) return false;
    this.resetting.set(true);
    try {
      const res = await firstValueFrom(this.api.resetBuiltIn(name));
      if (!res.ok) {
        this.toast.error(res.message);
        return false;
      }
      this.toast.success(res.message);
      const fresh = await firstValueFrom(this.api.getBuiltIn(name));
      if (name === this.name()) this.apply(fresh);
      return true;
    } catch (err) {
      const error = err as { error?: { message?: string } };
      this.toast.error(error?.error?.message ?? 'Backend unreachable');
      return false;
    } finally {
      this.resetting.set(false);
    }
  }
}
