import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { EMPTY, of, throwError } from 'rxjs';
import {
  WorkflowDetail,
  WorkflowRun,
  WorkflowRunRequest,
} from '../../models/workflow.model';
import { WorkflowDesigner } from '../../services/workflow-designer.service';
import {
  RunStreamHandlers,
  WorkflowRunsApiService,
} from '../../services/workflow-runs-api.service';
import {
  sampleReadinessPanelItem,
  sampleReadinessReport,
} from '../../../sessions/models/readiness.testing';
import { WorkflowRunChat } from './workflow-run-chat';

const STEP = (id: string, title: string, input: string[], output: string[]) => ({
  id,
  title,
  kind: 'code' as const,
  summary: `${title} summary`,
  input,
  output,
  exits: [],
});

/** A code workflow that calls no agent. */
const SEQ: WorkflowDetail = {
  id: 'three-steps',
  name: 'Three steps',
  description: 'A three-step example.',
  kind: 'code',
  owner: 'Official',
  agents: [],
  stepCount: 3,
  trigger: 'run',
  input: [
    {
      name: 'text',
      label: 'Text',
      type: 'textarea',
      required: true,
      placeholder: 'Paste or type any text',
    },
  ],
  datasets: [],
  missingDatasets: [],
  starterQuestions: [],
  steps: [
    STEP('clean-text', 'Clean text', ['text'], ['text']),
    STEP('count-words', 'Count words', ['text'], ['text', 'words', 'characters']),
    STEP('format-result', 'Format result', ['text', 'words', 'characters'], ['summary']),
  ],
};

const V2: WorkflowDetail = {
  ...SEQ,
  id: 'answer-business-question',
  name: 'Insights Analyst',
  description: 'Answers a question in four steps.',
  trigger: 'run',
  input: [],
  agents: [{ key: 'insights-analyst', name: 'Insights Analyst' }],
  steps: [
    STEP('receive-question', 'Receive question', ['question', 'datasets'], ['question', 'datasets']),
    {
      ...STEP('analyse', 'Analyse', ['question', 'catalog'], ['calls', 'stopped']),
      kind: 'agent',
      agent: {
        name: 'Insights Analyst',
        tools: ['list_entities', 'describe_entity', 'run_readonly_sql'],
        maxSteps: 15,
      },
      exits: [
        { label: 'the model returns an error', outcome: 'fails' },
        { label: 'you stop it', outcome: 'stops' },
      ],
    },
    STEP('wrap-up', 'Wrap up', ['calls', 'stopped'], ['sqlQueries', 'failedQueries', 'rows']),
  ],
};

/** A run stream the test drives: each call is recorded with its handlers. */
class FakeRunsApi {
  calls: {
    workflowId: string;
    body: WorkflowRunRequest;
    handlers: RunStreamHandlers;
    signal?: AbortSignal;
  }[] = [];
  getRun = jasmine.createSpy('getRun');

  inputImageUrl(id: string, path: string): string {
    return `/workflow-runs/${id}/input-image?path=${encodeURIComponent(path)}`;
  }
  stopRun = jasmine.createSpy('stopRun').and.returnValue(EMPTY);
  prepareEvidence = jasmine.createSpy('prepareEvidence').and.returnValue(EMPTY);
  archive = jasmine.createSpy('archive').and.returnValue(of({ ok: true, conversationId: 'run-1', archived: 1 }));
  unarchive = jasmine.createSpy('unarchive').and.returnValue(of({ ok: true, conversationId: 'run-1', unarchived: 1 }));

  streamRun(
    workflowId: string,
    body: WorkflowRunRequest,
    handlers: RunStreamHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    this.calls.push({ workflowId, body, handlers, signal });
    return new Promise<void>(() => undefined);
  }

  resumes: { runId: string; stepId: string; answer: string; handlers: RunStreamHandlers }[] = [];

  resumeRun(
    runId: string,
    stepId: string,
    answer: string,
    handlers: RunStreamHandlers,
  ): Promise<void> {
    this.resumes.push({ runId, stepId, answer, handlers });
    return new Promise<void>(() => undefined);
  }

  get last() {
    return this.calls[this.calls.length - 1];
  }
}

/** A code workflow with one agent step, a question, datasets and a checkbox. */
const ASSISTANT: WorkflowDetail = {
  ...SEQ,
  id: 'answer-business-question',
  name: 'Insights Analyst',
  trigger: 'run',
  stepCount: 1,
  agents: [{ key: 'insights-analyst', name: 'Insights Analyst' }],
  input: [
    {
      name: 'question',
      label: 'Question',
      type: 'textarea',
      required: true,
      placeholder: 'Ask a question about your data',
    },
    { name: 'datasets', label: 'Datasets', type: 'datasets', required: true },
    {
      name: 'verbose',
      label: 'Verbose',
      type: 'boolean',
      required: false,
      default: false,
    },
  ],
  steps: [
    {
      ...STEP('answer', 'Answer', ['question', 'datasets'], ['calls', 'stopped']),
      kind: 'agent',
    },
  ],
};

function seqRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    workflowId: 'three-steps',
    workflowName: 'Three steps',
    input: { text: 'a' },
    status: 'success',
    steps: [],
    datasets: [],
    startedAt: '2026-11-11T10:00:00.000Z',
    ...overrides,
  };
}

function assistantRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return seqRun({
    workflowId: 'answer-business-question',
    workflowName: 'Insights Analyst',
    input: { question: 'Which team scored the most goals?', datasets: [], verbose: false },
    question: 'Which team scored the most goals?',
    steps: [{ id: 'answer', title: 'Answer', status: 'success', output: { stopped: false } }],
    ...overrides,
  });
}

describe('WorkflowRunChat, the Chat column of the Run panel (workflows R7–R13; ui.md 4.4b)', () => {
  let fixture: ComponentFixture<WorkflowRunChat>;
  let designer: WorkflowDesigner;
  let http: HttpTestingController;
  let el: HTMLElement;
  let runs: FakeRunsApi;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowRunChat],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: WorkflowRunsApiService, useFactory: () => new FakeRunsApi() },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    designer = TestBed.inject(WorkflowDesigner);
    runs = TestBed.inject(WorkflowRunsApiService) as unknown as FakeRunsApi;
  });

  afterEach(() => http.verify());

  function open(workflow: WorkflowDetail, afterLoad?: () => void): void {
    designer.load(workflow.id);
    http
      .expectOne((r) => r.url.endsWith(`/workflows/${encodeURIComponent(workflow.id)}`))
      .flush(workflow);
    afterLoad?.();
    fixture = TestBed.createComponent(WorkflowRunChat);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const q = (testId: string) =>
    el.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  const text = (testId: string) => q(testId)?.textContent?.trim() ?? '';

  function click(testId: string): void {
    q(testId)!.click();
    fixture.detectChanges();
  }

  /** Types in the message box at the bottom of the chat. */
  function typeMessage(value: string): void {
    const box = q('run-composer-input') as HTMLTextAreaElement;
    box.value = value;
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /** The message box's Send. */
  function send(): void {
    click('run-composer-send');
  }

  /** Opens the inputs menu behind +, and unfolds a field's entry when given. */
  function openMenu(field?: string): void {
    if (q('run-composer-menu') === null) click('run-composer-plus');
    const item = field === undefined ? null : q(`run-composer-menu-item-${field}`);
    if (item !== null && item.getAttribute('aria-expanded') !== 'true') {
      item.click();
      fixture.detectChanges();
    }
  }

  /** Picks a choice of a pick field (a dataset by name) in the inputs menu. */
  function pickInMenu(field: string, id: string): void {
    openMenu(field);
    click(`run-composer-option-${field}-${id}`);
  }

  describe('Run only (ui.md 4.4b)', () => {
    it('has no tabs and none of the configuration: only the message box', () => {
      open(SEQ);
      expect(el.querySelector('[role="tablist"]')).toBeNull();
      expect(el.querySelector('[role="tab"]')).toBeNull();
      expect(q('workflow-panel-trigger')).toBeNull();
      expect(q('workflow-code')).toBeNull();
      expect(q('run-composer-input')).not.toBeNull();
      expect(q('workflow-run')).toBeNull();
      expect(q('workflow-input-text')).toBeNull();
    });

    it('a workflow without an input shows no message box', () => {
      open(V2);
      expect(q('run-composer')).toBeNull();
    });

    it('Execute workflow on the canvas focuses the message box, once', fakeAsync(() => {
      open(SEQ);
      (document.activeElement as HTMLElement | null)?.blur();
      designer.requestRunForm();
      fixture.detectChanges();
      tick();
      expect(document.activeElement).toBe(q('run-composer-input'));
      expect(designer.runFormRequest()).toBe(0);
    }));
  });

  describe('Run tab (workflows R12, R13)', () => {
    function type(value: string): void {
      typeMessage(value);
    }

    function execute() {
      send();
      return runs.last;
    }

    function done(run: Partial<WorkflowRun>): void {
      runs.last.handlers.onDone!(seqRun(run));
      fixture.detectChanges();
    }

    function openRun(): void {
      open(SEQ);
    }

    it('shows a pill message box: +, the text, and Send, off until something is typed', () => {
      openRun();
      const form = q('run-composer')!;
      expect(form.tagName).toBe('FORM');
      expect(form.getAttribute('aria-label')).toBe('Message Three steps');
      const box = q('run-composer-input') as HTMLTextAreaElement;
      expect(box.tagName).toBe('TEXTAREA');
      // No agent leads a code workflow: the box messages the workflow.
      expect(box.placeholder).toBe('Message Three steps');
      expect(el.querySelector(`label[for="${box.id}"]`)?.textContent?.trim()).toBe(
        'Message Three steps',
      );
      const sendButton = q('run-composer-send') as HTMLButtonElement;
      expect(sendButton.getAttribute('aria-label')).toBe('Send');
      expect(sendButton.disabled).toBeTrue();
      // Nothing to add: the one input is the message itself.
      expect(q('run-composer-plus')).toBeNull();
      type('Hello');
      expect(sendButton.disabled).toBeFalse();
      expect(q('workflow-run-stop')).toBeNull();
      expect(q('workflow-run-result')).toBeNull();
    });

    it('streams the run on the typed input: Executing… and Stop meanwhile, each step as it goes, then the result', () => {
      openRun();
      type('  Hello  ');
      const call = execute();
      expect(call.workflowId).toBe('three-steps');
      expect(call.body).toEqual({ input: { text: '  Hello  ' } });
      fixture.detectChanges();
      // The message box is hidden while a run is shown; Stop sits in the bar.
      expect(q('run-composer')).toBeNull();
      expect(text('workflow-run-stop')).toBe('Stop');
      // What was sent is the run's question bubble.
      expect(text('workflow-run-question')).toBe('Hello');
      expect(designer.inputValue('text')).toBe('  Hello  ');
      expect(text('workflow-run-status')).toBe('Running…');

      call.handlers.onRun!({ runId: 'run-1', workflowId: 'three-steps' });
      call.handlers.onStep!({ id: 'clean-text', title: 'Clean text', status: 'running' });
      fixture.detectChanges();
      expect(el.querySelector('[data-testid^="workflow-run-step-"]')).toBeNull();

      done({
        steps: [
          { id: 'clean-text', title: 'Clean text', status: 'success', output: { text: '"Hello"' } },
          { id: 'count-words', title: 'Count words', status: 'success', output: { words: 1 } },
          { id: 'format-result', title: 'Format result', status: 'success', output: { summary: 'S' } },
        ],
        output: { summary: '1 word, 5 characters: "Hello"' },
      });
      expect(q('run-composer')).toBeNull();
      expect(q('workflow-run-stop')).toBeNull();
      expect(text('workflow-run-status')).toBe('Run succeeded');
      // The steps are in the Logs, not here.
      expect(el.querySelector('[data-testid^="workflow-run-step-"]')).toBeNull();
      expect(q('workflow-run-output')?.textContent).toContain('1 word, 5 characters: "Hello"');
      expect(designer.nodeStatuses()).toEqual({
        start: 'success',
        end: 'success',
        'clean-text': 'success',
        'count-words': 'success',
        'format-result': 'success',
      });
    });

    it('shows a failed run: the failing step with its error, the others skipped', () => {
      openRun();
      type('!!!');
      execute();
      done({
        status: 'failed',
        steps: [
          { id: 'clean-text', title: 'Clean text', status: 'failed', error: 'The text is empty' },
          { id: 'count-words', title: 'Count words', status: 'skipped' },
          { id: 'format-result', title: 'Format result', status: 'skipped' },
        ],
        output: undefined,
        error: 'The text is empty',
      });
      expect(text('workflow-run-status')).toBe('Run failed: The text is empty');
      expect(el.querySelector('[data-testid^="workflow-run-step-"]')).toBeNull();
      expect(q('workflow-run-output')).toBeNull();
    });

    it("says the server's refusal as the agent and keeps no result; running again replaces the result", () => {
      openRun();
      type('a');
      execute().handlers.onError!('Backend unreachable');
      fixture.detectChanges();
      const refusal = q('workflow-run-error')!;
      expect(refusal.getAttribute('role')).toBe('alert');
      expect(
        refusal.querySelector('[data-testid="run-agent-message"]')?.textContent?.trim(),
      ).toBe("I couldn't start yet: Backend unreachable.");
      // What was sent stays above it, as the user's bubble.
      expect(text('run-user-message')).toBe('a');
      expect(q('workflow-run-result')).toBeNull();

      type('a');
      execute();
      done({ output: { summary: 'first' } });
      expect(q('workflow-run-error')).toBeNull();
      // A shown run hides the input: Run again brings it back, holding the text.
      expect(q('run-composer')).toBeNull();
      click('workflow-run-again');
      expect((q('run-composer-input') as HTMLTextAreaElement).value).toBe('a');
      execute();
      done({ output: { summary: 'second' } });
      expect(q('workflow-run-output')?.textContent).toContain('second');
      expect(q('workflow-run-output')?.textContent).not.toContain('first');
    });
    it('says the refusal of a run started elsewhere too (the home page\'s Ask)', () => {
      openRun();
      designer.setInput('text', 'a');
      designer.execute();
      fixture.detectChanges();
      runs.last.handlers.onError!('Backend unreachable');
      fixture.detectChanges();
      expect(q('workflow-run-error')!.textContent).toContain(
        "I couldn't start yet: Backend unreachable.",
      );
      expect(el.querySelectorAll('[data-testid="workflow-run-error"]').length).toBe(1);
    });
  });

  describe('Run tab of a workflow with an agent step (workflows R21)', () => {
    const DATASETS = [
      { name: 'World Cup Core', tables: ['a', 'b'], datasourceKind: 'postgres' },
      { name: 'Sales', tables: ['c'], datasourceKind: 'rest' },
    ];

    function openAssistant(workflow: WorkflowDetail = ASSISTANT): void {
      open(workflow, () => {
        if (workflow.input.some((f) => f.type === 'datasets' || f.type === 'dataset')) {
          http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: DATASETS });
        }
      });
    }

    function typeQuestion(value: string): void {
      typeMessage(value);
    }

    function pickDataset(): void {
      pickInMenu('datasets', 'World Cup Core');
    }

    const agentText = (testId: string) =>
      q(testId)?.querySelector('[data-testid="run-agent-message"]')?.textContent?.trim() ?? '';

    it('asks in the chat for the datasets the message did not give, then runs on Continue', () => {
      openAssistant();
      typeQuestion('Which team scored the most goals?');
      send();
      // Nothing is sent yet: the agent asks for the missing datasets.
      expect(runs.calls.length).toBe(0);
      expect(text('run-user-message')).toBe('Which team scored the most goals?');
      const ask = q('run-intake-datasets')!;
      expect(agentText('run-intake-datasets')).toBe(
        'Happy to. First, which data should I look at? Pick one or more datasets.',
      );
      // Its avatar letter and caption: the workflow's only agent.
      expect(ask.textContent).toContain('Insights Analyst');
      expect((q('run-composer-input') as HTMLTextAreaElement).placeholder).toBe(
        'Or type a dataset name…',
      );
      // The real catalogue as cards: name, kind and size, and Add.
      const add = q('run-intake-option-datasets-World Cup Core') as HTMLButtonElement;
      expect(add.getAttribute('aria-pressed')).toBe('false');
      expect(add.textContent?.trim()).toBe('Add');
      expect(add.closest('li')?.textContent).toContain('PostgreSQL · 2 tables');
      expect(q('run-intake-option-datasets-Sales')!.closest('li')?.textContent).toContain(
        'REST API · 1 table',
      );
      expect(ask.textContent).toContain('only reads your data with read-only SQL.');
      const proceed = q('run-intake-continue') as HTMLButtonElement;
      expect(proceed.disabled).toBeTrue();
      expect(proceed.textContent?.trim()).toBe('Continue with 0 datasets');

      add.click();
      fixture.detectChanges();
      expect(add.getAttribute('aria-pressed')).toBe('true');
      expect(add.textContent?.trim()).toBe('Added');
      expect(proceed.textContent?.trim()).toBe('Continue with 1 dataset');
      // A pick shows as a removable chip above the message box too.
      expect(text('run-composer-chip-datasets')).toContain('World Cup Core');

      click('run-intake-continue');
      // The pick is echoed as the user's turn, and the run starts as before.
      const turns = el.querySelectorAll('[data-testid="run-user-message"]');
      expect(turns[turns.length - 1].textContent?.trim()).toBe('World Cup Core');
      expect(runs.calls.length).toBe(1);
      expect(runs.last.body).toEqual({
        input: {
          question: 'Which team scored the most goals?',
          datasets: ['World Cup Core'],
          verbose: false,
        },
      });
    });

    it('typing a dataset name while the agent asks filters the cards, and Send adds it', () => {
      openAssistant();
      typeQuestion('Which team?');
      send();
      typeQuestion('sal');
      expect(q('run-intake-option-datasets-World Cup Core')).toBeNull();
      expect(q('run-intake-option-datasets-Sales')).not.toBeNull();
      send();
      expect(designer.picked('datasets')).toEqual(['Sales']);
      expect((q('run-composer-input') as HTMLTextAreaElement).value).toBe('');
      expect(runs.calls.length).toBe(0);
    });

    it('does not ask for the datasets picked already through +', () => {
      openAssistant();
      pickDataset();
      typeQuestion('Which team?');
      send();
      expect(q('run-intake-datasets')).toBeNull();
      expect(runs.calls.length).toBe(1);
    });

    it("says a server refusal as the agent, then takes the corrected message", () => {
      openAssistant();
      pickDataset();
      typeQuestion('Which team?');
      send();
      runs.last.handlers.onError!('Question must be at most 4000 characters', [
        { field: 'question', message: 'Question must be at most 4000 characters' },
      ]);
      fixture.detectChanges();
      expect(agentText('workflow-run-error')).toBe(
        "I couldn't start yet: Question must be at most 4000 characters.",
      );
      expect(q('workflow-run-result')).toBeNull();
      // The question is back in the box, to shorten and send again.
      expect((q('run-composer-input') as HTMLTextAreaElement).value).toBe('Which team?');
    });

    it('the + menu holds the other inputs: the datasets as cards and each checkbox as a switch', () => {
      openAssistant();
      const plus = q('run-composer-plus')!;
      expect(plus.getAttribute('aria-label')).toBe('Add inputs and options');
      expect(plus.getAttribute('aria-expanded')).toBe('false');
      click('run-composer-plus');
      expect(plus.getAttribute('aria-expanded')).toBe('true');
      const menu = q('run-composer-menu')!;
      expect(menu.getAttribute('aria-label')).toBe('Inputs and options');
      // The question is the message itself, never a menu entry.
      expect(q('run-composer-menu-item-question')).toBeNull();
      expect(q('workflow-input-question')).toBeNull();

      openMenu('datasets');
      const picker = q('workflow-input-datasets')!;
      expect(picker.getAttribute('role')).toBe('group');
      expect(
        Array.from(picker.querySelectorAll('li .font-semibold')).map((n) => n.textContent?.trim()),
      ).toEqual(['World Cup Core', 'Sales']);
      click('run-composer-option-datasets-World Cup Core');
      expect(designer.picked('datasets')).toEqual(['World Cup Core']);
      expect(text('run-composer-menu-item-datasets')).toContain('1 picked');

      const verbose = q('workflow-input-verbose') as HTMLInputElement;
      expect(verbose.type).toBe('checkbox');
      expect(verbose.getAttribute('role')).toBe('switch');
      expect(verbose.checked).toBe(false);
      expect(verbose.closest('label')?.textContent?.trim()).toBe('Verbose');
      verbose.click();
      fixture.detectChanges();
      expect(designer.checked('verbose')).toBe(true);

      // Escape closes the menu; the picks stay as chips above the box.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      expect(q('run-composer-menu')).toBeNull();
      const chip = q('run-composer-chip-datasets')!;
      expect(chip.textContent).toContain('World Cup Core');
      expect(chip.querySelector('button')!.getAttribute('aria-label')).toBe(
        'Remove World Cup Core',
      );
      // A switch away from its default is a chip too; removing it restores the default.
      const switchChip = q('run-composer-chip-verbose')!;
      expect(switchChip.textContent).toContain('Verbose on');
      (switchChip.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(designer.checked('verbose')).toBe(false);
      expect(q('run-composer-chip-verbose')).toBeNull();
      openMenu();
      (q('workflow-input-verbose') as HTMLInputElement).click();
      fixture.detectChanges();

      typeQuestion('Which team scored the most goals?');
      send();
      expect(runs.last.body).toEqual({
        input: {
          question: 'Which team scored the most goals?',
          datasets: ['World Cup Core'],
          verbose: true,
        },
      });
    });

    it('a chip removes its dataset', () => {
      openAssistant();
      pickDataset();
      click('run-composer-plus');
      (q('run-composer-chip-datasets')!.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(designer.picked('datasets')).toEqual([]);
      expect(q('run-composer-chip-datasets')).toBeNull();
    });

    it('a datasets field offers only the datasets of its kinds', () => {
      openAssistant({
        ...ASSISTANT,
        input: [
          {
            name: 'datasets',
            label: 'Datasets',
            type: 'datasets',
            required: true,
            datasourceKinds: ['postgres', 'databricks'],
          },
        ],
      });
      openMenu('datasets');
      expect(q('run-composer-option-datasets-World Cup Core')).not.toBeNull();
      expect(q('run-composer-option-datasets-Sales')).toBeNull();
    });

    it('a dataset field is asked as a single pick of its kinds, which continues at once and sends a string', () => {
      openAssistant({
        ...ASSISTANT,
        input: [
          {
            name: 'question',
            label: 'Question',
            type: 'textarea',
            required: false,
            default: 'Assess it.',
          },
          {
            name: 'dataset',
            label: 'Dataset',
            type: 'dataset',
            required: true,
            datasourceKinds: ['postgres', 'databricks'],
          },
        ],
      });
      // The question has a default: Send runs with it, nothing typed.
      expect((q('run-composer-send') as HTMLButtonElement).disabled).toBeFalse();
      send();
      expect(runs.calls.length).toBe(0);
      expect(q('run-intake-dataset')!.textContent).toContain(
        'First, which dataset should I look at? Pick one.',
      );
      expect(q('run-intake-option-dataset-Sales')).toBeNull();
      expect(q('run-intake-continue')).toBeNull();
      click('run-intake-option-dataset-World Cup Core');
      expect(runs.last.body).toEqual({
        input: { question: 'Assess it.', dataset: 'World Cup Core' },
      });
    });

    describe('a Data Readiness run (data-readiness R5)', () => {
      const REPORT = sampleReadinessReport({ id: 'r1', datasourceName: 'World Cup DB' });
      const READINESS: WorkflowDetail = {
        ...ASSISTANT,
        id: 'data-readiness-assessment',
        name: 'Assess Data Readiness',
        input: [
          {
            name: 'dataset',
            label: 'Dataset',
            type: 'dataset',
            required: true,
            datasourceKinds: ['postgres', 'databricks'],
          },
        ],
      };

      function readinessRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
        return assistantRun({
          workflowId: 'data-readiness-assessment',
          workflowName: 'Assess Data Readiness',
          input: { dataset: 'World Cup Core' },
          answer: {
            role: 'assistant',
            content: 'The dataset scored 82.',
            at: 'x',
            readinessReport: {
              reportId: 'r1',
              datasourceName: 'World Cup DB',
              overallScore: 82,
              maturity: 'Managed',
              generatedAt: REPORT.generatedAt,
            },
          },
          panelItems: [sampleReadinessPanelItem('r1')],
          ...overrides,
        });
      }

      function finishRun(run: WorkflowRun): void {
        pickInMenu('dataset', 'World Cup Core');
        send();
        const h = runs.last.handlers;
        h.onRun!({ runId: run.id, workflowId: run.workflowId });
        h.onDone!(run);
        fixture.detectChanges();
      }

      it('Run again on a run opened from Runs shows its dataset picked (R19)', () => {
        designer.showRunOnLoad(readinessRun());
        openAssistant(READINESS);
        click('workflow-run-again');
        expect(text('run-composer-chip-dataset')).toContain('World Cup Core');
        openMenu('dataset');
        expect(
          q('run-composer-option-dataset-World Cup Core')!.getAttribute('aria-pressed'),
        ).toBe('true');
      });

      it('Open scorecard on the readiness card shows the scorecard under the answer, and Close hides it', () => {
        openAssistant(READINESS);
        finishRun(readinessRun());
        expect(q('workflow-run-scorecard')).toBeNull();
        click('readiness-open-scorecard');
        http
          .expectOne((r) => r.url.endsWith('/data-readiness/assessments/r1'))
          .flush(REPORT);
        fixture.detectChanges();
        const scorecard = q('workflow-run-scorecard')!;
        expect(scorecard.getAttribute('aria-label')).toBe('Readiness scorecard');
        expect(
          scorecard.querySelector('[data-testid="readiness-scorecard"]')?.textContent,
        ).toContain('World Cup DB');
        expect(scorecard.textContent).toContain('Past assessments');
        click('workflow-run-scorecard-close');
        expect(q('workflow-run-scorecard')).toBeNull();
      });

      it('a new run closes the scorecard of the earlier one', () => {
        openAssistant(READINESS);
        finishRun(readinessRun());
        click('readiness-open-scorecard');
        http
          .expectOne((r) => r.url.endsWith('/data-readiness/assessments/r1'))
          .flush(REPORT);
        fixture.detectChanges();
        expect(q('workflow-run-scorecard')).not.toBeNull();
        designer.runId.set('run-2');
        fixture.detectChanges();
        expect(q('workflow-run-scorecard')).toBeNull();
      });
    });

    it('example chips fill the message box and do not run', () => {
      openAssistant({ ...ASSISTANT, starterQuestions: ['Which team scored the most goals?'] });
      click('workflow-example-0');
      expect((q('run-composer-input') as HTMLTextAreaElement).value).toBe(
        'Which team scored the most goals?',
      );
      expect(runs.calls.length).toBe(0);
    });

    it('a run requirement keeps Send off, with its text above the box', () => {
      openAssistant({ ...ASSISTANT, runRequirement: "None of this agent's datasets exist" });
      typeQuestion('Which team?');
      expect((q('run-composer-send') as HTMLButtonElement).disabled).toBe(true);
      expect(text('workflow-run-requirement')).toBe("None of this agent's datasets exist");
    });

    it("hides the input fields while a run is shown, and Run again brings them back with the run's input (agents.md 5.19)", () => {
      const FIELDS: WorkflowDetail['input'] = [
        { name: 'url', label: 'Entry URL', type: 'text', required: true },
        { name: 'maxPages', label: 'Max pages', type: 'number', required: false, default: 50 },
        { name: 'mobile', label: 'Mobile (390 px)', type: 'boolean', required: false, default: true },
        { name: 'laptop', label: 'Laptop (1440 px)', type: 'boolean', required: false, default: true },
      ];
      const REVIEW: WorkflowDetail = { ...ASSISTANT, id: 'review-website', name: 'Review a Website', input: FIELDS };
      openAssistant(REVIEW);
      // No question: the message box takes the required URL; the rest is behind +.
      expect(q('workflow-input-url')).toBeNull();
      openMenu();
      expect(q('run-composer-menu-item-url')).toBeNull();
      expect(q('run-composer-menu-item-maxPages')).not.toBeNull();
      expect((q('workflow-input-mobile') as HTMLInputElement).checked).toBeTrue();
      typeQuestion('https://shop.example.com/');
      send();
      expect(runs.last.body.input).toEqual(
        jasmine.objectContaining({ url: 'https://shop.example.com/', maxPages: '50', mobile: true }),
      );
      const h = runs.last.handlers;
      h.onRun!({ runId: 'run-1', workflowId: 'review-website' });
      fixture.detectChanges();
      expect(q('run-composer')).toBeNull();
      h.onDone!(
        assistantRun({
          workflowId: 'review-website',
          workflowName: 'Review a Website',
          input: { url: 'https://shop.example.com/' },
        }),
      );
      fixture.detectChanges();
      // The input is hidden while a run is shown.
      expect(q('run-composer')).toBeNull();
      expect(q('workflow-run-input-toggle')).toBeNull();
      // Run again brings the box back, holding the run's input.
      click('workflow-run-again');
      expect((q('run-composer-input') as HTMLTextAreaElement).value).toBe(
        'https://shop.example.com/',
      );
    });

    it("shows a code step's own progress live, newest line first, and nothing once the run ends (agents.md 5.19)", () => {
      const REVIEW: WorkflowDetail = {
        ...ASSISTANT,
        id: 'review-website',
        name: 'Review a Website',
        input: [{ name: 'url', label: 'Entry URL', type: 'text', required: true }],
        steps: ASSISTANT.steps.map((step) => ({
          ...step,
          id: 'capture-and-check',
          title: 'Capture and check',
          kind: 'code' as const,
        })),
      };
      openAssistant(REVIEW);
      typeQuestion('https://shop.example.com/');
      send();
      const h = runs.last.handlers;
      h.onRun!({ runId: 'run-1', workflowId: 'review-website' });
      h.onStep!({ id: 'capture-and-check', title: 'Capture and check', status: 'running' });
      fixture.detectChanges();
      // No progress yet: no block.
      expect(q('workflow-run-progress')).toBeNull();
      h.onReasoning!('Checking 2 pages on Mobile\n');
      h.onReasoning!('Checked 1 of 2 · / on Mobile · 3 findings\n');
      h.onReasoning!('Checked 2 of 2 · /about on Mobile · 0 findings\n');
      fixture.detectChanges();
      const progress = q('workflow-run-progress')!;
      expect(progress.textContent).toContain('Capture and check');
      expect(text('workflow-run-progress-latest')).toBe(
        'Checked 2 of 2 · /about on Mobile · 0 findings',
      );
      expect(
        Array.from(progress.querySelectorAll('li')).map((li) => li.textContent?.trim()),
      ).toEqual(['Checked 1 of 2 · / on Mobile · 3 findings', 'Checking 2 pages on Mobile']);
      expect(q('workflow-run-live')).toBeNull();

      h.onDone!(assistantRun({ workflowId: 'review-website', workflowName: 'Review a Website' }));
      fixture.detectChanges();
      expect(q('workflow-run-progress')).toBeNull();
    });

    it('shows the agent step live (Thinking, tool rows, the answer forming), then the answer with no follow-up', () => {
      openAssistant();
      pickDataset();
      typeQuestion('Which team scored the most goals?');
      send();
      const h = runs.last.handlers;
      h.onRun!({ runId: 'run-1', workflowId: 'answer-business-question' });
      h.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
      h.onReasoning!('Looking at the goals table');
      h.onTool!({ name: 'run_readonly_sql', input: 'SELECT 1' });
      h.onToolResult!({ tool: 'run_readonly_sql', rowCount: 3 });
      h.onText!('Brazil scored');
      fixture.detectChanges();
      const live = q('workflow-run-live')!;
      // Its thought and its steps in plain words, no tool names and no empty heading.
      expect(el.textContent).toContain('Looking at the goals table');
      expect(el.textContent).not.toContain('Thinking');
      const tool = q('workflow-run-tool')!;
      expect(tool.getAttribute('data-tool')).toBe('run_readonly_sql');
      expect(tool.getAttribute('data-state')).toBe('done');
      expect(tool.textContent).toContain('Ran a query');
      expect(tool.textContent).toContain('3 rows');
      expect(tool.textContent).not.toContain('run_readonly_sql');
      expect(live.textContent).toContain('Brazil scored');
      expect(q('run-answer')).toBeNull();

      h.onDone!(
        assistantRun({
          answer: {
            role: 'assistant',
            content: 'Brazil scored the most goals.',
            at: 'x',
            data: [{ tool: 'run_readonly_sql', input: 'SELECT team FROM goals', rowCount: 3 }],
          },
        }),
      );
      fixture.detectChanges();
      expect(q('workflow-run-live')).toBeNull();
      expect(q('run-answer')?.textContent).toContain('Brazil scored the most goals.');
      expect(q('workflow-run-output')).toBeNull();
      // The run is the agent's turn: its avatar row holds the answer.
      expect(q('run-agent-turn')!.contains(q('run-answer'))).toBeTrue();
      expect(q('run-agent-turn')!.textContent).toContain('Insights Analyst');

      // The input is hidden under the answer: no follow-up composer.
      expect(q('run-composer')).toBeNull();
      expect(q('workflow-follow-up-input')).toBeNull();
      expect(q('workflow-run-follow-up')).toBeNull();
    });

    describe('a stored run that asked an agent', () => {
      const agentStep = (
        id: string,
        title: string,
        name: string,
        role?: string,
      ): WorkflowDetail['steps'][number] => ({
        ...STEP(id, title, ['question'], ['out']),
        kind: 'agent',
        agent: { name, ...(role ? { role } : {}), tools: [], maxSteps: 5 },
      });
      const ASK: WorkflowDetail = {
        ...ASSISTANT,
        steps: [
          STEP('receive-question', 'Receive question', ['question'], ['question']),
          agentStep('plan', 'Plan', 'Olivia'),
          agentStep('analyse', 'Analyse', 'Insights Analyst'),
          agentStep('write-answer', 'Write answer', 'Jessica', 'Insights Writer'),
        ],
      };
      const ranSteps: WorkflowRun['steps'] = [
        { id: 'receive-question', title: 'Receive question', status: 'success' },
        { id: 'plan', title: 'Plan', status: 'skipped' },
        { id: 'analyse', title: 'Analyse', status: 'success' },
        { id: 'write-answer', title: 'Write answer', status: 'success' },
      ];

      function showAnswer(overrides: Partial<WorkflowRun> = {}): void {
        openAssistant(ASK);
        pickDataset();
        typeQuestion('Which team scored the most goals?');
        send();
        const h = runs.last.handlers;
        h.onRun!({ runId: 'run-1', workflowId: ASK.id });
        h.onDone!(
          assistantRun({
            steps: ranSteps,
            answer: { role: 'assistant', content: 'Brazil.', at: 'x' },
            ...overrides,
          }),
        );
        fixture.detectChanges();
      }

      it('a stored run that asked an agent reads Asked <agent>', () => {
        showAnswer();
        designer.run.set(
          assistantRun({
            id: 'run-2',
            steps: ranSteps,
            context: { fromRunId: 'run-1', askStep: 'write-answer' },
            answer: { role: 'assistant', content: 'Short.', at: 'x' },
          }),
        );
        fixture.detectChanges();
        expect(text('workflow-run-context')).toContain('Asked Jessica');
      });
    });

    it('Stop ends the run: the run reads "Run stopped"', () => {
      openAssistant();
      pickDataset();
      typeQuestion('Which team scored the most goals?');
      send();
      const h = runs.last.handlers;
      h.onRun!({ runId: 'run-1', workflowId: 'answer-business-question' });
      h.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
      fixture.detectChanges();
      click('workflow-run-stop');
      // The server stops the run (api.md 150); the stream is dropped.
      expect(runs.stopRun).toHaveBeenCalledOnceWith('run-1');
      expect(runs.last.signal?.aborted).toBe(true);
      expect(text('workflow-run-status')).toBe('Run stopped');
      expect(q('workflow-run-step-answer')).toBeNull();
      // Stop leaves the bar; a stopped run still hides the input until New question.
      expect(q('workflow-run-stop')).toBeNull();
      expect(q('run-composer')).toBeNull();
      click('workflow-run-new');
      expect(q('run-composer')).not.toBeNull();
    });

    it('an old run that carries an rfpId, a deep-analysis report or files shows as a plain answer', () => {
      openAssistant();
      pickDataset();
      typeQuestion('Export a draft');
      send();
      const h = runs.last.handlers;
      h.onRun!({ runId: 'run-3', workflowId: 'answer-business-question' });
      h.onDone!({
        ...assistantRun({
          id: 'run-3',
          answer: {
            role: 'assistant',
            content: 'Stage 1 proposal. Confirm?',
            at: 'x',
            report: { jobId: 'run-3', title: 'Drivers', path: 'reports/d.md', angles: 3 },
          } as WorkflowRun['answer'],
          panelItems: [
            {
              id: 'p1',
              kind: 'file',
              title: 'rfp.md',
              path: 'rfp/rfp-1/draft/rfp.md',
              bytes: 10,
              shownAt: 'x',
            },
          ],
        }),
        rfpId: 'rfp-1',
      } as WorkflowRun);
      fixture.detectChanges();
      expect(text('run-answer')).toContain('Stage 1 proposal. Confirm?');
      expect(q('run-rfp-document')).toBeNull();
      expect(q('workflow-run-continue')).toBeNull();
      expect(q('workflow-run-files')).toBeNull();
      expect(q('workflow-run-scorecard')).toBeNull();
      expect(q('workflow-run-phases')).toBeNull();
      expect(el.querySelector('[aria-label="Download report"]')).toBeNull();
    });
  });

  describe('the chat and its composer (ui.md 4.4b)', () => {
    const DATASETS = [
      { name: 'World Cup Core', tables: ['a', 'b'], datasourceKind: 'postgres' },
    ];
    const WITH_EXAMPLES: WorkflowDetail = {
      ...ASSISTANT,
      starterQuestions: ['Which team scored the most goals?', 'Who won in 2022?'],
    };

    function openForm(workflow: WorkflowDetail = WITH_EXAMPLES): void {
      open(workflow, () => {
        if (workflow.input.some((f) => f.type === 'datasets')) {
          http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: DATASETS });
        }
      });
    }

    /** Opens the workflow showing a stored run, as "Answer in the workflow" does. */
    function openStored(run: WorkflowRun, workflow: WorkflowDetail = WITH_EXAMPLES): void {
      designer.showRunOnLoad(run);
      openForm(workflow);
    }

    function typeQuestion(value: string): void {
      typeMessage(value);
    }

    function pressEnter(testId: string, init: KeyboardEventInit = {}): KeyboardEvent {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        ...init,
      });
      q(testId)!.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    }

    const answered = (overrides: Partial<WorkflowRun> = {}) =>
      assistantRun({
        answer: { role: 'assistant', content: 'Brazil scored the most goals.', at: 'x' },
        ...overrides,
      });

    it('before a run shows the empty state with the hint and the example chips, and no New question', () => {
      openForm();
      expect(q('workflow-run-empty')).not.toBeNull();
      expect(q('workflow-run-empty')!.textContent).toContain('Insights Analyst');
      expect(q('workflow-run-empty')!.textContent).toContain(
        'Ask Insights Analyst anything about your data.',
      );
      expect((q('run-composer-input') as HTMLTextAreaElement).placeholder).toBe(
        'Message Insights Analyst',
      );
      const list = el.querySelector('[aria-label="Example questions"]')!;
      expect(list.querySelectorAll('button').length).toBe(2);
      expect(text('workflow-example-1')).toBe('Who won in 2022?');
      expect(q('workflow-run-new')).toBeNull();
      expect(q('workflow-run-question')).toBeNull();
      expect(el.querySelector('h3')?.textContent).toContain('Chat');
    });

    it('an example chip fills the message box but never runs', () => {
      openForm();
      click('workflow-example-1');
      expect((q('run-composer-input') as HTMLTextAreaElement).value).toBe('Who won in 2022?');
      expect(designer.inputValue('question')).toBe('Who won in 2022?');
      expect(runs.calls.length).toBe(0);
    });

    it('words the hint from the agents: without data, and without any agent', () => {
      openForm({
        ...ASSISTANT,
        input: ASSISTANT.input.filter((f) => f.type !== 'datasets'),
      });
      expect(text('workflow-run-empty')).toContain('Tell Insights Analyst what you need.');
      open({
        ...SEQ,
        input: [{ name: 'count', label: 'Count', type: 'number', required: true }],
      });
      expect(text('workflow-run-empty')).toContain('Send a message to run Three steps.');
      expect(el.querySelector('[aria-label="Example questions"]')).toBeNull();
    });

    it('a required input with no question is asked in the chat and answered in the box', () => {
      open({
        ...SEQ,
        input: [
          { name: 'note', label: 'Note', type: 'textarea', required: false, default: 'Hi' },
          { name: 'count', label: 'Count', type: 'number', required: true },
        ],
      });
      send();
      expect(q('run-intake-count')!.textContent).toContain('First, what is the count?');
      expect((q('run-composer-input') as HTMLTextAreaElement).placeholder).toBe(
        'Type the count…',
      );
      typeQuestion('3');
      send();
      expect(text('run-user-message')).toBe('3');
      expect(runs.last.body).toEqual({ input: { note: 'Hi', count: '3' } });
    });

    it('a required checkbox with no default is asked as Yes or No', () => {
      open({
        ...SEQ,
        input: [
          ...SEQ.input,
          { name: 'sure', label: 'Overwrite it', type: 'boolean', required: true },
        ],
      });
      typeQuestion('Hello');
      send();
      expect(q('run-intake-sure')!.textContent).toContain(
        'Happy to. First, overwrite it?',
      );
      click('run-intake-option-sure-yes');
      expect(runs.last.body).toEqual({ input: { text: 'Hello', sure: true } });
    });

    it('asks each missing input in turn, the later ones with "Thanks. Next,"', () => {
      open(
        {
          ...WITH_EXAMPLES,
          input: [
            ...ASSISTANT.input,
            { name: 'year', label: 'Year', type: 'number', required: true },
          ],
        },
        () =>
          http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: DATASETS }),
      );
      typeQuestion('Which team?');
      send();
      click('run-intake-option-datasets-World Cup Core');
      click('run-intake-continue');
      expect(q('run-intake-year')!.textContent).toContain('Thanks. Next, what is the year?');
      // The answered pick keeps its question but no longer its cards.
      expect(q('run-intake-option-datasets-World Cup Core')).toBeNull();
      expect(runs.calls.length).toBe(0);
      typeQuestion('2022');
      send();
      expect(runs.last.body.input).toEqual(
        jasmine.objectContaining({ datasets: ['World Cup Core'], year: '2022' }),
      );
      // The turns stay above the run they led to.
      expect(q('run-intake-year')).not.toBeNull();
      expect(text('workflow-run-question')).toBe('Which team?');
    });

    it('under a stored answer there is no composer: no follow-up and no run form', () => {
      openStored(answered());
      expect(q('run-composer')).toBeNull();
      expect(q('workflow-follow-up-input')).toBeNull();
      expect(q('workflow-follow-up-agent')).toBeNull();
      expect(q('workflow-run-follow-up')).toBeNull();
      expect(el.querySelector('form[aria-label="Follow up"]')).toBeNull();
      expect(q('workflow-input-question')).toBeNull();
      expect(q('workflow-input-datasets')).toBeNull();
      expect(q('workflow-run')).toBeNull();
      expect(q('workflow-run-empty')).toBeNull();
      expect(q('workflow-run-new')).not.toBeNull();
    });

    it('a clarification answer has no composer either: its options answer it', () => {
      openStored(
        answered({
          answer: {
            role: 'assistant',
            content: 'Which year?',
            at: 'x',
            clarification: { question: 'Which year?', options: [{ label: '2018' }, { label: '2022' }] },
          },
        }),
      );
      expect(q('run-composer')).toBeNull();
      expect(q('workflow-follow-up-input')).toBeNull();
      expect(q('workflow-input-question')).toBeNull();
    });

    it('the composer is hidden while a run is shown, and New question brings it back, empty', () => {
      openStored(answered());
      expect(q('run-composer')).toBeNull();
      click('workflow-run-new');
      expect(q('run-composer')).not.toBeNull();
      expect((q('run-composer-input') as HTMLTextAreaElement).value).toBe('');
    });

    it('the composer is hidden while a run is waiting for the user', () => {
      openStored(
        answered({
          status: 'suspended',
          answer: undefined,
          waitingFor: {
            stepId: 'analyse',
            title: 'Analyse',
            question: 'Which year?',
            options: ['2018', '2022'],
            expiresAt: '2026-11-11T10:30:00.000Z',
          },
        }),
      );
      expect(designer.runResult()?.status).toBe('suspended');
      expect(q('run-composer')).toBeNull();
    });

    it('Enter in the message box sends; Shift+Enter adds a line', () => {
      openForm();
      pickInMenu('datasets', 'World Cup Core');
      typeQuestion('Which team scored the most goals?');
      const shifted = pressEnter('run-composer-input', { shiftKey: true });
      expect(shifted.defaultPrevented).toBeFalse();
      expect(runs.calls.length).toBe(0);
      const plain = pressEnter('run-composer-input');
      expect(plain.defaultPrevented).toBeTrue();
      expect(runs.calls.length).toBe(1);
    });

    it('a run shown has its question bubble and New question, which returns to the run form', () => {
      openStored(answered());
      expect(text('workflow-run-question')).toBe('Which team scored the most goals?');
      expect(q('workflow-run-empty')).toBeNull();
      const newQuestion = spyOn(designer, 'newQuestion').and.callThrough();
      click('workflow-run-new');
      expect(newQuestion).toHaveBeenCalledTimes(1);
      expect(designer.runResult()).toBeNull();
      expect(q('workflow-run-question')).toBeNull();
      expect(q('workflow-run-empty')).not.toBeNull();
      expect(q('run-composer-input')).not.toBeNull();
      expect(q('workflow-run-new')).toBeNull();
    });

    it('a run shown has Run again, which returns to the run form holding its whole input', () => {
      openStored(answered());
      const again = q('workflow-run-again')!;
      expect(again.textContent?.trim()).toBe('Run again');
      expect(again.getAttribute('title')).toBe("Run again with this run's input");
      // Run again comes first in the header; New question follows it.
      expect(again.nextElementSibling).toBe(q('workflow-run-new'));
      const runAgain = spyOn(designer, 'runAgain').and.callThrough();
      click('workflow-run-again');
      expect(runAgain).toHaveBeenCalledTimes(1);
      expect(designer.runResult()).toBeNull();
      expect(q('workflow-run-again')).toBeNull();
      const question = q('run-composer-input') as HTMLTextAreaElement;
      expect(question.value).toBe(designer.inputValue('question'));
      expect(question.value).not.toBe('');
    });

    it('New question is hidden while a run streams', () => {
      openForm();
      pickInMenu('datasets', 'World Cup Core');
      typeQuestion('Which team?');
      send();
      runs.last.handlers.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
      fixture.detectChanges();
      expect(designer.running()).toBeTrue();
      expect(q('workflow-run-new')).toBeNull();
      expect(q('workflow-run-again')).toBeNull();
      expect(text('workflow-run-question')).toBe('Which team?');
      // The composer is hidden while it streams; Stop is in the bar.
      expect(q('run-composer')).toBeNull();
      expect(text('workflow-run-stop')).toBe('Stop');
      expect(q('workflow-follow-up-input')).toBeNull();
      runs.last.handlers.onDone!(answered());
      fixture.detectChanges();
      expect(q('workflow-run-new')).not.toBeNull();
      expect(q('workflow-run-stop')).toBeNull();
      expect(q('run-composer')).toBeNull();
    });

    it('renders no step card and no progress list, with or without a run', () => {
      openStored(answered());
      expect(el.querySelector('[data-testid^="workflow-run-step-"]')).toBeNull();
      expect(el.querySelector('[data-testid^="workflow-run-progress"]')).toBeNull();
      expect(q('workflow-run-result')).toBeNull();
    });
  });

  describe('Avery, the never-ending conversation (orchestrated-answer)', () => {
    // A workflow whose step runs Avery (chief-of-staff) is her conversation.
    const AVERY: WorkflowDetail = {
      ...ASSISTANT,
      id: 'orchestrated-answer',
      name: 'Answer a Business Question (orchestrated)',
      agents: [{ key: 'chief-of-staff', name: 'Avery', role: 'Chief of Staff' }],
      steps: ASSISTANT.steps.map((step) => ({
        ...step,
        agent: {
          key: 'chief-of-staff',
          name: 'Avery',
          role: 'Chief of Staff',
          tools: ['answer_from_data', 'ask_clarification'],
          maxSteps: 16,
        },
      })),
    };
    const DATASETS = [{ name: 'World Cup Core', tables: ['a'], datasourceKind: 'postgres' }];
    const ended = (overrides: Partial<WorkflowRun> = {}) =>
      assistantRun({
        workflowId: 'orchestrated-answer',
        answer: { role: 'assistant', content: 'Brazil.', at: 'x' },
        ...overrides,
      });

    function openStored(run: WorkflowRun, workflow: WorkflowDetail = AVERY): void {
      designer.showRunOnLoad(run);
      open(workflow, () =>
        http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: DATASETS }),
      );
    }

    function typeToAvery(value: string): HTMLTextAreaElement {
      const field = q('workflow-avery-input') as HTMLTextAreaElement;
      field.value = value;
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      return field;
    }

    it('shows a labelled Message Avery pill and Archive under an ended run', () => {
      openStored(ended());
      const box = q('workflow-avery-input') as HTMLTextAreaElement;
      expect(box.placeholder).toBe('Message Avery');
      expect(el.querySelector('label[for="workflow-avery-input"]')!.textContent).toContain('Message Avery');
      expect(q('workflow-avery-composer')!.getAttribute('aria-label')).toBe('Message Avery');
      // A follow-up has no inputs to add: no +.
      expect(q('run-composer-plus')).toBeNull();
      expect(q('workflow-run-archive')!.getAttribute('title')).toBe('Archive this conversation');
      const sendButton = q('workflow-avery-send') as HTMLButtonElement;
      expect(sendButton.getAttribute('aria-label')).toBe('Send');
      expect(sendButton.disabled).toBeTrue();
      // The answer sits on Avery's side of the conversation.
      expect(q('run-agent-turn')!.textContent).toContain('Avery · Chief of Staff');
    });

    it('also shows for a failed or stopped run', () => {
      openStored(ended({ status: 'failed' }));
      expect(q('workflow-avery-input')).not.toBeNull();
    });

    it('does not show for another workflow', () => {
      openStored(assistantRun(), ASSISTANT);
      expect(q('workflow-avery-input')).toBeNull();
      expect(q('workflow-run-archive')).toBeNull();
    });

    it('does not show while the run waits for the user', () => {
      openStored(
        ended({
          status: 'suspended',
          answer: undefined,
          waitingFor: {
            stepId: 'analyse',
            title: 'Analyse',
            question: 'Which year?',
            options: ['2018', '2022'],
            expiresAt: '2026-11-11T10:30:00.000Z',
          },
        }),
      );
      expect(q('workflow-avery-input')).toBeNull();
      expect(q('workflow-run-archive')).toBeNull();
    });

    it('does not show for an archived run, which reads with Unarchive', () => {
      openStored(ended({ archivedAt: '2026-11-20T10:00:00.000Z' }));
      expect(q('workflow-avery-input')).toBeNull();
      expect(q('workflow-run-archive')).toBeNull();
      expect(q('workflow-run-again')).toBeNull();
      expect(text('workflow-run-archived')).toContain('This conversation is archived.');
      expect(q('workflow-run-unarchive')).not.toBeNull();
    });

    it('Send starts a follow-up run of the shown run and clears the box', () => {
      openStored(ended());
      runs.getRun.and.returnValue(of(ended()));
      typeToAvery('And in 2022?');
      click('workflow-avery-send');
      expect(runs.calls.length).toBe(1);
      expect(runs.last.body.context?.fromRunId).toBe('run-1');
      expect(runs.last.body.input['question']).toBe('And in 2022?');
      // The box stays while she works: it queues, and Stop sits in it.
      const box = q('workflow-avery-input') as HTMLTextAreaElement;
      expect(box.value).toBe('');
      expect(box.placeholder).toBe('Queue a message for Avery');
      expect(q('workflow-avery-composer')!.contains(q('workflow-run-stop'))).toBeTrue();
      expect(q('workflow-run-stop')!.getAttribute('aria-label')).toBe('Stop');
    });

    it('Stop in the box stops the run', () => {
      openStored(ended());
      runs.getRun.and.returnValue(of(ended()));
      typeToAvery('And in 2022?');
      click('workflow-avery-send');
      spyOn(designer, 'stop').and.callThrough();
      click('workflow-run-stop');
      expect(designer.stop).toHaveBeenCalled();
    });

    it('a message sent while she works is queued, then sent when the answer ends', () => {
      openStored(ended());
      runs.getRun.and.returnValue(of(ended()));
      typeToAvery('And in 2022?');
      click('workflow-avery-send');
      expect(runs.calls.length).toBe(1);
      const sendButton = q('workflow-avery-send');
      expect(sendButton).toBeNull(); // nothing typed: only Stop
      typeToAvery('And by stage?');
      expect(q('workflow-avery-send')!.getAttribute('aria-label')).toBe('Queue message');
      click('workflow-avery-send');
      typeToAvery('Make it a chart');
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      (q('workflow-avery-input') as HTMLTextAreaElement).dispatchEvent(enter);
      fixture.detectChanges();
      expect(runs.calls.length).toBe(1);
      const queued = () => Array.from(el.querySelectorAll('[data-testid="workflow-avery-queued"]'));
      expect(queued().map((li) => li.querySelector('[title]')!.textContent!.trim())).toEqual([
        'And by stage?',
        'Make it a chart',
      ]);
      expect(queued()[0].textContent).toContain('Queued');
      // The first answer ends: the oldest queued message goes, the other waits.
      runs.last.handlers.onDone!(ended({ id: 'run-2' }));
      fixture.detectChanges();
      expect(runs.calls.length).toBe(2);
      expect(runs.last.body.input['question']).toBe('And by stage?');
      expect(queued().length).toBe(1);
    });

    it('a queued message can be removed before it goes', () => {
      openStored(ended());
      runs.getRun.and.returnValue(of(ended()));
      typeToAvery('And in 2022?');
      click('workflow-avery-send');
      typeToAvery('And by stage?');
      click('workflow-avery-send');
      click('workflow-avery-queued-remove');
      expect(el.querySelector('[data-testid="workflow-avery-queued"]')).toBeNull();
      runs.last.handlers.onDone!(ended({ id: 'run-2' }));
      fixture.detectChanges();
      expect(runs.calls.length).toBe(1);
    });

    it('Enter sends, Shift+Enter does not', () => {
      openStored(ended());
      const field = typeToAvery('Hello');
      const shift = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
      field.dispatchEvent(shift);
      expect(shift.defaultPrevented).toBeFalse();
      expect(runs.calls.length).toBe(0);
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      field.dispatchEvent(enter);
      expect(enter.defaultPrevented).toBeTrue();
      expect(runs.calls.length).toBe(1);
    });

    it('Archive calls the API, then resets the chat like New question', () => {
      openStored(ended());
      spyOn(designer, 'newQuestion').and.callThrough();
      click('workflow-run-archive');
      expect(runs.archive).toHaveBeenCalledWith('run-1');
      expect(designer.newQuestion).toHaveBeenCalled();
      expect(q('workflow-run-question')).toBeNull();
      expect(q('workflow-avery-notice')!.getAttribute('role')).toBe('status');
      expect(text('workflow-avery-notice')).toBe('Conversation archived');
    });

    it('a refused Archive shows its message and keeps the run', () => {
      runs.archive.and.returnValue(throwError(() => ({ error: { message: 'The run is still running' } })));
      openStored(ended());
      click('workflow-run-archive');
      expect(text('workflow-avery-error')).toBe('The run is still running');
      expect(q('workflow-run-question')).not.toBeNull();
    });

    it('Unarchive calls the API and shows the run open for messages', () => {
      openStored(ended({ archivedAt: '2026-11-20T10:00:00.000Z' }));
      runs.getRun.and.returnValue(of(ended()));
      click('workflow-run-unarchive');
      expect(runs.unarchive).toHaveBeenCalledWith('run-1');
      expect(q('workflow-run-archived')).toBeNull();
      expect(q('workflow-avery-input')).not.toBeNull();
    });
  });

  describe('reference images: paste, drop and attach (workflows R35; ui.md 4.4b)', () => {
    const IMAGES_FIELD: WorkflowDetail['input'][number] = {
      name: 'images',
      label: 'Reference images',
      type: 'images',
      required: false,
      max: 4,
      help: 'Paste, drop or attach up to 4 PNG, JPEG or WebP images, 5 MB each.',
    };
    const WITH_IMAGES: WorkflowDetail = {
      ...ASSISTANT,
      input: [
        ASSISTANT.input[0],
        IMAGES_FIELD,
        ...ASSISTANT.input.filter((f) => f.name !== 'question' && f.type !== 'datasets'),
      ],
    };
    const RECREATE: WorkflowDetail = {
      ...ASSISTANT,
      input: [
        { name: 'image', label: 'Dashboard image', type: 'image', required: true },
        ASSISTANT.input[0],
      ],
    };

    function openWith(workflow: WorkflowDetail, run?: WorkflowRun): void {
      if (run) designer.showRunOnLoad(run);
      open(workflow);
    }

    const file = (name: string, type = 'image/png', bytes = 4) =>
      new File([new Uint8Array(bytes)], name, { type });

    function transfer(...files: File[]): DataTransfer {
      const data = new DataTransfer();
      for (const f of files) data.items.add(f);
      return data;
    }

    function paste(data: DataTransfer): ClipboardEvent {
      const event = new ClipboardEvent('paste', {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      });
      q('run-composer')!.dispatchEvent(event);
      return event;
    }

    function drop(...files: File[]): DragEvent {
      const event = new DragEvent('drop', {
        dataTransfer: transfer(...files),
        bubbles: true,
        cancelable: true,
      });
      q('run-composer')!.dispatchEvent(event);
      return event;
    }

    async function until(done: () => boolean): Promise<void> {
      for (let i = 0; i < 100 && !done(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        fixture.detectChanges();
      }
      fixture.detectChanges();
    }

    const thumbs = () => el.querySelectorAll('[data-testid^="workflow-input-images-thumb-"]').length;

    it('shows the paperclip and the help in the + menu, and no thumbnail before any image', () => {
      openWith(WITH_IMAGES);
      openMenu('images');
      expect(text('run-composer-menu-item-images')).toContain('up to 4');
      expect(q('workflow-input-images-attach')!.getAttribute('aria-label')).toBe('Attach images');
      expect(q('workflow-input-images')!.textContent).toContain('Reference images');
      expect(q('workflow-input-images')!.textContent).toContain('up to 4 PNG, JPEG or WebP images');
      expect(thumbs()).toBe(0);
    });

    it('pasting an image adds a thumbnail and a chip; pasting text is left alone', async () => {
      openWith(WITH_IMAGES);
      openMenu('images');
      const plain = new DataTransfer();
      plain.setData('text/plain', 'hello');
      expect(paste(plain).defaultPrevented).toBeFalse();
      expect(thumbs()).toBe(0);

      const event = paste(transfer(file('shot.png')));
      expect(event.defaultPrevented).toBeTrue();
      await until(() => thumbs() === 1);
      const img = q('workflow-input-images-thumb-0') as HTMLImageElement;
      expect(img.alt).toBe('Reference image 1');
      expect(img.src).toMatch(/^data:image\/png;base64,/);
      expect(text('run-composer-chip-images')).toContain('Image 1');
    });

    it('dropping images adds them, and the picker adds more', async () => {
      openWith(WITH_IMAGES);
      openMenu('images');
      drop(file('a.png'), file('b.jpg', 'image/jpeg'));
      await until(() => thumbs() === 2);
      const input = q('workflow-input-images-file') as HTMLInputElement;
      input.files = transfer(file('c.webp', 'image/webp')).files;
      input.dispatchEvent(new Event('change'));
      await until(() => thumbs() === 3);
      expect(q('workflow-input-error-images')).toBeNull();
    });

    it('refuses a fifth image, another type and a file over 5 MB with the backend wording', async () => {
      openWith(WITH_IMAGES);
      openMenu('images');
      drop(file('1.png'), file('2.png'), file('3.png'), file('4.png'), file('5.png'));
      await until(() => thumbs() === 4);
      expect(text('workflow-input-error-images')).toBe('Reference images must be at most 4 images');
      expect((q('workflow-input-images-attach') as HTMLButtonElement).disabled).toBeTrue();

      click('workflow-input-images-remove-3');
      expect(thumbs()).toBe(3);
      expect(q('workflow-input-error-images')).toBeNull();

      drop(file('a.gif', 'image/gif'));
      await until(() => q('workflow-input-error-images') !== null);
      expect(text('workflow-input-error-images')).toBe(
        'Reference images must be PNG, JPEG or WebP images',
      );
      drop(file('big.png', 'image/png', 5 * 1024 * 1024 + 1));
      await until(() => text('workflow-input-error-images').includes('5 MB'));
      expect(text('workflow-input-error-images')).toBe('Reference images must be at most 5 MB each');
      expect(thumbs()).toBe(3);
    });

    it('Send sends the images as data URLs, and nothing when there are none', async () => {
      openWith(WITH_IMAGES);
      typeMessage('Why the dip?');
      send();
      expect(Object.keys(runs.last.body.input)).not.toContain('images');
      designer.stop();
      fixture.detectChanges();
      expect(q('run-composer')).toBeNull();
      click('workflow-run-new');
      typeMessage('Why the dip?');
      drop(file('a.png'));
      await until(() => q('run-composer-chip-images') !== null);
      send();
      expect((runs.last.body.input['images'] as string[])[0]).toMatch(/^data:image\/png;base64,/);
    });

    it('a workflow with only an image field takes a paste or a drop there, replacing it', async () => {
      openWith(RECREATE);
      openMenu('image');
      expect(q('workflow-input-images')).toBeNull();
      paste(transfer(file('first.png')));
      await until(() => q('workflow-input-image-preview') !== null);
      const first = (q('workflow-input-image-preview') as HTMLImageElement).src;
      drop(file('second.jpg', 'image/jpeg'));
      await until(() => (q('workflow-input-image-preview') as HTMLImageElement).src !== first);
      expect((q('workflow-input-image-preview') as HTMLImageElement).src).toMatch(
        /^data:image\/jpeg;base64,/,
      );
    });

    it('a workflow with no image field leaves a pasted image alone', () => {
      openWith({ ...ASSISTANT, input: [ASSISTANT.input[0]] });
      expect(paste(transfer(file('shot.png'))).defaultPrevented).toBeFalse();
    });

    it('a missing image is asked for with an upload card; the image picked answers it', async () => {
      openWith(RECREATE);
      typeMessage('Rebuild it');
      send();
      expect(q('run-intake-image')!.textContent).toContain(
        'Happy to. First, please add the dashboard image: drop, paste or pick an image.',
      );
      expect(text('run-intake-upload-image')).toBe('Choose an image');
      const input = q('run-intake-file-image') as HTMLInputElement;
      input.files = transfer(file('dash.png')).files;
      input.dispatchEvent(new Event('change'));
      await until(() => runs.calls.length === 1);
      const turns = el.querySelectorAll('[data-testid="run-user-message"]');
      expect(turns[turns.length - 1].textContent?.trim()).toBe('dash.png');
      expect(runs.last.body.input['image'] as string).toMatch(/^data:image\/png;base64,/);
      expect(runs.last.body.input['question']).toBe('Rebuild it');
    });

    it('an image pasted while the agent asks for it answers it too', async () => {
      openWith(RECREATE);
      typeMessage('Rebuild it');
      send();
      paste(transfer(file('pasted.png')));
      await until(() => runs.calls.length === 1);
      expect(runs.last.body.input['image'] as string).toMatch(/^data:image\/png;base64,/);
    });

    describe('The question bubble', () => {
      const STORED = assistantRun({
        input: {
          question: 'Which team scored the most goals?',
          datasets: [],
          images: ['inputs/images/1.png', 'inputs/images/2.jpg'],
        },
        answer: { role: 'assistant', content: 'Brazil scored the most goals.', at: 'x' },
      });

      it('shows the run images under its question, read through the run endpoint', () => {
        openWith(WITH_IMAGES, STORED);
        const first = q('workflow-run-question-image-0') as HTMLImageElement;
        expect(first.alt).toBe('Reference image 1');
        expect(first.src).toContain('/workflow-runs/run-1/input-image?path=inputs%2Fimages%2F1.png');
        expect(q('workflow-run-question-image-1')).not.toBeNull();
        expect(q('workflow-run-question-images')).not.toBeNull();
      });

      it('shows no thumbnails for a run without images', () => {
        openWith(WITH_IMAGES, assistantRun());
        expect(q('workflow-run-question-images')).toBeNull();
      });

      it('Run again starts with no images (a stored run holds paths): a pasted one is sent as a data URL', async () => {
        openWith(WITH_IMAGES, STORED);
        expect(q('run-composer')).toBeNull();
        click('workflow-run-again');
        openMenu('images');
        expect(thumbs()).toBe(0);
        paste(transfer(file('new.png')));
        await until(() => thumbs() === 1);
        send();
        const sent = runs.last.body.input['images'] as string[];
        expect(sent.length).toBe(1);
        expect(sent[0]).toMatch(/^data:image\/png;base64,/);
        expect(runs.last.body.context).toBeUndefined();
      });
    });
  });

  describe('run progress and a run that waits for an answer (ui.md 4.4b)', () => {
    const WAITING = {
      stepId: 'analyse',
      title: 'Analyse',
      question: 'Which year?',
      options: ['2018', '2022'],
      expiresAt: '2026-11-11T10:30:00.000Z',
    };

    const FLOW: WorkflowDetail = {
      ...ASSISTANT,
      stepCount: 2,
      steps: [
        STEP('receive-question', 'Receive question', ['question'], ['question']),
        {
          ...STEP('analyse', 'Analyse', ['question'], ['calls', 'stopped']),
          kind: 'agent',
        },
      ],
    };

    function openFlow(afterLoad?: () => void): void {
      open(FLOW, () => {
        http.expectOne((r) => r.url.endsWith('/datasets')).flush({
          datasets: [
            { name: 'World Cup Core', tables: ['a'], datasourceKind: 'postgres' },
          ],
        });
        afterLoad?.();
      });
    }

    function startV2(): RunStreamHandlers {
      openFlow();
      typeMessage('Which year?');
      send();
      click('run-intake-option-datasets-World Cup Core');
      click('run-intake-continue');
      return runs.last.handlers;
    }

    it('shows no step cards, progress list or activity line in the chat while the run goes (they live in the Logs and the Run header)', () => {
      const h = startV2();
      h.onRun!({ runId: 'run-1', workflowId: 'answer-business-question' });
      h.onStep!({ id: 'receive-question', title: 'Receive question', status: 'success' });
      h.onStep!({ id: 'analyse', title: 'Analyse', status: 'running', startedAt: new Date().toISOString() });
      h.onTool!({ name: 'run_readonly_sql', rationale: 'Counting matches' } as never);
      fixture.detectChanges();
      expect(el.querySelector('[data-testid^="workflow-run-step-"]')).toBeNull();
      expect(el.querySelector('[data-testid^="workflow-run-progress"]')).toBeNull();
      expect(q('workflow-run-activity')).toBeNull();
      expect(q('workflow-run-live')).not.toBeNull();
      expect(q('workflow-run-input-required')).toBeNull();
    });

    it('pins the waiting card at the top when the run suspends and resumes it with the answer', () => {
      const h = startV2();
      h.onRun!({ runId: 'run-1', workflowId: 'answer-business-question' });
      h.onStep!({ id: 'analyse', title: 'Analyse', status: 'suspended' });
      h.onInputRequired!({ runId: 'run-1', ...WAITING });
      h.onDone!(
        assistantRun({
          id: 'run-1',
          workflowId: 'answer-business-question',
          status: 'suspended',
          answer: undefined,
          waitingFor: WAITING,
          steps: [{ id: 'analyse', title: 'Analyse', status: 'suspended' }],
        }),
      );
      fixture.detectChanges();
      expect(text('workflow-run-input-question')).toBe('Which year?');
      expect(text('workflow-run-status')).toBe('Waiting for you');
      // On the agent's side, after the question bubble, before the status line.
      const card = el.querySelector('app-workflow-run-input-required')!;
      expect(q('run-agent-turn')!.contains(card)).toBeTrue();
      expect(
        q('workflow-run-question')!.compareDocumentPosition(card) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        card.compareDocumentPosition(q('workflow-run-status')!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(q('workflow-run-question')).not.toBeNull();
      click('workflow-run-input-option-1');
      expect(runs.resumes.length).toBe(1);
      expect(runs.resumes[0]).toEqual(
        jasmine.objectContaining({ runId: 'run-1', stepId: 'analyse', answer: '2022' }),
      );
      expect(q('workflow-run-input-required')).toBeNull();
    });

    it('an expired run shows the card expired and Run again with my answer starts a follow-up', () => {
      openFlow(() => {
        designer.showRunOnLoad(
          assistantRun({
            id: 'run-1',
            workflowId: 'answer-business-question',
            status: 'stopped',
            answer: undefined,
            waitingFor: { ...WAITING, expired: true },
          }),
        );
        designer.load(FLOW.id);
        http
          .expectOne((r) => r.url.endsWith('/workflows/answer-business-question'))
          .flush(FLOW);
        http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: [] });
      });
      expect(text('workflow-run-input-expired')).toBe('This run can no longer continue.');
      expect((q('workflow-run-input-rerun') as HTMLButtonElement).disabled).toBeTrue();
    });
  });
});
