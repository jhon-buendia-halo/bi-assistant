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
import { WorkflowRunInputRequired } from '../../../workflows/components/workflow-run-input-required/workflow-run-input-required';
import {
  WorkflowRun,
  WorkflowWaitingFor,
} from '../../../workflows/models/workflow.model';
import {
  RunStreamHandlers,
  WorkflowRunsApiService,
} from '../../../workflows/services/workflow-runs-api.service';
import { TryItInspector } from '../../services/try-it-inspector';

/** What the backend refuses a draft run with when no dataset exists (api.md R12). */
export const NO_DATASET_TRY_MESSAGE = 'Select at least one dataset to preview';

/** What Try it has to show. */
type TryState =
  | { kind: 'idle' }
  | { kind: 'running'; reasoning: string }
  | { kind: 'done'; run: WorkflowRun }
  | {
      kind: 'waiting';
      run: WorkflowRun;
      waiting: WorkflowWaitingFor;
      /** The server refused the answer; the draft still waits. */
      error: string | null;
    }
  | { kind: 'stopped' }
  | { kind: 'error'; message: string };

/**
 * Try it (agents-evals R60, R61; ui.md 4.5.1, 4.5.8): runs a user agent's
 * saved draft once on a question, the way a workflow runs, and shows the
 * answer. When the agent asks the user, the run waits (a card with the
 * question, ui.md 4.5.x) and the answer continues the same draft (api.md 169);
 * a draft that expired offers a rerun with the answer added to the question.
 * Nothing is stored: Reset, and leaving, drop the result, and the backend
 * discards the run's host and workspace when the run ends.
 */
@Component({
  selector: 'app-agent-try-it',
  imports: [AnswerView, LucideAngularModule, WorkflowRunInputRequired],
  templateUrl: './agent-try-it.html',
  host: { class: 'flex min-h-0 flex-col', 'data-testid': 'agent-tryit' },
})
export class AgentTryIt implements OnDestroy {
  protected readonly Loader2 = Loader2;
  protected readonly Play = Play;
  protected readonly RotateCcw = RotateCcw;
  protected readonly Square = Square;

  private readonly runs = inject(WorkflowRunsApiService);
  /** The inspector's state; its sheet is in the app's main column. */
  protected readonly inspector = inject(TryItInspector);

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
    if (state.kind !== 'done') return null;
    return (this.inspector.run() ?? state.run).answer ?? null;
  });
  protected readonly waiting = computed((): WorkflowWaitingFor | null => {
    const state = this.state();
    return state.kind === 'waiting' ? state.waiting : null;
  });
  protected readonly waitingError = computed((): string | null => {
    const state = this.state();
    return state.kind === 'waiting' ? state.error : null;
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
  /** The draft run's id, from the stream's `run` event. */
  private draftRunId: string | null = null;
  /** The question of the stream's `input-required` event, until `done` carries it too. */
  private asked: WorkflowWaitingFor | null = null;

  ngOnDestroy(): void {
    this.cancel();
    this.inspector.forget();
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
    this.inspector.begin(this.question().trim());
    this.draftRunId = null;
    this.asked = null;
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
    const abort = this.newAbort();
    await this.runs.streamDraftRun(
      id,
      this.question().trim(),
      this.handlers(current),
      abort.signal,
    );
    if (abort === this.abort) this.abort = null;
  }

  /** Answer the question the draft waits on (api.md 169): the same draft continues. */
  async resume(answer: string): Promise<void> {
    const state = this.state();
    const id = this.agentId();
    const text = answer.trim();
    if (state.kind !== 'waiting' || state.waiting.expired || !text) return;
    if (id === null) return;
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    this.abort?.abort();
    this.state.set({ kind: 'running', reasoning: '' });
    const abort = this.newAbort();
    let refused: number | null = null;
    const base = this.handlers(current);
    await this.runs.resumeDraftRun(
      id,
      this.draftRunId ?? state.run.id,
      state.waiting.stepId,
      text,
      {
        ...base,
        onRefused: (status) => {
          refused = status;
        },
        onError: (message) => {
          if (!current()) return;
          if (refused === null) {
            base.onError?.(message);
          } else if (refused === 410) {
            // The 30 minutes passed or the app restarted: rerun with the answer.
            this.state.set({
              ...state,
              waiting: { ...state.waiting, expired: true },
              error: null,
            });
          } else {
            this.state.set({ ...state, error: message });
          }
        },
      },
      abort.signal,
    );
    if (abort === this.abort) this.abort = null;
  }

  /** An expired draft: run again with the answer added to the question. */
  rerunWithAnswer(answer: string): void {
    const text = answer.trim();
    if (!text || this.running()) return;
    this.question.set(`${this.question().trim()}\n${text}`);
    void this.run();
  }

  private newAbort(): AbortController {
    const abort = new AbortController();
    this.abort = abort;
    return abort;
  }

  private handlers(current: () => boolean): RunStreamHandlers {
    return {
      onReasoning: (delta) => {
        const state = this.state();
        if (current() && state.kind === 'running') {
          this.state.set({
            kind: 'running',
            reasoning: `${state.reasoning}${delta}`.slice(-400),
          });
        }
      },
      // The stream's first event, `run`, carries the draft run's id.
      onRun: ({ runId }) => {
        if (!current()) return;
        this.draftRunId = runId;
        this.inspector.setRunId(runId);
      },
      onInputRequired: (event) => {
        if (current()) this.asked = event;
      },
      onDone: (run) => {
        if (!current()) return;
        const waiting =
          run.status === 'suspended' ? (run.waitingFor ?? this.asked) : null;
        this.asked = null;
        if (waiting) {
          this.state.set({ kind: 'waiting', run, waiting, error: null });
          return;
        }
        this.inspector.finish(run);
        this.state.set({ kind: 'done', run });
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
    };
  }

  /** Stop the run: the backend ends it and keeps nothing. */
  stop(): void {
    if (!this.running()) return;
    this.cancel();
    this.inspector.forget();
    this.state.set({ kind: 'stopped' });
  }

  /** Drop the question and the result. */
  reset(): void {
    this.cancel();
    this.question.set('');
    this.inspector.forget();
    this.refused.set(null);
    this.state.set({ kind: 'idle' });
  }

  private cancel(): void {
    this.generation++;
    this.abort?.abort();
    this.abort = null;
  }
}
