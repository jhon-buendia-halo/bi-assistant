import {
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  LucideAngularModule,
  Loader2,
  Pencil,
  RotateCcw,
} from 'lucide-angular';
import { AuthService } from '../../../../core/auth/auth.service';
import { ToastService } from '../../../../core/toast/toast.service';
import { AGENT_FIELD_LIMITS } from '../../services/agent-editor.util';
import { AgentPageState } from '../../services/agent-page-state.service';
import {
  brokenLinkMessage,
  brokenLinks,
  draftLinks,
  promptSaveInput,
} from '../../services/agent-page.util';
import {
  AgentDetail,
  AgentsApiService,
} from '../../services/agents-api.service';
import { chipClass, knownLinks } from '../../services/prompt-links';
import { SkillSummary } from '../../services/skills-api.service';
import { LinkedText } from '../linked-text/linked-text';
import { PromptEditor } from '../prompt-editor/prompt-editor';

/**
 * The System Prompt tab (agents-evals R86, R87, ui.md 4.5): the core prompt
 * read-only, and for a user agent its own instructions with Edit, as in the
 * agent-poc reference: link toolbar, a `Linked:` row, broken-link error,
 * Cancel and Save prompt. Save stores the draft with its other fields kept.
 */
@Component({
  selector: 'app-agent-system-prompt',
  imports: [LucideAngularModule, LinkedText, PromptEditor],
  templateUrl: './agent-system-prompt.html',
})
export class AgentSystemPrompt implements OnDestroy {
  readonly Loader2 = Loader2;
  readonly Pencil = Pencil;
  readonly RotateCcw = RotateCcw;

  private readonly api = inject(AgentsApiService);
  private readonly toast = inject(ToastService);
  private readonly pageState = inject(AgentPageState);
  readonly auth = inject(AuthService);

  readonly agent = input.required<AgentDetail>();
  /** The owner's skills; null while loading, which disables Edit. */
  readonly library = input<SkillSummary[] | null>(null);
  /** Emitted after the draft is saved; the page reloads the agent. */
  readonly saved = output<void>();

  readonly limit = AGENT_FIELD_LIMITS.instructions;
  readonly toolbarHint =
    'Type / to link a skill or tool. The agent only gets the skills and tools its instructions link.';

  readonly builtInBanner =
    'Changes apply to every session and agent as soon as you save. Run the evals to check them.';
  readonly builtInToolbarHint =
    'Type / to link a tool. Links here are mentions; the assistant keeps all its tools.';
  readonly builtInToolsNote =
    'The ## Tools list is generated from the tools the assistant gets and is inserted before ## Working rules.';
  readonly builtInDriftNotice =
    "The app's built-in version changed since this was edited. Review it, then save again or reset.";
  readonly builtInLimit = 20000;

  readonly editing = signal(false);
  readonly showShipped = signal(false);
  readonly resetting = signal(false);
  readonly draft = signal('');
  readonly saving = signal(false);

  private readonly agentKey = computed(() => this.agent().key);
  readonly isUserAgent = computed(() => this.agent().kind === 'user');
  readonly canEdit = computed(
    () => this.isUserAgent() && this.auth.can('create-agents'),
  );
  /** A built-in agent's shared prompt (BA-224); the backend sends `prompt`. */
  readonly builtIn = computed(() =>
    this.isUserAgent() ? null : (this.agent().prompt ?? null),
  );
  readonly canEditBuiltIn = computed(
    () => this.builtIn() !== null && this.auth.can('edit-policies'),
  );
  readonly builtInKnown = computed(() => knownLinks([]));
  readonly builtInUnchanged = computed(
    () => this.draft().trim() === (this.builtIn()?.editable ?? '').trim(),
  );
  readonly canSaveBuiltIn = computed(
    () =>
      !this.saving() &&
      !this.builtInUnchanged() &&
      this.draft().trim().length > 0 &&
      this.draft().length <= this.builtInLimit,
  );
  /** The draft's instructions, else the Live version's (R6). */
  readonly instructions = computed(() => {
    const agent = this.agent();
    return (agent.draft ?? agent.live)?.instructions ?? '';
  });
  readonly known = computed(() => knownLinks(this.library() ?? []));
  readonly links = computed(() => draftLinks(this.draft(), this.known()));
  readonly broken = computed(() => brokenLinks(this.links()));
  readonly brokenMessage = computed(() => brokenLinkMessage(this.broken()));
  readonly unchanged = computed(
    () => this.draft().trim() === this.instructions().trim(),
  );
  readonly canSave = computed(
    () => !this.saving() && !this.unchanged() && this.broken().length === 0,
  );

  chipClass(kind: 'skill' | 'tool', name: string): string {
    return chipClass(kind, name, this.known());
  }

  constructor() {
    // Another agent starts with no edit open.
    effect(() => {
      this.agentKey();
      untracked(() => this.stop());
    });
    // Unsaved typing is asked about before leaving the page.
    effect(() => {
      const dirty =
        this.editing() &&
        !(this.isUserAgent() ? this.unchanged() : this.builtInUnchanged());
      this.pageState.promptDirty.set(dirty);
    });
  }

  startEditing(): void {
    this.draft.set(this.instructions());
    this.editing.set(true);
  }

  startEditingBuiltIn(): void {
    this.draft.set(this.builtIn()?.editable ?? '');
    this.editing.set(true);
  }

  onDraftInput(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  saveBuiltIn(): void {
    if (!this.canSaveBuiltIn()) return;
    const key = this.agent().key;
    this.saving.set(true);
    this.api.savePrompt(key, this.draft()).subscribe({
      next: (res) => {
        this.saving.set(false);
        if (!res.ok) {
          this.toast.error(res.message);
          return;
        }
        this.toast.success(res.message);
        this.stop();
        this.saved.emit();
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  resetBuiltIn(): void {
    const agent = this.agent();
    if (
      !window.confirm(
        `Reset the system prompt of "${agent.name}" to the built-in version?`,
      )
    )
      return;
    this.resetting.set(true);
    this.api.resetPrompt(agent.key).subscribe({
      next: (res) => {
        this.resetting.set(false);
        if (!res.ok) {
          this.toast.error(res.message);
          return;
        }
        this.toast.success(res.message);
        this.stop();
        this.saved.emit();
      },
      error: (err) => {
        this.resetting.set(false);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  cancel(): void {
    this.stop();
  }

  save(): void {
    const agent = this.agent();
    const config = agent.draft ?? agent.live;
    if (!config || !this.canSave()) return;
    this.saving.set(true);
    this.api.saveDraft(agent.key, promptSaveInput(config, this.draft())).subscribe({
      next: (res) => {
        this.saving.set(false);
        if (!res.ok) {
          this.toast.error(res.message);
          return;
        }
        this.toast.success('Draft saved');
        this.stop();
        this.saved.emit();
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  ngOnDestroy(): void {
    this.pageState.promptDirty.set(false);
  }

  private stop(): void {
    this.editing.set(false);
    this.draft.set('');
    this.saving.set(false);
    this.showShipped.set(false);
  }
}
