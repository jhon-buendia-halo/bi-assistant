import {
  Component,
  OnInit,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { Loader2, LucideAngularModule, Search } from 'lucide-angular';
import { WorkflowSummary } from '../../models/workflow.model';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import {
  buildWorkflowSections,
  workflowsEmptyMessage,
} from '../../services/workflows.util';
import { WorkflowCard } from '../workflow-card/workflow-card';

/**
 * The Workflows page (workflows R5, R6; ui.md 4.4a): every workflow a chat
 * can run, in the Official and Mine sections, with search. Read-only (R3).
 * The search resets each time the page opens.
 */
@Component({
  selector: 'app-workflows-page',
  imports: [LucideAngularModule, WorkflowCard],
  templateUrl: './workflows-page.html',
})
export class WorkflowsPage implements OnInit {
  readonly Loader2 = Loader2;
  readonly Search = Search;

  private readonly api = inject(WorkflowsApiService);

  /** A card's open control; the shell opens the workflow page (R7). */
  readonly openWorkflow = output<string>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly workflows = signal<WorkflowSummary[]>([]);
  readonly query = signal('');

  readonly sections = computed(() =>
    buildWorkflowSections(this.workflows(), this.query()),
  );
  readonly emptyMessage = computed(() =>
    workflowsEmptyMessage(this.query(), this.sections()),
  );

  ngOnInit(): void {
    this.api.getWorkflows().subscribe({
      next: (res) => {
        this.workflows.set(res.workflows);
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
}
