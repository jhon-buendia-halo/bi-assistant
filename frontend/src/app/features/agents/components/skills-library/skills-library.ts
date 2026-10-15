import { Component, OnInit, inject, output, signal } from '@angular/core';
import { forkJoin } from 'rxjs';
import { ArrowLeft, Loader2, LucideAngularModule, Plus } from 'lucide-angular';
import {
  builtInRowNotice,
  loadingChipLabel,
} from '../../services/builtin-skill-editor.util';
import { includedInEveryAgent } from '../../services/agent-page.util';
import { usedByLabel } from '../../services/skill-editor.util';
import {
  BuiltInSkillSummary,
  SkillSummary,
  SkillsApiService,
} from '../../services/skills-api.service';

/**
 * The skills library (agents-evals R68, R69, R74, ui.md 4.5.2): the user's
 * skills and the built-in ones (R75), each opening its editor.
 */
@Component({
  selector: 'app-skills-library',
  imports: [LucideAngularModule],
  templateUrl: './skills-library.html',
})
export class SkillsLibrary implements OnInit {
  readonly ArrowLeft = ArrowLeft;
  readonly Loader2 = Loader2;
  readonly Plus = Plus;

  private readonly api = inject(SkillsApiService);
  readonly back = output<void>();
  /** A row, or New skill (null); the shell opens the skill editor. */
  readonly openSkill = output<SkillSummary | null>();
  /** A built-in row; the shell opens the built-in skill editor. */
  readonly openBuiltIn = output<string>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly skills = signal<SkillSummary[]>([]);
  readonly builtIn = signal<BuiltInSkillSummary[]>([]);
  readonly usedBy = usedByLabel;
  readonly loadingLabel = loadingChipLabel;
  readonly notice = builtInRowNotice;

  ngOnInit(): void {
    forkJoin([this.api.list(), this.api.listBuiltIn()]).subscribe({
      next: ([mine, builtIn]) => {
        this.skills.set(mine.skills);
        this.builtIn.set(includedInEveryAgent(builtIn.skills));
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
  }
}
