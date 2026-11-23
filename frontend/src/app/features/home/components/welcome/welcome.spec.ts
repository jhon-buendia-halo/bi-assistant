import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ShellState } from '../../../../core/shell/shell-state';
import { RunsState } from '../../../runs/services/runs-state';
import { SettingsState } from '../../../settings/services/settings-state';
import {
  WorkflowRunSummary,
  WorkflowSummary,
} from '../../../workflows/models/workflow.model';
import { WorkflowDesigner } from '../../../workflows/services/workflow-designer.service';
import { WorkflowsNavState } from '../../../workflows/services/workflows-nav-state';
import { Welcome } from './welcome';

function workflow(id: string, name: string): WorkflowSummary {
  return {
    id,
    name,
    description: `${name} does its job.`,
    kind: 'code',
    owner: 'Official',
    category: { id: 'data-analytics', name: 'Data Analytics' },
    agents: [],
    stepCount: 1,
    trigger: 'run',
    input: [],
    datasets: [],
    missingDatasets: [],
    starterQuestions: [],
  };
}

const CATALOGUE = [
  workflow('orchestrated-answer-michael', 'Answer a Business Question (Avery + Michael)'),
  workflow('review-website', 'Review a Website'),
];

function run(n: number): WorkflowRunSummary {
  return {
    id: `run-${n}`,
    workflowId: 'orchestrated-answer-michael',
    workflowName: 'Answer a Business Question (Avery + Michael)',
    status: n === 2 ? 'failed' : 'success',
    title: `Question ${n}`,
    startedAt: '2026-01-01T00:00:00Z',
  };
}

describe('Welcome, the home page (app-shell R51; ui.md 4.1)', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<Welcome>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Welcome],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function mount(
    opts: {
      datasets?: string[];
      configured?: boolean;
      runs?: WorkflowRunSummary[];
    } = {},
  ): Welcome {
    fixture = TestBed.createComponent(Welcome);
    fixture.detectChanges();
    http
      .expectOne((r) => r.url.endsWith('/workflow-runs'))
      .flush({ runs: opts.runs ?? [] });
    http
      .expectOne((r) => r.url.endsWith('/workflows'))
      .flush({ workflows: CATALOGUE });
    http
      .expectOne((r) => r.url.endsWith('/datasets'))
      .flush({
        datasets: (opts.datasets ?? ['World Cup', 'Formula 1']).map((name) => ({
          name,
          tables: ['t'],
        })),
      });
    http
      .expectOne((r) => r.url.endsWith('/llm/settings'))
      .flush({
        configured: opts.configured ?? true,
        reasoningEffort: 'medium',
      });
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    return fixture.componentInstance;
  }

  const byTestId = <T extends HTMLElement = HTMLElement>(id: string) =>
    el.querySelector<T>(`[data-testid="${id}"]`);

  function type(text: string): void {
    const box = byTestId<HTMLTextAreaElement>('welcome-question')!;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('keeps the brand heading and asks what the user wants to know', () => {
    mount();
    expect(el.querySelector('h2')?.textContent).toContain(
      'Welcome to Halo Workbench',
    );
    expect(el.querySelector('label[for="welcome-question"]')?.textContent).toBe(
      'What do you want to know?',
    );
    expect(byTestId('welcome-setup')).toBeNull();
    expect(
      byTestId<HTMLButtonElement>('welcome-ask-submit')!.disabled,
    ).toBeFalse();
  });

  it('Ask opens Answer a Business Question (Avery + Michael), which runs on the question and the picked datasets', () => {
    const welcome = mount();
    const designer = TestBed.inject(WorkflowDesigner);
    const nav = TestBed.inject(WorkflowsNavState);
    spyOn(designer, 'prefillOnLoad');
    spyOn(nav, 'openWorkflow');

    type('  Goals by team?  ');
    welcome.onPicked(['World Cup']);
    byTestId<HTMLButtonElement>('welcome-ask-submit')!.click();

    expect(designer.prefillOnLoad).toHaveBeenCalledOnceWith(
      { question: 'Goals by team?', datasets: ['World Cup'] },
      { execute: true },
    );
    expect(nav.openWorkflow).toHaveBeenCalledOnceWith(
      'orchestrated-answer-michael',
    );
  });

  it('refuses an empty question, then a question with no dataset, marking only that field', () => {
    mount();
    const nav = TestBed.inject(WorkflowsNavState);
    spyOn(nav, 'openWorkflow');
    const submit = () => {
      byTestId<HTMLButtonElement>('welcome-ask-submit')!.click();
      fixture.detectChanges();
    };

    submit();
    expect(byTestId('welcome-ask-error')?.textContent?.trim()).toBe(
      'Type a question first.',
    );
    expect(byTestId('welcome-question')!.getAttribute('aria-invalid')).toBe(
      'true',
    );

    type('Goals by team?');
    expect(byTestId('welcome-ask-error')).toBeNull();
    submit();
    expect(byTestId('welcome-ask-error')?.textContent?.trim()).toBe(
      'Pick at least one dataset to ask about.',
    );
    expect(
      byTestId('welcome-question')!.getAttribute('aria-invalid'),
    ).toBeNull();
    expect(nav.openWorkflow).not.toHaveBeenCalled();
  });

  it('picks the only dataset there is', () => {
    const welcome = mount({ datasets: ['World Cup'] });
    expect(welcome.picked()).toEqual(['World Cup']);
  });

  it('lists what blocks a first question and disables Ask until it is fixed', () => {
    mount({ datasets: [], configured: false });
    expect(byTestId('welcome-setup-llm')).not.toBeNull();
    expect(byTestId('welcome-setup-datasets')).not.toBeNull();
    expect(
      byTestId<HTMLButtonElement>('welcome-ask-submit')!.disabled,
    ).toBeTrue();

    const shell = TestBed.inject(ShellState);
    spyOn(shell, 'selectArea');
    byTestId('welcome-setup-llm')!.querySelector('button')!.click();
    expect(TestBed.inject(SettingsState).settingsSection()).toBe('llm');
    expect(shell.selectArea).toHaveBeenCalledWith('settings');

    byTestId('welcome-setup-datasets')!.querySelector('button')!.click();
    expect(shell.selectArea).toHaveBeenCalledWith('datasets');
  });

  it('shows the five newest runs, each opening its run, and the other workflows', () => {
    mount({ runs: Array.from({ length: 7 }, (_, i) => run(i + 1)) });
    const rows = el.querySelectorAll('[data-testid^="welcome-run-run-"]');
    expect(rows.length).toBe(5);
    expect(rows[1].textContent).toContain('Failed');

    const runs = TestBed.inject(RunsState);
    spyOn(runs, 'openRun');
    (rows[0] as HTMLButtonElement).click();
    expect(runs.openRun).toHaveBeenCalledOnceWith('run-1');

    expect(byTestId('welcome-workflow-orchestrated-answer-michael')).toBeNull();
    const nav = TestBed.inject(WorkflowsNavState);
    spyOn(nav, 'openWorkflow');
    byTestId<HTMLButtonElement>('welcome-workflow-review-website')!.click();
    expect(nav.openWorkflow).toHaveBeenCalledOnceWith('review-website');
  });

  it('says so when there are no runs yet, and still links Runs, Workflows and Agents', () => {
    mount();
    expect(byTestId('welcome-runs-empty')).not.toBeNull();
    const shell = TestBed.inject(ShellState);
    spyOn(shell, 'selectArea');
    byTestId<HTMLButtonElement>('welcome-all-workflows')!.click();
    byTestId<HTMLButtonElement>('welcome-agents')!.click();
    expect(shell.selectArea).toHaveBeenCalledWith('workflows');
    expect(shell.selectArea).toHaveBeenCalledWith('agents');
  });
});
