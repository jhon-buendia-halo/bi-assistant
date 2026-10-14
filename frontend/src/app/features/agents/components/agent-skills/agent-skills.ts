import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  LucideAngularModule,
  ChevronRight,
  Loader2,
  TriangleAlert,
} from 'lucide-angular';
import {
  AgentSkill,
  AgentSkillFile,
  AgentSkillLevel,
  AgentSkillsView,
  AgentsApiService,
  SkillLevel,
} from '../../services/agents-api.service';

/** What an expanded skill row shows on its right: the selected file. */
interface OpenSkill {
  /** The selected file's path, relative to the skill's folder. */
  path: string;
  loading: boolean;
  error: string | null;
  file: AgentSkillFile | null;
}

const LEVEL_LABELS: Record<SkillLevel, string> = {
  'built-in': 'Built-in',
  user: 'User',
  project: 'Project',
};

export const PROJECT_SKILLS_VARIABLE =
  'QUESTIONS_TO_INSIGHTS_PROJECT_SKILLS_DIR';

/**
 * The read-only Skills tab of the agent detail (agents-evals R63-R67,
 * ui.md 4.5): where skills come from, the agent's skills with their files,
 * and the skills that were skipped.
 */
@Component({
  selector: 'app-agent-skills',
  imports: [LucideAngularModule],
  templateUrl: './agent-skills.html',
})
export class AgentSkills {
  readonly ChevronRight = ChevronRight;
  readonly Loader2 = Loader2;
  readonly TriangleAlert = TriangleAlert;

  private readonly api = inject(AgentsApiService);

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

  levelLabel(level: SkillLevel): string {
    return LEVEL_LABELS[level];
  }

  /** The level row's detail: where that level's skills are read from. */
  levelDetail(level: AgentSkillLevel): string {
    if (level.level === 'built-in') return 'Ships with the app';
    if (level.path === null) return `Not set (${PROJECT_SKILLS_VARIABLE})`;
    return level.found ? level.path : `${level.path} (not found)`;
  }

  loadingLabel(skill: AgentSkill): string {
    return skill.loading === 'on-demand' ? 'On demand' : 'Loaded by the app';
  }

  overridesLabel(skill: AgentSkill): string {
    return `Overrides ${skill.overrides.join(' and ')}`;
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
