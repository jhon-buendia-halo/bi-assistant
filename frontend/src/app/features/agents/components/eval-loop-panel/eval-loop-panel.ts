/**
 * "Loop run" (`docs/plans/improvement-loop-execution.md` §2.6/§3 U2-G): queue
 * one run per suite × arm, poll the loop until every job finishes, and show a
 * suite × arm matrix (pass^k, mean, flaky, gaps, tokens, $/correct) with an
 * "Open run" link per cell. Self-contained — the parent hands it a suite
 * catalog, a datasource and the arm presets (from `GET /engine/settings`),
 * and only finds out what happened through `openRun` (switch to Executions
 * and expand that job) and `closed`.
 */
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
  LucideAngularModule,
  ExternalLink,
  Layers,
  Loader2,
  Play,
  X,
} from 'lucide-angular';
import type { EngineOptions } from '../../../engine/models/engine.model';
import { AgentsApiService } from '../../services/agents-api.service';
import {
  EvalLoopRequest,
  EvalLoopSummaryRow,
  EvalRepeat,
  AgentEvalSet,
  EvalRunView,
  LoopStatus,
  armLabel,
  formatRate,
} from '../../models/eval.model';

@Component({
  selector: 'app-eval-loop-panel',
  imports: [LucideAngularModule],
  templateUrl: './eval-loop-panel.html',
  styleUrl: './eval-loop-panel.scss',
})
export class EvalLoopPanel implements OnDestroy {
  readonly ExternalLink = ExternalLink;
  readonly Layers = Layers;
  readonly Loader2 = Loader2;
  readonly Play = Play;
  readonly X = X;

  private readonly api = inject(AgentsApiService);

  readonly agentKey = input.required<string>();
  readonly datasourceId = input.required<string>();
  /** The question sets (one per suite) the loop can cover. */
  readonly sets = input<AgentEvalSet[]>([]);
  readonly arms = input<Record<string, Partial<EngineOptions>>>({});
  readonly armDescriptions = input<Record<string, string>>({});

  /** The panel was dismissed without necessarily finishing. */
  readonly closed = output<void>();
  /** A matrix cell's "Open run" was clicked — the job to switch Executions to. */
  readonly openRun = output<string>();

  readonly selectedSuiteIds = signal<Set<string>>(new Set());
  readonly selectedArms = signal<Set<string>>(new Set(['baseline']));
  readonly repeat = signal<EvalRepeat>(3);
  readonly label = signal('');
  readonly categoriesText = signal('');
  readonly includeVariants = signal(false);

  readonly starting = signal(false);
  readonly error = signal<string | null>(null);
  readonly loopId = signal<string | null>(null);
  readonly loopStatus = signal<LoopStatus | null>(null);
  readonly loopJobs = signal<EvalRunView[]>([]);
  readonly loopRows = signal<EvalLoopSummaryRow[]>([]);
  private pollTimer: ReturnType<typeof setTimeout> | undefined;

  readonly armNames = computed(() => {
    const names = Object.keys(this.arms());
    return names.length > 0 ? names : ['baseline'];
  });

  readonly running = computed(() => this.loopStatus() === 'running');
  readonly armLabel = armLabel;
  readonly rateLabel = formatRate;

  toggleSuite(id: string): void {
    this.selectedSuiteIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  isSuiteSelected(id: string): boolean {
    return this.selectedSuiteIds().has(id);
  }

  toggleArm(name: string): void {
    this.selectedArms.update((set) => {
      const next = new Set(set);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  isArmSelected(name: string): boolean {
    return this.selectedArms().has(name);
  }

  onRepeatChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    this.repeat.set((value === 3 || value === 5 ? value : 1) as EvalRepeat);
  }

  onLabelInput(event: Event): void {
    this.label.set((event.target as HTMLInputElement).value);
  }

  onCategoriesInput(event: Event): void {
    this.categoriesText.set((event.target as HTMLInputElement).value);
  }

  toggleIncludeVariants(): void {
    this.includeVariants.set(!this.includeVariants());
  }

  /**
   * "≈ N turns (cases × repeat × arms)" — an honest cost preview before a
   * single token is spent, from the sets' own case counts.
   */
  readonly estimatedTurns = computed(() => {
    const cases = this.sets()
      .filter((set) => this.selectedSuiteIds().has(set.id))
      .reduce((sum, set) => sum + set.cases.length, 0);
    return cases * this.repeat() * Math.max(1, this.selectedArms().size);
  });

  readonly canStart = computed(
    () =>
      !this.starting() &&
      !this.running() &&
      this.selectedSuiteIds().size > 0 &&
      this.selectedArms().size > 0 &&
      !!this.datasourceId(),
  );

  startLoop(): void {
    if (!this.canStart()) return;
    this.starting.set(true);
    this.error.set(null);
    this.loopRows.set([]);
    this.loopJobs.set([]);

    const categories = this.categoriesText()
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const body: EvalLoopRequest = {
      datasourceId: this.datasourceId(),
      suiteIds: [...this.selectedSuiteIds()],
      repeat: this.repeat(),
      arms: [...this.selectedArms()],
      label:
        this.label().trim() ||
        `loop-${new Date().toISOString().slice(0, 19)}`,
      ...(this.includeVariants() ? { includeVariants: true } : {}),
      ...(categories.length ? { categories } : {}),
    };

    this.api.startLoop(this.agentKey(), body).subscribe({
      next: (res) => {
        this.starting.set(false);
        if (!res.ok || !res.loopId) {
          this.error.set(res.message);
          return;
        }
        this.loopId.set(res.loopId);
        this.loopStatus.set('running');
        this.pollLoop(res.loopId);
      },
      error: (err) => {
        this.starting.set(false);
        this.error.set(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  private pollLoop(loopId: string): void {
    this.api.getLoop(this.agentKey(), loopId).subscribe({
      next: (view) => {
        if (!view.ok) {
          this.loopStatus.set('failed');
          this.error.set(view.message ?? 'The loop failed');
          return;
        }
        this.loopJobs.set(view.jobs ?? []);
        this.loopRows.set(view.summary?.rows ?? []);
        if (view.status === 'running') {
          this.pollTimer = setTimeout(() => this.pollLoop(loopId), 1500);
          return;
        }
        this.loopStatus.set(view.status ?? 'completed');
      },
      error: (err) => {
        this.loopStatus.set('failed');
        this.error.set(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  /** The job a matrix cell's suite×arm belongs to, so "Open run" can select it. */
  jobFor(row: EvalLoopSummaryRow): EvalRunView | undefined {
    return this.loopJobs().find(
      (job) =>
        job.suiteId === row.suite &&
        armLabel(job.arm) === armLabel(row.arm),
    );
  }

  openCell(row: EvalLoopSummaryRow): void {
    const job = this.jobFor(row);
    if (job) this.openRun.emit(job.jobId);
  }

  costPerCorrectCellLabel(row: EvalLoopSummaryRow): string {
    return row.costPerCorrectUsd === undefined
      ? '—'
      : `$${row.costPerCorrectUsd.toFixed(4)}`;
  }

  close(): void {
    clearTimeout(this.pollTimer);
    this.closed.emit();
  }

  ngOnDestroy(): void {
    clearTimeout(this.pollTimer);
  }
}
