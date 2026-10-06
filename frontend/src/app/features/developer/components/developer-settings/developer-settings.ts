import {
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  LucideAngularModule,
  Loader2,
  PlugZap,
  RotateCw,
  TriangleAlert,
} from 'lucide-angular';
import { BackendStatusService } from '../../../../core/backend-status/backend-status.service';
import { ToastService } from '../../../../core/toast/toast.service';
import {
  DeveloperSettings,
  DeveloperSettingsView,
  EndpointProbeResult,
  normalizeEndpoint,
} from '../../models/developer-settings.model';
import { DeveloperSettingsApiService } from '../../services/developer-settings-api.service';

type EndpointKey = 'phoenix' | 'otlp';

interface EndpointTestState {
  testing: boolean;
  result: EndpointProbeResult | null;
}

const ENDPOINT_LABELS: Record<EndpointKey, string> = {
  phoenix: 'Phoenix endpoint',
  otlp: 'OTLP endpoint',
};

const IDLE_TEST: EndpointTestState = { testing: false, result: null };

@Component({
  selector: 'app-developer-settings',
  imports: [LucideAngularModule],
  templateUrl: './developer-settings.html',
  styleUrl: './developer-settings.scss',
})
export class DeveloperSettingsConfig implements OnInit {
  readonly Loader2 = Loader2;
  readonly PlugZap = PlugZap;
  readonly RotateCw = RotateCw;
  readonly TriangleAlert = TriangleAlert;
  readonly endpointKeys: EndpointKey[] = ['phoenix', 'otlp'];
  readonly endpointLabels = ENDPOINT_LABELS;

  private readonly api = inject(DeveloperSettingsApiService);
  private readonly toast = inject(ToastService);
  private readonly backendStatus = inject(BackendStatusService);

  /** Desktop only: the browser (npm CLI) has no bridge to restart the backend. */
  readonly canRestart = this.backendStatus.canRestart;

  readonly view = signal<DeveloperSettingsView | null>(null);
  readonly enabled = signal(false);
  readonly endpoints = signal<Record<EndpointKey, string>>({
    phoenix: '',
    otlp: '',
  });
  readonly tests = signal<Record<EndpointKey, EndpointTestState>>({
    phoenix: IDLE_TEST,
    otlp: IDLE_TEST,
  });
  readonly saving = signal(false);
  readonly restarting = signal(false);

  readonly errors = computed<Record<EndpointKey, string | null>>(() => {
    const values = this.endpoints();
    const error = (key: EndpointKey) =>
      normalizeEndpoint(values[key])
        ? null
        : `${key === 'phoenix' ? 'Phoenix' : 'OTLP'} endpoint must be an http(s) URL`;
    return { phoenix: error('phoenix'), otlp: error('otlp') };
  });

  private readonly formValue = computed<DeveloperSettings | null>(() => {
    const values = this.endpoints();
    const phoenixEndpoint = normalizeEndpoint(values.phoenix);
    const otlpEndpoint = normalizeEndpoint(values.otlp);
    if (!phoenixEndpoint || !otlpEndpoint) return null;
    return {
      observabilityEnabled: this.enabled(),
      phoenixEndpoint,
      otlpEndpoint,
    };
  });

  readonly canSave = computed(() => {
    const form = this.formValue();
    const saved = this.view()?.saved;
    if (!form || !saved || this.saving()) return false;
    return (
      form.observabilityEnabled !== saved.observabilityEnabled ||
      form.phoenixEndpoint !== saved.phoenixEndpoint ||
      form.otlpEndpoint !== saved.otlpEndpoint
    );
  });

  // A requested restart is done once the status has left 'ready' and come back.
  private sawBackendDown = false;

  constructor() {
    effect(() => {
      const status = this.backendStatus.status();
      if (!untracked(this.restarting)) return;
      if (status !== 'ready') {
        this.sawBackendDown = true;
      } else if (this.sawBackendDown) {
        this.sawBackendDown = false;
        untracked(() => this.load(() => this.restarting.set(false)));
      }
    });
  }

  ngOnInit(): void {
    this.load();
  }

  private load(done?: () => void): void {
    this.api.getSettings().subscribe({
      next: (view) => {
        this.applyView(view);
        done?.();
      },
      error: () => {
        // Backend unreachable — keep whatever is on screen.
        done?.();
      },
    });
  }

  private applyView(view: DeveloperSettingsView): void {
    this.view.set(view);
    this.enabled.set(view.saved.observabilityEnabled);
    this.endpoints.set({
      phoenix: view.saved.phoenixEndpoint,
      otlp: view.saved.otlpEndpoint,
    });
  }

  toggleEnabled(): void {
    this.enabled.update((on) => !on);
  }

  setEndpoint(key: EndpointKey, value: string): void {
    this.endpoints.update((all) => ({ ...all, [key]: value }));
    this.tests.update((all) => ({ ...all, [key]: IDLE_TEST }));
  }

  testEndpoint(key: EndpointKey): void {
    if (this.tests()[key].testing || this.errors()[key]) return;
    this.tests.update((all) => ({
      ...all,
      [key]: { testing: true, result: null },
    }));
    const finish = (result: EndpointProbeResult) =>
      this.tests.update((all) => ({
        ...all,
        [key]: { testing: false, result },
      }));
    this.api.testEndpoint(this.endpoints()[key]).subscribe({
      next: finish,
      error: (err) =>
        finish({
          ok: false,
          message: err?.error?.message ?? 'Backend unreachable',
        }),
    });
  }

  save(): void {
    const form = this.formValue();
    if (!form || !this.canSave()) return;
    this.saving.set(true);
    this.api.saveSettings(form).subscribe({
      next: (res) => {
        this.saving.set(false);
        if (res.ok && res.settings) {
          this.toast.success(res.message);
          this.applyView(res.settings);
        } else {
          this.toast.error(res.message);
        }
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  restart(): void {
    if (this.restarting() || !this.canRestart) return;
    this.sawBackendDown = false;
    this.restarting.set(true);
    void this.backendStatus.restart().then((ok) => {
      if (!ok) this.restarting.set(false);
    });
  }
}
