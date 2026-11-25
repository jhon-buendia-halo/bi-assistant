import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { Loader2, LucideAngularModule } from 'lucide-angular';
import { QueryInspector } from '../../../../shared/query-evidence/query-inspector/query-inspector';
import { QUERY_EVIDENCE_API } from '../../../../shared/query-evidence/query-evidence.model';
import { focusQueryOpener } from '../../../../shared/query-evidence/query-opener';
import { RunDashboardPanel } from '../../../runs/components/run-dashboard-panel/run-dashboard-panel';
import { RunDashboardState } from '../../../runs/services/run-dashboard-state';
import { WorkflowRunChat } from '../../../workflows/components/workflow-run-chat/workflow-run-chat';
import { WorkflowDesigner } from '../../../workflows/services/workflow-designer.service';
import { RunQueryEvidenceApi } from '../../../workflows/services/run-query-evidence-api';
import { WorkflowRunsApiService } from '../../../workflows/services/workflow-runs-api.service';
import {
  ConversationSummary,
  bindingOfAgent,
} from '../../models/conversation.model';
import { AgentConversationsPanel } from '../agent-conversations-panel/agent-conversations-panel';

/**
 * A conversation with a built-in agent outside any workflow (agents-evals
 * R115): the workflow-run chat in its `conversation` variant, the
 * conversations panel on its left and, when the answer made one, the
 * dashboard on its right. Each message is a run of the agent's own binding.
 */
@Component({
  selector: 'app-agent-conversation',
  imports: [
    AgentConversationsPanel,
    LucideAngularModule,
    QueryInspector,
    RunDashboardPanel,
    WorkflowRunChat,
  ],
  templateUrl: './agent-conversation.html',
  providers: [{ provide: QUERY_EVIDENCE_API, useClass: RunQueryEvidenceApi }],
  host: { class: 'flex min-h-0 flex-1 flex-col' },
})
export class AgentConversation {
  protected readonly Loader2 = Loader2;

  protected readonly designer = inject(WorkflowDesigner);
  protected readonly dashboards = inject(RunDashboardState);
  private readonly runsApi = inject(WorkflowRunsApiService);

  readonly agentKey = input.required<string>();
  /** The conversation's run to open; null starts a new conversation. */
  readonly runId = input<string | null>(null);
  /** The breadcrumb's Agent personas link. */
  readonly back = output<void>();

  protected readonly workflowId = computed(() =>
    bindingOfAgent(this.agentKey()),
  );
  /** `Elena`, from the workflow's agent; the key until it loads. */
  protected readonly agentName = computed(
    () => this.designer.workflow()?.agents[0]?.name ?? 'Elena',
  );
  protected readonly agentRole = computed(
    () => this.designer.workflow()?.agents[0]?.role ?? 'Insights Lead',
  );
  protected readonly datasets = computed(() => {
    const run = this.designer.run();
    const names = run?.input?.['datasets'];
    return Array.isArray(names)
      ? names.filter((n): n is string => typeof n === 'string')
      : [];
  });
  /** The conversation shown: its first run's id. */
  protected readonly currentId = computed(() => {
    const run = this.designer.run();
    return run === null ? null : (run.conversationId ?? run.id);
  });
  /** A run of the shown conversation started or ended: the panel reloads. */
  protected readonly refreshKey = computed(() => {
    const result = this.designer.runResult();
    return result === null ? null : `${result.runId ?? ''}:${result.status}`;
  });

  private subscription: Subscription | undefined;

  constructor() {
    effect(() => {
      const id = this.workflowId();
      const runId = this.runId();
      untracked(() => this.openConversation(id, runId));
    });
    // The shown answer's dashboard opens beside the chat (dashboard-panel).
    effect(() => {
      const dashboard = this.designer.running()
        ? null
        : (this.designer.runResult()?.answer?.dashboard ?? null);
      untracked(() => this.dashboards.follow(dashboard));
    });
    inject(DestroyRef).onDestroy(() => {
      this.subscription?.unsubscribe();
      this.designer.clear();
      this.dashboards.reset();
    });
  }

  private openConversation(workflowId: string, runId: string | null): void {
    this.subscription?.unsubscribe();
    // Already showing it (the run just started by a message): keep the stream.
    if (runId !== null && this.designer.run()?.id === runId) return;
    if (runId === null) {
      this.designer.load(workflowId);
      return;
    }
    this.subscription = this.runsApi.getRun(runId).subscribe({
      next: (run) => {
        this.designer.showRunOnLoad(run);
        this.designer.load(workflowId);
      },
      error: () => this.designer.load(workflowId),
    });
  }

  /** A row of the panel: that conversation's newest run. */
  protected openFromPanel(conversation: ConversationSummary): void {
    this.subscription?.unsubscribe();
    this.subscription = this.runsApi.getRun(conversation.lastRunId).subscribe({
      next: (run) => {
        this.designer.clear();
        this.designer.showRunOnLoad(run);
        this.designer.load(this.workflowId());
      },
    });
  }

  /** The panel's New conversation: the chat drops the run shown. */
  protected newConversation(): void {
    this.designer.newQuestion();
  }

  protected readonly openQuery = computed(() => {
    const index = this.designer.openQueryIndex();
    const answer =
      this.designer.queryRun()?.answer ??
      this.designer.runResult()?.answer ??
      null;
    return index !== null &&
      answer !== null &&
      answer.data?.[index] !== undefined
      ? { index, answer }
      : null;
  });

  protected closeQuery(): void {
    focusQueryOpener(this.designer.closeQuery());
  }
}
