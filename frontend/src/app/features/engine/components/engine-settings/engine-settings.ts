import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ChevronDown, Loader2, LucideAngularModule } from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import { EngineApiService } from '../../services/engine-api.service';
import {
  CarefulMode,
  ContextMode,
  EngineOptions,
  EngineReasoningEffort,
  EngineRuleGroup,
  EngineSettingsSaveRequest,
  EngineSettingsView,
  engineDiff,
} from '../../models/engine.model';

/** Router id shape the judge model must satisfy — mirrors the backend's `JUDGE_MODEL_PATTERN`. */
const JUDGE_MODEL_PATTERN = /^[a-z0-9-]+\/[\w.:-]+$/i;

/** Placeholder shown only until the first `GET /engine/settings` resolves. */
const EMPTY_OPTIONS: EngineOptions = {
  careful: 'off',
  answerReview: false,
  sqlRepair: true,
  repairIntentGuard: true,
  context: 'curated',
  columnProfiles: false,
  inlineKnowledge: false,
  rankedKnowledge: false,
  lookupTools: false,
  sqlPrecheck: false,
  descriptiveErrors: false,
  extendedGuards: false,
  staticFirstContext: false,
  promptAblation: [],
};

type LeverGroup = 'context' | 'tools' | 'pipeline';
type LeverKind = 'boolean' | 'context' | 'careful' | 'effort' | 'max-steps';

export interface LeverField {
  key: keyof EngineOptions;
  group: LeverGroup;
  kind: LeverKind;
  label: string;
  description: string;
  /** Lever id from the engineering plan (L1–L5), or a hardening item (WS0). */
  leverId: string;
}

/** One row per `EngineOptions` field (`promptAblation` gets its own Prompt section). */
export const LEVER_FIELDS: LeverField[] = [
  {
    key: 'context',
    group: 'context',
    kind: 'context',
    label: 'Context depth',
    description:
      'Curated includes Knowledge, Metrics and verified queries; bare is schema only — what a new customer gets on day one.',
    leverId: 'L2',
  },
  {
    key: 'columnProfiles',
    group: 'context',
    kind: 'boolean',
    label: 'Column profiles',
    description:
      'Per-entity schema cards and column profiles (null rate, distinct count, top values) in describe_entity.',
    leverId: 'L2',
  },
  {
    key: 'inlineKnowledge',
    group: 'context',
    kind: 'boolean',
    label: 'Inline knowledge',
    description:
      'A Knowledge snippet about a column is rendered beside that column instead of only in the Knowledge block.',
    leverId: 'L2',
  },
  {
    key: 'rankedKnowledge',
    group: 'context',
    kind: 'boolean',
    label: 'Ranked knowledge & metrics',
    description:
      'Knowledge and Metrics ranked by relevance to the question instead of newest-first.',
    leverId: 'L2',
  },
  {
    key: 'lookupTools',
    group: 'context',
    kind: 'boolean',
    label: 'Lookup tools',
    description:
      'lookup_values and lookup_knowledge tools are available to the assistant.',
    leverId: 'L2',
  },
  {
    key: 'sqlRepair',
    group: 'tools',
    kind: 'boolean',
    label: 'SQL fixer',
    description:
      'Automatic repair loop retries a failed query. Off = the assistant (which knows the question) retries instead, with a descriptive error.',
    leverId: 'L3',
  },
  {
    key: 'repairIntentGuard',
    group: 'tools',
    kind: 'boolean',
    label: 'Repair intent guard',
    description:
      "Deterministic diff of original vs. repaired SQL; warns when a repair changed the question's intent.",
    leverId: 'WS0',
  },
  {
    key: 'descriptiveErrors',
    group: 'tools',
    kind: 'boolean',
    label: 'Descriptive errors',
    description:
      'Errors name the closest columns/tables, types and known values instead of a raw driver message.',
    leverId: 'L3',
  },
  {
    key: 'sqlPrecheck',
    group: 'tools',
    kind: 'boolean',
    label: 'SQL precheck',
    description:
      'Parse-validate-enrich the SQL before execution — zero tokens, warnings only, never blocks the query.',
    leverId: 'L3',
  },
  {
    key: 'extendedGuards',
    group: 'tools',
    kind: 'boolean',
    label: 'Extended guards',
    description:
      'Extra result checks: a constant metric of any value, id-only projections, a missing default filter.',
    leverId: 'L3',
  },
  {
    key: 'staticFirstContext',
    group: 'tools',
    kind: 'boolean',
    label: 'Static-first context',
    description:
      'Static context blocks first, dynamic (visuals, verified pairs) last — better prompt caching.',
    leverId: 'L3',
  },
  {
    key: 'careful',
    group: 'pipeline',
    kind: 'careful',
    label: 'Careful mode',
    description:
      "An independent re-derivation of the answer's SQL, used as a cross-check. auto runs it only for risky categories or a turn where a guard fired.",
    leverId: 'L4',
  },
  {
    key: 'answerReview',
    group: 'pipeline',
    kind: 'boolean',
    label: 'Answer review',
    description:
      'One review call over the transcript, with a corrective pass when it finds something wrong.',
    leverId: 'L4',
  },
  {
    key: 'reasoningEffort',
    group: 'pipeline',
    kind: 'effort',
    label: 'Reasoning effort override',
    description:
      'Overrides Settings → LLM reasoning effort for every turn. None = use the configured effort.',
    leverId: 'L1',
  },
  {
    key: 'maxSteps',
    group: 'pipeline',
    kind: 'max-steps',
    label: 'Max tool-call steps',
    description:
      "Overrides the assistant's max tool-call steps for a turn. Blank = the built-in default.",
    leverId: '—',
  },
];

/**
 * Settings → Engine levers. Loads `GET /engine/settings`, lets the operator
 * edit every `EngineOptions` field grouped by what it touches, and saves
 * through `PUT /engine/settings`. These are the *production* defaults every
 * chat turn resolves against — an eval run overrides them per arm without
 * touching what is saved here (`docs/plans/improvement-loop-engineering.md`).
 */
@Component({
  selector: 'app-engine-settings',
  imports: [LucideAngularModule],
  templateUrl: './engine-settings.html',
  styleUrl: './engine-settings.scss',
})
export class EngineSettings implements OnInit {
  readonly Loader2 = Loader2;
  readonly ChevronDown = ChevronDown;

  readonly contextFields = LEVER_FIELDS.filter((f) => f.group === 'context');
  readonly toolFields = LEVER_FIELDS.filter((f) => f.group === 'tools');
  readonly pipelineFields = LEVER_FIELDS.filter((f) => f.group === 'pipeline');

  private readonly api = inject(EngineApiService);
  private readonly toast = inject(ToastService);

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly resetting = signal(false);
  readonly armsOpen = signal(false);

  /** Working copy the operator edits; starts as the resolved production defaults. */
  readonly options = signal<EngineOptions>(EMPTY_OPTIONS);
  /** Raw text of the max-steps input, so a blank or in-progress value never crashes parsing. */
  readonly maxStepsText = signal('');
  /** Today's engine, unaffected by anything saved — the reference for "changed" badges and Reset. */
  readonly productionDefaults = signal<EngineOptions | null>(null);
  readonly arms = signal<Record<string, Partial<EngineOptions>>>({});
  readonly armDescriptions = signal<Record<string, string>>({});
  readonly ruleGroups = signal<EngineRuleGroup[]>([]);
  readonly ablatableGroups = computed(() =>
    this.ruleGroups().filter((g) => g.ablatable),
  );

  readonly judgeModel = signal('');
  readonly databricksReasoningEffort = signal(false);

  /** True once any lever control has been touched in this session. */
  readonly leversDirty = signal(false);

  readonly judgeModelError = computed<string | null>(() => {
    const value = this.judgeModel().trim();
    if (!value) return null;
    return JUDGE_MODEL_PATTERN.test(value)
      ? null
      : 'Must look like "<provider>/<model>", e.g. openai/gpt-4.1-mini';
  });

  readonly canSave = computed(
    () => !this.saving() && !this.resetting() && !this.judgeModelError(),
  );

  /** Option keys whose current value differs from `productionDefaults` — drives the "changed" badge. */
  readonly changedKeys = computed<Set<string>>(() => {
    const prod = this.productionDefaults();
    if (!prod) return new Set();
    return new Set(
      engineDiff(this.options(), prod).map((pair) =>
        pair.slice(0, pair.indexOf('=')),
      ),
    );
  });

  readonly armNames = computed(() => Object.keys(this.arms()));

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.getSettings().subscribe({
      next: (view) => this.applySettings(view),
      error: (err) => {
        this.loading.set(false);
        this.loadError.set(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  private applySettings(view: EngineSettingsView): void {
    this.options.set(view.defaults);
    this.maxStepsText.set(
      view.defaults.maxSteps != null ? String(view.defaults.maxSteps) : '',
    );
    this.productionDefaults.set(view.productionDefaults);
    this.judgeModel.set(view.judgeModel ?? '');
    this.databricksReasoningEffort.set(view.databricksReasoningEffort);
    this.arms.set(view.arms);
    this.armDescriptions.set(view.armDescriptions);
    this.ruleGroups.set(view.ruleGroups);
    this.leversDirty.set(false);
    this.loading.set(false);
  }

  isChanged(key: keyof EngineOptions): boolean {
    return this.changedKeys().has(key as string);
  }

  booleanValue(key: keyof EngineOptions): boolean {
    return Boolean(this.options()[key]);
  }

  setBoolean(key: keyof EngineOptions, value: boolean): void {
    this.options.update((o) => ({ ...o, [key]: value }));
    this.leversDirty.set(true);
  }

  setContext(value: string): void {
    if (value !== 'curated' && value !== 'bare') return;
    this.options.update((o) => ({ ...o, context: value as ContextMode }));
    this.leversDirty.set(true);
  }

  setCareful(value: string): void {
    if (value !== 'off' && value !== 'on' && value !== 'auto') return;
    this.options.update((o) => ({ ...o, careful: value as CarefulMode }));
    this.leversDirty.set(true);
  }

  setReasoningEffort(value: string): void {
    this.options.update((o) => {
      const next = { ...o };
      if (value === 'low' || value === 'medium' || value === 'high') {
        next.reasoningEffort = value as EngineReasoningEffort;
      } else {
        delete next.reasoningEffort;
      }
      return next;
    });
    this.leversDirty.set(true);
  }

  setMaxSteps(text: string): void {
    this.maxStepsText.set(text);
    const trimmed = text.trim();
    this.options.update((o) => {
      const next = { ...o };
      const parsed = Number(trimmed);
      if (!trimmed) {
        delete next.maxSteps;
      } else if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 50) {
        next.maxSteps = parsed;
      }
      // An unparsable / out-of-range value is left as typed in the input
      // (maxStepsText) but does not change `options` — nothing is sent for
      // it until it resolves to a valid step count.
      return next;
    });
    this.leversDirty.set(true);
  }

  isGroupAblated(id: string): boolean {
    const list = this.options().promptAblation;
    return list.includes('*') || list.includes(id);
  }

  toggleRuleGroup(id: string): void {
    const list = this.options().promptAblation;
    let next: string[];
    if (list.includes('*')) {
      next = this.ablatableGroups()
        .map((g) => g.id)
        .filter((groupId) => groupId !== id);
    } else if (list.includes(id)) {
      next = list.filter((groupId) => groupId !== id);
    } else {
      next = [...list, id];
    }
    this.options.update((o) => ({ ...o, promptAblation: next }));
    this.leversDirty.set(true);
  }

  removeAllRuleGroups(): void {
    this.options.update((o) => ({ ...o, promptAblation: ['*'] }));
    this.leversDirty.set(true);
  }

  restoreAllRuleGroups(): void {
    this.options.update((o) => ({ ...o, promptAblation: [] }));
    this.leversDirty.set(true);
  }

  toggleDatabricksReasoningEffort(): void {
    this.databricksReasoningEffort.set(!this.databricksReasoningEffort());
  }

  toggleArmsOpen(): void {
    this.armsOpen.set(!this.armsOpen());
  }

  save(): void {
    if (!this.canSave()) return;
    const body: EngineSettingsSaveRequest = {
      judgeModel: this.judgeModel().trim() || null,
      databricksReasoningEffort: this.databricksReasoningEffort(),
    };
    // Only touch the stored levers when the operator actually changed one —
    // omitting `defaults` leaves them exactly as they were.
    if (this.leversDirty()) {
      body.defaults = this.options();
    }
    this.saving.set(true);
    this.api.saveSettings(body).subscribe({
      next: (res) => {
        this.saving.set(false);
        if (res.ok) {
          this.toast.success(res.message);
          if (res.settings) this.applySettings(res.settings);
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

  resetToDefaults(): void {
    const prod = this.productionDefaults();
    if (!prod || this.resetting() || this.saving()) return;
    this.resetting.set(true);
    this.api.saveSettings({ defaults: prod }).subscribe({
      next: (res) => {
        this.resetting.set(false);
        if (res.ok) {
          this.toast.success(res.message);
          if (res.settings) this.applySettings(res.settings);
        } else {
          this.toast.error(res.message);
        }
      },
      error: (err) => {
        this.resetting.set(false);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }
}
