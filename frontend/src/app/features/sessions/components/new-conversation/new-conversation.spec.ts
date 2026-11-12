import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { App } from '../../../../app';
import { ShellState } from '../../../../core/shell/shell-state';
import { ComposerState } from '../../../../features/sessions/services/composer-state';
import { composerModelLabel } from '../../services/composer-state';

const shellState = () => TestBed.inject(ShellState);
const composerState = () => TestBed.inject(ComposerState);

describe('composerModelLabel (llm-settings R53)', () => {
  const view = {
    provider: 'openai',
    model: 'gpt-4o-mini',
    baseUrl: null,
    apiKeyMasked: null,
    reasoningEffort: 'high',
    configured: true,
    apiStyle: null,
  } as const;

  it('shows the model alone for a built-in provider', () => {
    expect(composerModelLabel(view)).toBe('gpt-4o-mini');
    expect(
      composerModelLabel({
        ...view,
        provider: 'lenai',
        baseUrl: 'https://lenai.example.com',
      }),
    ).toBe('gpt-4o-mini');
  });

  it('shows <model> · <host:port> for a custom endpoint', () => {
    expect(
      composerModelLabel({
        ...view,
        provider: 'custom',
        apiStyle: 'openai',
        model: 'llama3.1:8b',
        baseUrl: 'http://127.0.0.1:8317/v1',
      }),
    ).toBe('llama3.1:8b · 127.0.0.1:8317');
    expect(
      composerModelLabel({
        ...view,
        provider: 'custom',
        apiStyle: 'anthropic',
        model: 'claude-sonnet-5-5',
        baseUrl: 'https://gateway.example.com',
      }),
    ).toBe('claude-sonnet-5-5 · gateway.example.com');
  });

  it('shows <model> · GitHub Copilot for Copilot (R65)', () => {
    expect(
      composerModelLabel({ ...view, provider: 'copilot', model: 'gpt-5' }),
    ).toBe('gpt-5 · GitHub Copilot');
  });

  it('is null when nothing is configured', () => {
    expect(
      composerModelLabel({ ...view, configured: false, model: null }),
    ).toBeNull();
  });
});

function modelChip(el: HTMLElement, text: string): HTMLButtonElement {
  const chip = Array.from(el.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === text,
  );
  if (!chip) throw new Error(`no model chip reading ${text}`);
  return chip;
}

describe('Composer model chip (llm-settings R53)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('shows a custom model with its endpoint host', () => {
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    composerState().openComposer();
    http
      .match((r) => r.url.endsWith('/llm/settings'))
      .forEach((r) =>
        r.flush({
          provider: 'custom',
          model: 'llama3.1:8b',
          baseUrl: 'http://localhost:11434/v1',
          apiKeyMasked: null,
          reasoningEffort: 'high',
          configured: true,
          apiStyle: 'openai',
        }),
      );
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'llama3.1:8b · localhost:11434',
    );
    const chip = modelChip(
      fixture.nativeElement as HTMLElement,
      'llama3.1:8b · localhost:11434',
    );
    expect(chip.getAttribute('title')).toBe('http://localhost:11434/v1');
  });

  it('gives a built-in provider chip no base URL title', () => {
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    composerState().openComposer();
    http
      .match((r) => r.url.endsWith('/llm/settings'))
      .forEach((r) =>
        r.flush({
          provider: 'openai',
          model: 'gpt-4o-mini',
          baseUrl: null,
          apiKeyMasked: '****abcd',
          reasoningEffort: 'high',
          configured: true,
          apiStyle: null,
        }),
      );
    fixture.detectChanges();
    const chip = modelChip(fixture.nativeElement as HTMLElement, 'gpt-4o-mini');
    expect(chip.hasAttribute('title')).toBe(false);
  });
});

describe('New conversation Workflow picker (sessions-chat R64, roadmap 1.23.6)', () => {
  beforeEach(async () => {
    localStorage.removeItem('questions-to-insights:right-panel-width');
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  const summary = {
    kind: 'agent' as const,
    owner: 'Official' as const,
    stepCount: 1,
    bar: 'agent' as const,
    trigger: 'chat' as const,
    input: [],
    picksDatasets: false,
    datasets: [] as string[],
    missingDatasets: [] as string[],
    starterQuestions: [] as string[],
  };
  const assistant = {
    ...summary,
    id: 'agent:assistant',
    name: 'Assistant',
    description: 'Answers questions over the datasets you pick.',
    agents: [{ key: 'assistant', name: 'Questions to Insights Assistant' }],
    picksDatasets: true,
  };
  const v2 = {
    ...summary,
    id: 'qti-v2-turn',
    name: 'Questions to Insights v2',
    description: 'A slimmed-down data analyst under construction.',
    kind: 'code' as const,
    stepCount: 4,
    bar: 'steps' as const,
    agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
    picksDatasets: true,
  };
  const readiness = {
    ...summary,
    id: 'agent:data-readiness',
    name: 'Data Readiness Agent',
    description: 'Checks datasets.',
    agents: [{ key: 'data-readiness', name: 'Data Readiness Agent' }],
    datasets: ['World Cup Core'],
  };
  const rfp = {
    ...summary,
    id: 'agent:rfp',
    name: 'RFP Builder',
    description: 'Builds RFPs.',
    agents: [{ key: 'rfp', name: 'RFP Builder' }],
    datasets: ['Intellify RFP API'],
  };
  const health = {
    ...summary,
    id: 'agent:u-1',
    name: 'Health plan analyst',
    description: 'Answers about the health plan.',
    owner: 'You' as const,
    agents: [{ key: 'u-1', name: 'Health plan analyst' }],
    datasets: ['World Cup Core'],
  };
  const CATALOGUE = [assistant, v2, readiness, rfp, health];

  function open(
    workflows: unknown[] = CATALOGUE,
    start: (app: App) => void = (app) => composerState().openComposer(),
  ) {
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    start(fixture.componentInstance);
    http
      .match((r) => r.url.endsWith('/workflows'))
      .forEach((r) => r.flush({ workflows }));
    fixture.detectChanges();
    return { fixture, http, app: fixture.componentInstance };
  }

  type Fx = { nativeElement: HTMLElement; detectChanges(): void };
  const trigger = (fixture: Fx) =>
    fixture.nativeElement.querySelector(
      '[data-testid="new-session-workflow"]',
    ) as HTMLButtonElement;
  const listbox = (fixture: Fx) =>
    fixture.nativeElement.querySelector(
      '[role="listbox"][aria-label="Workflow"]',
    ) as HTMLElement | null;
  const options = (fixture: Fx) =>
    Array.from(
      fixture.nativeElement.querySelectorAll('[role="option"]'),
    ) as HTMLElement[];
  const optionNames = (fixture: Fx) =>
    options(fixture).map((o) => o.children[0].textContent?.trim());
  const press = (fixture: Fx, key: string) => {
    trigger(fixture).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
  };
  const createButton = (fixture: Fx) =>
    Array.from(fixture.nativeElement.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Create'),
    ) as HTMLButtonElement;
  const postBody = (http: HttpTestingController) =>
    http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/sessions'))
      .request.body;

  it('labels the field Workflow, preselects Assistant and keeps the dataset picker', () => {
    const { fixture } = open();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('#new-session-workflow-label')?.textContent?.trim()).toBe(
      'Workflow',
    );
    expect(trigger(fixture).textContent).toContain('Assistant');
    expect(trigger(fixture).getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('false');
    expect(listbox(fixture)).toBeNull();
    expect(
      el.querySelector('[data-testid="new-session-workflow-description"]')
        ?.textContent,
    ).toContain('Answers questions over the datasets you pick.');
    expect(el.textContent).toContain(
      'Select at least one dataset for this session',
    );
    expect(
      el.querySelector('[data-testid="new-session-workflow-datasets"]'),
    ).toBeNull();
    expect(createButton(fixture).title).toBe(
      'Name the session and select at least one dataset',
    );
    expect(el.querySelector('[data-testid="new-session-agent"]')).toBeNull();
  });

  it('lists the workflows in the catalogue order, each with its name and description', () => {
    const { fixture } = open();
    trigger(fixture).click();
    fixture.detectChanges();
    expect(trigger(fixture).getAttribute('aria-expanded')).toBe('true');
    expect(optionNames(fixture)).toEqual([
      'Assistant',
      'Questions to Insights v2',
      'Data Readiness Agent',
      'RFP Builder',
      'Health plan analyst',
    ]);
    expect(options(fixture)[0].getAttribute('aria-selected')).toBe('true');
    expect(options(fixture)[3].children[1].textContent).toContain(
      rfp.description,
    );
  });

  it('never lists a run workflow, nor preselects one (roadmap 1.23.9)', () => {
    const seq = {
      ...summary,
      id: 'seq-text-demo',
      name: 'Sequential test workflow',
      description: 'A three-step example.',
      kind: 'code' as const,
      stepCount: 3,
      bar: 'steps' as const,
      trigger: 'run' as const,
      agents: [],
      input: [
        { name: 'text', label: 'Text', type: 'textarea', required: true },
      ],
    };
    const { fixture } = open([assistant, v2, seq, readiness], (app) =>
      composerState().openComposer('seq-text-demo'),
    );
    expect(trigger(fixture).textContent).toContain('Assistant');
    trigger(fixture).click();
    fixture.detectChanges();
    expect(optionNames(fixture)).toEqual([
      'Assistant',
      'Questions to Insights v2',
      'Data Readiness Agent',
    ]);
  });

  it('lists a workflow that cannot start disabled with its chatRequirement', () => {
    const { fixture, app } = open([
      assistant,
      { ...rfp, chatRequirement: 'Load the sample first' },
    ]);
    trigger(fixture).click();
    fixture.detectChanges();
    const option = options(fixture)[1];
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(option.children[1].textContent).toContain('Load the sample first');
    option.click();
    fixture.detectChanges();
    expect(composerState().composerWorkflowId()).toBe('agent:assistant');
    expect(listbox(fixture)).not.toBeNull();
  });

  it('shows the datasets of a workflow that brings its own and creates with workflowId and the typed name', () => {
    const { fixture, http, app } = open();
    trigger(fixture).click();
    fixture.detectChanges();
    options(fixture)[3].click();
    fixture.detectChanges();
    expect(listbox(fixture)).toBeNull();
    expect(trigger(fixture).textContent).toContain('RFP Builder');
    const el = fixture.nativeElement as HTMLElement;
    const datasets = el.querySelector(
      '[data-testid="new-session-workflow-datasets"]',
    ) as HTMLElement;
    expect(datasets.textContent).toContain('Datasets');
    expect(datasets.textContent).toContain('Intellify RFP API');
    expect(el.textContent).not.toContain(
      'Select at least one dataset for this session',
    );
    expect(createButton(fixture).title).toBe(
      'Start a session with this workflow',
    );
    composerState().composerName.set('Acme');
    composerState().selectedDatasets.set(new Set(['Ignored']));
    composerState().createSession();
    expect(postBody(http)).toEqual({ workflowId: 'agent:rfp', name: 'Acme' });
  });

  it('creates a workflow that brings its datasets with no name when none is typed', () => {
    const { http, app } = open();
    composerState().pickComposerWorkflow('agent:u-1');
    composerState().createSession();
    expect(postBody(http)).toEqual({ workflowId: 'agent:u-1' });
  });

  it('opens and picks with the keyboard, skipping disabled workflows, and Escape closes', () => {
    const { fixture, app } = open([
      assistant,
      { ...rfp, chatRequirement: 'Load the sample first' },
      health,
    ]);
    press(fixture, 'ArrowDown');
    expect(listbox(fixture)).not.toBeNull();
    press(fixture, 'ArrowDown');
    expect(composerState().composerWorkflowActive()).toBe(2);
    press(fixture, 'ArrowUp');
    expect(composerState().composerWorkflowActive()).toBe(0);
    press(fixture, 'ArrowDown');
    press(fixture, 'Enter');
    expect(composerState().composerWorkflowId()).toBe('agent:u-1');
    expect(listbox(fixture)).toBeNull();
    press(fixture, 'Enter');
    expect(listbox(fixture)).not.toBeNull();
    press(fixture, 'Escape');
    expect(listbox(fixture)).toBeNull();
    expect(composerState().composerWorkflowId()).toBe('agent:u-1');
  });

  it('forgets the pick on the next visit', () => {
    const { app } = open();
    composerState().pickComposerWorkflow('agent:rfp');
    expect(composerState().composerWorkflowId()).toBe('agent:rfp');
    composerState().openComposer();
    expect(composerState().composerWorkflowId()).toBe('agent:assistant');
  });

  it('preselects the workflow it is opened with and keeps the dataset picker for v2', () => {
    const { fixture, app } = open(CATALOGUE, () =>
      composerState().openComposer('qti-v2-turn'),
    );
    const el = fixture.nativeElement as HTMLElement;
    expect(composerState().composerWorkflowId()).toBe('qti-v2-turn');
    expect(trigger(fixture).textContent).toContain('Questions to Insights v2');
    expect(
      el.querySelector('[data-testid="new-session-workflow-description"]')
        ?.textContent,
    ).toContain(v2.description);
    expect(el.textContent).toContain(
      'Select at least one dataset for this session',
    );
    // The preselection is not remembered (R64).
    composerState().openComposer();
    expect(composerState().composerWorkflowId()).toBe('agent:assistant');
  });

  it('falls back to Assistant when the preselected workflow is not offered', () => {
    const { app } = open([assistant, rfp], () => composerState().openComposer('qti-v2-turn'));
    expect(composerState().composerWorkflowId()).toBe('agent:assistant');
  });

  it('requires a name and datasets for v2, then creates with its workflowId', () => {
    const { http, app } = open(CATALOGUE, () => composerState().openComposer('qti-v2-turn'));
    composerState().composerName.set('Q');
    composerState().createSession();
    http.expectNone((r) => r.method === 'POST' && r.url.endsWith('/sessions'));
    composerState().selectedDatasets.set(new Set(['Core']));
    composerState().createSession();
    expect(postBody(http)).toEqual({
      workflowId: 'qti-v2-turn',
      name: 'Q',
      datasets: ['Core'],
    });
  });

  it('creates an Assistant session with the assistant workflow', () => {
    const { http, app } = open();
    composerState().composerName.set('Q');
    composerState().selectedDatasets.set(new Set(['Core']));
    composerState().createSession();
    expect(postBody(http)).toEqual({
      workflowId: 'agent:assistant',
      name: 'Q',
      datasets: ['Core'],
    });
  });

  it('still offers Assistant when the catalogue fails to load', () => {
    const fixture = TestBed.createComponent(App);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const app = fixture.componentInstance;
    composerState().openComposer('qti-v2-turn');
    http
      .match((r) => r.url.endsWith('/workflows'))
      .forEach((r) => r.flush('down', { status: 500, statusText: 'Error' }));
    fixture.detectChanges();
    expect(composerState().composerWorkflowId()).toBe('agent:assistant');
    expect(trigger(fixture).textContent).toContain('Assistant');
  });
});

describe('New conversation without sign-in or permissions (BA-232)', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });


  it('shows the composer Reasoning effort', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    shellState().mainView.set('conversation-new');
    fixture.detectChanges();
    expect(
      element.querySelector('main [title="Reasoning effort"]'),
    ).toBeTruthy();
  });
});
