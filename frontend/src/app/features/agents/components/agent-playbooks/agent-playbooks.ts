import { Component, computed, inject, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChevronDown, ChevronRight, LucideAngularModule } from 'lucide-angular';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';
import {
  AgentSkill,
  AgentsApiService,
} from '../../services/agents-api.service';
import { PlaybookSet, playbookSet } from '../../services/agent-playbooks';

/**
 * The Playbooks section of the job description's CV view (ui.md 4.5): the
 * playbooks the agent follows, read from its playbooks skill (`SKILL.md`
 * routes, `reference/*.md` the playbooks). Each opens to show its steps and
 * its Reply. Its host shows it only for an agent with such a skill.
 */
@Component({
  selector: 'app-agent-playbooks',
  imports: [LucideAngularModule, MarkdownPipe],
  templateUrl: './agent-playbooks.html',
  host: { class: 'contents' },
})
export class AgentPlaybooks {
  private readonly api = inject(AgentsApiService);

  readonly agentKey = input.required<string>();
  readonly agentName = input.required<string>();
  /** The agent's playbooks skill (api.md 34a): its router and reference files. */
  readonly skill = input.required<AgentSkill>();

  /** The playbooks, read from the skill's files; null while loading or when unreadable. */
  readonly set = toSignal(
    toObservable(
      computed(() => ({ key: this.agentKey(), skill: this.skill() })),
    ).pipe(
      switchMap(({ key, skill }) => {
        const paths = [
          'SKILL.md',
          ...skill.files
            .map((f) => f.path)
            .filter((p) => /^reference\/[^/]+\.md$/.test(p)),
        ];
        return forkJoin(
          paths.map((path) => this.api.skillFile(key, skill.name, path)),
        ).pipe(
          map(([router, ...files]): PlaybookSet =>
            playbookSet(
              skill.name,
              router.content ?? '',
              files.flatMap((f) =>
                f.content === null
                  ? []
                  : [{ path: f.path, content: f.content }],
              ),
            ),
          ),
          catchError(() => of(null)),
        );
      }),
    ),
    { initialValue: null },
  );

  /** The playbooks open, by path; the first one starts open. */
  private readonly toggled = signal<ReadonlyMap<string, boolean>>(new Map());

  protected isOpen(path: string, first: boolean): boolean {
    return this.toggled().get(path) ?? first;
  }

  protected toggle(path: string, first: boolean): void {
    const next = new Map(this.toggled());
    next.set(path, !this.isOpen(path, first));
    this.toggled.set(next);
  }

  protected readonly ChevronDown = ChevronDown;
  protected readonly ChevronRight = ChevronRight;
}
