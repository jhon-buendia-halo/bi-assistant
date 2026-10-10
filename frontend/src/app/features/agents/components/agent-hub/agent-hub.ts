import {
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  LucideAngularModule,
  Plus,
  Search,
} from 'lucide-angular';
import { Agent, AgentsApiService } from '../../services/agents-api.service';
import {
  HUB_FILTERS,
  HubFilter,
  HubSectionId,
  buildHubSections,
  hubEmptyMessage,
  visibleCards,
} from '../../services/agent-hub.util';
import { ToastService } from '../../../../core/toast/toast.service';
import { AgentCard } from '../agent-card/agent-card';

/**
 * The Agents screen (agents-evals R1-R4, R53, ui.md 4.4). Search, filter and
 * expanded sections live in this component, so they reset each time the hub
 * opens.
 */
@Component({
  selector: 'app-agent-hub',
  imports: [LucideAngularModule, AgentCard],
  templateUrl: './agent-hub.html',
})
export class AgentHub implements OnInit {
  readonly ChevronDown = ChevronDown;
  readonly ChevronUp = ChevronUp;
  readonly Loader2 = Loader2;
  readonly Plus = Plus;
  readonly Search = Search;

  readonly filters = HUB_FILTERS;
  /** Shown while New agent is disabled, until BA-155 enables it. */
  readonly newAgentHint = 'The agent editor arrives with BA-155';

  private readonly api = inject(AgentsApiService);
  private readonly toast = inject(ToastService);

  readonly openAgent = output<Agent>();
  /** Start chat on a card; the shell creates or composes the session (R53). */
  readonly startChat = output<Agent>();
  /** Key of the agent whose session is being created, if any. */
  readonly startingAgentKey = input<string | null>(null);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly agents = signal<Agent[]>([]);
  readonly query = signal('');
  readonly filter = signal<HubFilter>('all');
  readonly expanded = signal<ReadonlySet<HubSectionId>>(new Set());

  readonly sections = computed(() =>
    buildHubSections(this.agents(), this.filter(), this.query()).map(
      (section) => ({
        ...section,
        expanded: this.expanded().has(section.id),
        ...visibleCards(section.agents, this.expanded().has(section.id)),
      }),
    ),
  );

  readonly emptyMessage = computed(() =>
    hubEmptyMessage(this.filter(), this.query(), this.sections()),
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

  toggleSection(id: HubSectionId): void {
    const next = new Set(this.expanded());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expanded.set(next);
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
