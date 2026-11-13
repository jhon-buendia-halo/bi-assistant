import {
  Component,
  OnInit,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import {
  BookOpen,
  Loader2,
  LucideAngularModule,
  Plus,
  Search,
} from 'lucide-angular';
import { Agent, AgentsApiService } from '../../services/agents-api.service';
import {
  HubFilter,
  OWNER_FILTERS,
  OwnerFilter,
  buildHubSections,
  hubEmptyMessage,
  hubFilters,
} from '../../services/agent-hub.util';
import { ToastService } from '../../../../core/toast/toast.service';
import { AgentCard } from '../agent-card/agent-card';

/**
 * The Agents screen (agents-evals R1-R4, R53, ui.md 4.4): one section per
 * domain. Search, filter and owner live in this component, so they reset
 * each time the hub opens.
 */
@Component({
  selector: 'app-agent-hub',
  imports: [LucideAngularModule, AgentCard],
  templateUrl: './agent-hub.html',
})
export class AgentHub implements OnInit {
  readonly BookOpen = BookOpen;
  readonly Loader2 = Loader2;
  readonly Plus = Plus;
  readonly Search = Search;

  readonly owners = OWNER_FILTERS;

  private readonly api = inject(AgentsApiService);
  private readonly toast = inject(ToastService);
  readonly openAgent = output<Agent>();
  /** New agent; the shell opens the agent editor (R54). */
  readonly newAgent = output<void>();
  /** Skills; the shell opens the skills library (R68). */
  readonly openSkills = output<void>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly agents = signal<Agent[]>([]);
  readonly query = signal('');
  readonly filter = signal<HubFilter>('all');
  readonly owner = signal<OwnerFilter>('any');

  /** All, Pinned and the domains that have agents (R2). */
  readonly filters = computed(() => hubFilters(this.agents()));

  readonly sections = computed(() =>
    buildHubSections(this.agents(), this.filter(), this.owner(), this.query()),
  );

  readonly emptyMessage = computed(() =>
    hubEmptyMessage(this.filter(), this.owner(), this.query(), this.sections()),
  );

  ngOnInit(): void {
    this.api.getAgents().subscribe({
      next: (res) => {
        this.agents.set(res.agents);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
  }

  onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  onOwner(event: Event): void {
    this.owner.set((event.target as HTMLSelectElement).value as OwnerFilter);
  }

  /**
   * Pin or unpin at once, then save; on failure the card returns to its
   * previous state and an error toast explains why (R4). Success is silent.
   */
  togglePin(agent: Agent): void {
    const pinned = !agent.pinned;
    this.setPinned(agent.key, pinned);
    this.api.setPinned(agent.key, pinned).subscribe({
      next: (res) => {
        if (res.ok) return;
        this.setPinned(agent.key, !pinned);
        this.toast.error(res.message);
      },
      error: (err) => {
        this.setPinned(agent.key, !pinned);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  private setPinned(key: string, pinned: boolean): void {
    this.agents.update((agents) =>
      agents.map((agent) => (agent.key === key ? { ...agent, pinned } : agent)),
    );
  }
}
