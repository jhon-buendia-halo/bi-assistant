import { Component, output } from '@angular/core';
import {
  Bot,
  FlaskConical,
  LucideAngularModule,
  PanelRight,
  SquarePen,
  type LucideIconData,
} from 'lucide-angular';

type WelcomeAction = 'datasets' | 'workflows' | 'agents';

interface WelcomeStep {
  title: string;
  text: string;
  icon: LucideIconData;
  action?: { label: string; target: WelcomeAction };
}

/**
 * The start page: what the product does and where to begin (ui.md 4.1,
 * app-shell R51). Each step opens the place it describes.
 */
@Component({
  selector: 'app-welcome',
  imports: [LucideAngularModule],
  template: `
    <section
      class="flex h-full min-h-0 flex-col overflow-y-auto"
      aria-labelledby="welcome-title"
      data-testid="welcome"
    >
      <div class="mx-auto flex w-full max-w-[720px] flex-col gap-4 px-6 py-6">
        <header>
          <h2
            id="welcome-title"
            class="text-[20px] leading-7 font-light tracking-[0.12px] text-fg-strong"
          >
            Welcome to Agentic Hub
          </h2>
          <p class="mt-1 text-[14px] leading-5 text-fg-muted">
            Run a workflow on your data and read the result, with the steps and
            agents behind it.
          </p>
        </header>

        <ol class="flex flex-col gap-2" aria-label="How it works">
          @for (step of steps; track step.title; let i = $index) {
            <li
              class="card flex items-start gap-3 p-3"
              [attr.data-testid]="'welcome-step-' + (i + 1)"
            >
              <span
                class="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-on-primary-soft"
                aria-hidden="true"
              >
                <lucide-angular [img]="step.icon" [size]="18" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-[13px] font-semibold text-fg-strong">
                  <span class="text-fg-muted">{{ i + 1 }}</span>
                  {{ step.title }}
                </p>
                <p class="mt-0.5 text-[13px] leading-5 text-fg-muted">
                  {{ step.text }}
                </p>
              </div>
              @if (step.action; as action) {
                <button
                  type="button"
                  class="btn btn-secondary shrink-0"
                  (click)="act(action.target)"
                >
                  {{ action.label }}
                </button>
              }
            </li>
          }
        </ol>

        <div class="flex justify-center">
          <button
            type="button"
            class="btn btn-primary"
            data-testid="welcome-agents"
            (click)="act('agents')"
          >
            <lucide-angular [img]="Bot" [size]="18" />
            Explore agents
          </button>
        </div>
      </div>
    </section>
  `,
})
export class Welcome {
  readonly Bot = Bot;

  readonly openDatasets = output<void>();
  readonly openWorkflows = output<void>();
  readonly openAgents = output<void>();

  readonly steps: WelcomeStep[] = [
    {
      title: 'Pick your data',
      text: 'A dataset is the set of tables a workflow can use. Create one from a datasource, or use an existing one.',
      icon: FlaskConical,
      action: { label: 'Datasets', target: 'datasets' },
    },
    {
      title: 'Run a workflow',
      text: 'Each workflow runs on an input. Its steps call agents, which explore the data with read-only queries and show how they worked the answer out.',
      icon: SquarePen,
      action: { label: 'Workflows', target: 'workflows' },
    },
    {
      title: 'Agents are the building blocks',
      text: 'Agents use skills and tools. Open one to read how it works, or build your own.',
      icon: Bot,
      action: { label: 'Agents', target: 'agents' },
    },
    {
      title: 'Read, refine, download',
      text: 'Tables, documents and visuals open in the right panel beside a run; download them as PDF or CSV.',
      icon: PanelRight,
    },
  ];

  act(target: WelcomeAction): void {
    if (target === 'datasets') this.openDatasets.emit();
    else if (target === 'agents') this.openAgents.emit();
    else this.openWorkflows.emit();
  }
}
