import {
  Component,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  Loader2,
  LucideAngularModule,
  Play,
  RotateCcw,
  Square,
} from 'lucide-angular';
import { AnswerView } from '../../../sessions/components/answer-view/answer-view';
import { ChatMessage } from '../../../sessions/models/session.model';
import { WorkflowRun } from '../../../workflows/models/workflow.model';
import { WorkflowRunsApiService } from '../../../workflows/services/workflow-runs-api.service';

/** What the backend refuses a draft run with when no dataset exists (api.md R12). */
export const NO_DATASET_TRY_MESSAGE = 'Select at least one dataset to preview';

/** What Try it has to show. */
type TryState =
  | { kind: 'idle' }
  | { kind: 'running'; reasoning: string }
  | { kind: 'done'; run: WorkflowRun }
  | { kind: 'stopped' }
  | { kind: 'error'; message: string };

/**
 * Try it (agents-evals R60, R61; ui.md 4.5.1, 4.5.8): runs a user agent's
 * saved draft once on a question, the way a workflow runs, and shows the
 * answer. Nothing is stored: Reset, and leaving, drop the result, and the
 * backend discards the run's host and workspace when the run ends.
 */
@Component({
  selector: 'app-agent-try-it',
  imports: [AnswerView, LucideAngularModule],
  templateUrl: './agent-try-it.html',
  host: { class: 'flex min-h-0 flex-col', 'data-testid': 'agent-tryit' },
})
export class AgentTryIt implements OnDestroy {
  protected readonly Loader2 = Loader2;
  protected readonly Play = Play;
  protected readonly RotateCcw = RotateCcw;
  protected readonly Square = Square;

  private readonly runs = inject(WorkflowRunsApiService);

  /** The agent's id; for a new agent it is known once `beforeRun` has saved it. */
  readonly agentId = input<string | null>(null);
  /** Why the draft can't run (no dataset); the question box is then hidden. */
  readonly blocked = input<string | null>(null);
  /** Shows an Edit link beside the blocked message. */
  readonly editable = input(false);
  /** Runs before each run; the editor saves the form here. `false` stops the run. */
  readonly beforeRun = input<(() => Promise<boolean>) | null>(null);

  readonly edit = output<void>();

  protected readonly question = signal('');
  protected readonly state = signal<TryState>({ kind: 'idle' });
  /** The backend refused the run for want of a dataset. */
  private readonly refused = signal<string | null>(null);

  protected readonly noDataset = computed(
    () => this.blocked() ?? this.refused(),
  );
  protected readonly running = computed(() => this.state().kind === 'running');
  protected readonly canRun = computed(
    () => !this.running() && this.question().trim() !== '',
  );
  protected readonly answer = computed((): ChatMessage | null => {
    const state = this.state();
    return state.kind === 'done' ? (state.run.answer ?? null) : null;
  });
  protected readonly reasoning = computed(() => {
    const state = this.state();
    return state.kind === 'running' ? state.reasoning : '';
  });
  protected readonly errorMessage = computed(() => {
    const state = this.state();
    if (state.kind === 'error') return state.message;
    if (state.kind === 'done' && !state.run.answer) {
      return state.run.error ?? 'The agent gave no answer.';
    }
    return null;
  });

  private abort: AbortController | null = null;
  private generation = 0;

  ngOnDestroy(): void {
    this.cancel();
  }

  protected onInput(event: Event): void {
    this.question.set((event.target as HTMLTextAreaElement).value);
  }

  /** Enter runs, Shift+Enter adds a line. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void this.run();
  }

  /** Run the draft once on the question. */
  async run(): Promise<void> {
    if (!this.canRun()) return;
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    this.state.set({ kind: 'running', reasoning: '' });
    const before = this.beforeRun();
    if (before && !(await before())) {
      if (current()) this.state.set({ kind: 'idle' });
      return;
    }
    const id = this.agentId();
    if (!current()) return;
    if (id === null) {
      this.state.set({ kind: 'idle' });
      return;
    }
    const abort = new AbortController();
    this.abort = abort;
    await this.runs.streamDraftRun(
      id,
      this.question().trim(),
      {
        onReasoning: (delta) => {
          const state = this.state();
          if (current() && state.kind === 'running') {
            this.state.set({
              kind: 'running',
              reasoning: `${state.reasoning}${delta}`.slice(-400),
            });
          }
        },
        onDone: (run) => {
          if (current()) this.state.set({ kind: 'done', run });
        },
        onError: (message) => {
          if (!current()) return;
          if (message === NO_DATASET_TRY_MESSAGE) {
            this.refused.set(message);
            this.state.set({ kind: 'idle' });
          } else {
            this.state.set({ kind: 'error', message });
          }
        },
      },
      abort.signal,
    );
    if (abort === this.abort) this.abort = null;
  }

  /** Stop the run: the backend ends it and keeps nothing. */
  stop(): void {
    if (!this.running()) return;
    this.cancel();
    this.state.set({ kind: 'stopped' });
  }

  /** Drop the question and the result. */
  reset(): void {
    this.cancel();
    this.question.set('');
    this.refused.set(null);
    this.state.set({ kind: 'idle' });
  }

  private cancel(): void {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
  }
}
