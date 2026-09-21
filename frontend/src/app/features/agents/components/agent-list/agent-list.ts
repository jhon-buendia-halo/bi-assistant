import { Component, OnInit, inject, output, signal } from '@angular/core';
import {
  LucideAngularModule,
  Bot,
  Loader2,
  Search,
  Wrench,
} from 'lucide-angular';
import { Agent, AgentsApiService } from '../../services/agents-api.service';

@Component({
  selector: 'app-agent-list',
  imports: [LucideAngularModule],
  templateUrl: './agent-list.html',
  styleUrl: './agent-list.scss',
})
export class AgentList implements OnInit {
  readonly Bot = Bot;
  readonly Loader2 = Loader2;
  readonly Search = Search;
  readonly Wrench = Wrench;

  private readonly api = inject(AgentsApiService);

  readonly openAgent = output<Agent>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly agents = signal<Agent[]>([]);

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

  toolsLabel(agent: Agent): string {
    const count = agent.tools.length;
    if (count === 0) return 'No tools';
    return count === 1 ? '1 tool' : `${count} tools`;
  }
}
