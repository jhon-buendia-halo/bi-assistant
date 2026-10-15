import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { LucideAngularModule, ChevronRight, Loader2 } from 'lucide-angular';
import {
  AgentSkill,
  AgentSkillFile,
  AgentSkillsView,
  AgentsApiService,
} from '../../services/agents-api.service';
import { knownLinks } from '../../services/prompt-links';
import { LinkedText } from '../linked-text/linked-text';

/** What an expanded skill row shows on its right: the selected file. */
interface OpenSkill {
  /** The selected file's path, relative to the skill's folder. */
  path: string;
  loading: boolean;
  error: string | null;
  file: AgentSkillFile | null;
}

/**
 * The read-only Skills tab of the agent detail (agents-evals R63-R67,
 * ui.md 4.5): the agent's built-in skills with their files.
 */
@Component({
  selector: 'app-agent-skills',
  imports: [LucideAngularModule, LinkedText],
  templateUrl: './agent-skills.html',
})
export class AgentSkills {
  readonly ChevronRight = ChevronRight;
  readonly Loader2 = Loader2;

  private readonly api = inject(AgentsApiService);

  /** The tools an in-app skill's body can link; other links show as not found. */
  protected readonly knownLinks = knownLinks([]);

  /** Key the skill files are read through. */
  readonly agentKey = input.required<string>();
  readonly view = input.required<AgentSkillsView>();
  /** A user agent runs on the assistant and shows the assistant's skills. */
  readonly userAgent = input(false);

  /** Expanded rows by skill name. */
  readonly open = signal<Record<string, OpenSkill>>({});

  readonly skills = computed(() =>
    [...this.view().skills].sort((a, b) => a.name.localeCompare(b.name)),
  );

  constructor() {
    // A different agent or a reloaded view starts with every row collapsed.
    effect(() => {
      this.agentKey();
      this.view();
      this.open.set({});
    });
  }

  loadingLabel(skill: AgentSkill): string {
    return skill.loading === 'on-demand' ? 'On demand' : 'Loaded by the app';
  }

  /** One indent step per folder level of the file's path. */
  depth(path: string): number {
    return path.split('/').length - 1;
  }

  isOpen(name: string): boolean {
    return name in this.open();
  }

  /** Expand a row on `SKILL.md`, or collapse it when it is open. */
  toggle(skill: AgentSkill): void {
    const open = { ...this.open() };
    if (skill.name in open) {
      delete open[skill.name];
      this.open.set(open);
      return;
    }
    const first =
      skill.files.find((file) => file.path === 'SKILL.md')?.path ??
      skill.files[0]?.path;
    if (!first) {
      this.open.set({
        ...open,
        [skill.name]: { path: '', loading: false, error: null, file: null },
      });
      return;
    }
    this.open.set(open);
    this.selectFile(skill.name, first);
  }

  selectFile(name: string, path: string): void {
    this.open.update((open) => ({
      ...open,
      [name]: { path, loading: true, error: null, file: null },
    }));
    this.api.skillFile(this.agentKey(), name, path).subscribe({
      next: (file) => this.settle(name, path, { file }),
      error: (err) =>
        this.settle(name, path, {
          error: err?.error?.message ?? 'Backend unreachable',
        }),
    });
  }

  /** Apply a file response unless the row closed or moved to another file. */
  private settle(
    name: string,
    path: string,
    result: Partial<Pick<OpenSkill, 'file' | 'error'>>,
  ): void {
    this.open.update((open) => {
      if (open[name]?.path !== path) return open;
      return {
        ...open,
        [name]: {
          path,
          loading: false,
          error: result.error ?? null,
          file: result.file ?? null,
        },
      };
    });
  }
}
