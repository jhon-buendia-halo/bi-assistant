import { Component, OnInit, inject, signal } from '@angular/core';
import {
  LucideAngularModule,
  ChevronRight,
  CircleCheck,
  CircleX,
  Loader2,
  PlugZap,
  Trash2,
  TriangleAlert,
} from 'lucide-angular';
import {
  PostgresConnectionConfig,
  TestingDataApiService,
  TestingDataFixture,
} from '../../services/testing-data-api.service';
import { DatasourcesApiService } from '../../../datasources/services/datasources-api.service';
import { ToastService } from '../../../../core/toast/toast.service';

const EMPTY_CONNECTION: PostgresConnectionConfig = {
  host: '',
  port: 5432,
  database: '',
  user: '',
  password: '',
  ssl: false,
};

interface InlineResult {
  ok: boolean;
  message: string;
}

/** Everything about one fixture's card — form values, busy flags, confirm gates, feedback. */
interface FixtureFormState {
  connection: PostgresConnectionConfig;
  testing: boolean;
  loadingAction: boolean;
  removing: boolean;
  testResult: InlineResult | null;
  errorMessage: string | null;
  confirmingLoad: boolean;
  confirmingRemove: boolean;
}

function buildConnection(fixture: TestingDataFixture): PostgresConnectionConfig {
  const source = fixture.status.connection ?? fixture.defaults;
  return {
    host: source.host,
    port: source.port,
    database: source.database,
    user: source.user,
    ssl: source.ssl,
    // Connection summaries never carry a password — always start from the
    // fixture default and let the user re-enter or keep it.
    password: fixture.defaults.password,
  };
}

function emptyFormState(fixture: TestingDataFixture): FixtureFormState {
  return {
    connection: buildConnection(fixture),
    testing: false,
    loadingAction: false,
    removing: false,
    testResult: null,
    errorMessage: null,
    confirmingLoad: false,
    confirmingRemove: false,
  };
}

@Component({
  selector: 'app-testing-data-config',
  imports: [LucideAngularModule],
  templateUrl: './testing-data-config.html',
  styleUrl: './testing-data-config.scss',
})
export class TestingDataConfig implements OnInit {
  readonly ChevronRight = ChevronRight;
  readonly CircleCheck = CircleCheck;
  readonly CircleX = CircleX;
  readonly Loader2 = Loader2;
  readonly PlugZap = PlugZap;
  readonly Trash2 = Trash2;
  readonly TriangleAlert = TriangleAlert;

  private readonly api = inject(TestingDataApiService);
  private readonly datasourcesApi = inject(DatasourcesApiService);
  private readonly toast = inject(ToastService);

  // Fixture list, driven entirely by the API — no hardcoded fixture knowledge.
  readonly statusLoading = signal(false);
  readonly fixtures = signal<TestingDataFixture[]>([]);

  // Expand/collapse — mirrors the agent detail "Question sets" list pattern.
  readonly selectedFixtureId = signal<string | null>(null);

  // Per-fixture UI state, keyed by fixture id. This is the main correctness
  // requirement: expanding one card must never leak into another card's
  // form values, busy flags, confirm gates, or messages.
  private readonly formStates = signal<Record<string, FixtureFormState>>({});

  ngOnInit(): void {
    this.refreshStatus();
  }

  private refreshStatus(): void {
    this.statusLoading.set(true);
    this.api.getStatus().subscribe({
      next: (res) => {
        this.statusLoading.set(false);
        this.fixtures.set(res.fixtures);
      },
      error: () => {
        this.statusLoading.set(false);
        // Backend unreachable — leave the last known list as-is.
      },
    });
  }

  selectFixture(fixtureId: string): void {
    const next = this.selectedFixtureId() === fixtureId ? null : fixtureId;
    this.selectedFixtureId.set(next);
    if (next) {
      const fixture = this.fixtures().find((f) => f.id === next);
      if (fixture) this.ensureFormState(fixture);
    }
  }

  private ensureFormState(fixture: TestingDataFixture): void {
    if (this.formStates()[fixture.id]) return;
    this.formStates.update((all) => ({
      ...all,
      [fixture.id]: emptyFormState(fixture),
    }));
  }

  private state(fixtureId: string): FixtureFormState | undefined {
    return this.formStates()[fixtureId];
  }

  private updateState(
    fixtureId: string,
    patch: Partial<FixtureFormState>,
  ): void {
    const current = this.formStates()[fixtureId];
    if (!current) return;
    this.formStates.update((all) => ({
      ...all,
      [fixtureId]: { ...current, ...patch },
    }));
  }

  // --- Template accessors, all keyed by fixture id ---

  connectionFor(fixtureId: string): PostgresConnectionConfig {
    return this.state(fixtureId)?.connection ?? { ...EMPTY_CONNECTION };
  }

  requiredFieldsFilled(fixtureId: string): boolean {
    const c = this.state(fixtureId)?.connection;
    return !!(c && c.host.trim() && c.database.trim() && c.user.trim());
  }

  busy(fixtureId: string): boolean {
    const s = this.state(fixtureId);
    return (
      this.statusLoading() ||
      !!(s && (s.testing || s.loadingAction || s.removing))
    );
  }

  testingFor(fixtureId: string): boolean {
    return !!this.state(fixtureId)?.testing;
  }

  loadingFor(fixtureId: string): boolean {
    return !!this.state(fixtureId)?.loadingAction;
  }

  removingFor(fixtureId: string): boolean {
    return !!this.state(fixtureId)?.removing;
  }

  testResultFor(fixtureId: string): InlineResult | null {
    return this.state(fixtureId)?.testResult ?? null;
  }

  errorFor(fixtureId: string): string | null {
    return this.state(fixtureId)?.errorMessage ?? null;
  }

  confirmingLoadFor(fixtureId: string): boolean {
    return !!this.state(fixtureId)?.confirmingLoad;
  }

  confirmingRemoveFor(fixtureId: string): boolean {
    return !!this.state(fixtureId)?.confirmingRemove;
  }

  // --- Actions ---

  patch(fixtureId: string, change: Partial<PostgresConnectionConfig>): void {
    const state = this.state(fixtureId);
    if (!state) return;
    this.updateState(fixtureId, {
      connection: { ...state.connection, ...change },
      testResult: null,
    });
  }

  testConnection(fixtureId: string): void {
    if (this.busy(fixtureId) || !this.requiredFieldsFilled(fixtureId)) return;
    const state = this.state(fixtureId);
    if (!state) return;
    this.updateState(fixtureId, { testing: true, testResult: null });
    this.datasourcesApi
      .testConnection('postgres', state.connection)
      .subscribe({
        next: (res) => {
          this.updateState(fixtureId, {
            testing: false,
            testResult: { ok: res.ok, message: res.message },
          });
        },
        error: (err) => {
          this.updateState(fixtureId, {
            testing: false,
            testResult: {
              ok: false,
              message: err?.error?.message ?? 'Backend unreachable',
            },
          });
        },
      });
  }

  requestLoad(fixtureId: string): void {
    if (this.busy(fixtureId) || !this.requiredFieldsFilled(fixtureId)) return;
    this.updateState(fixtureId, {
      confirmingRemove: false,
      confirmingLoad: true,
    });
  }

  cancelLoad(fixtureId: string): void {
    this.updateState(fixtureId, { confirmingLoad: false });
  }

  confirmLoad(fixtureId: string): void {
    if (this.busy(fixtureId)) return;
    const state = this.state(fixtureId);
    if (!state) return;
    this.updateState(fixtureId, {
      confirmingLoad: false,
      loadingAction: true,
      errorMessage: null,
    });
    this.api.load(fixtureId, state.connection).subscribe({
      next: (res) => {
        this.updateState(fixtureId, { loadingAction: false });
        if (res.ok) {
          this.toast.success(res.message);
          this.refreshStatus();
        } else {
          this.updateState(fixtureId, { errorMessage: res.message });
        }
      },
      error: (err) => {
        this.updateState(fixtureId, {
          loadingAction: false,
          errorMessage: err?.error?.message ?? 'Backend unreachable',
        });
      },
    });
  }

  requestRemove(fixtureId: string): void {
    if (this.busy(fixtureId)) return;
    this.updateState(fixtureId, {
      confirmingLoad: false,
      confirmingRemove: true,
    });
  }

  cancelRemove(fixtureId: string): void {
    this.updateState(fixtureId, { confirmingRemove: false });
  }

  confirmRemove(fixtureId: string): void {
    if (this.busy(fixtureId)) return;
    this.updateState(fixtureId, {
      confirmingRemove: false,
      removing: true,
      errorMessage: null,
    });
    this.api.remove(fixtureId).subscribe({
      next: (res) => {
        this.updateState(fixtureId, { removing: false });
        if (res.ok) {
          this.toast.success(res.message);
          this.refreshStatus();
        } else {
          this.updateState(fixtureId, { errorMessage: res.message });
        }
      },
      error: (err) => {
        this.updateState(fixtureId, {
          removing: false,
          errorMessage: err?.error?.message ?? 'Backend unreachable',
        });
      },
    });
  }
}
