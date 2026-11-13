import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
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
  id: 'qti-v2-turn',
  name: 'Questions to Insights v2',
  description: 'Answers a question in four steps.',
  trigger: 'run',
  input: [],
  agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
  steps: [
    STEP('receive-question', 'Receive question', ['question', 'datasets'], ['question', 'datasets']),
    {
      ...STEP('analyse', 'Analyse', ['question', 'catalog'], ['calls', 'stopped']),
      kind: 'agent',
      agent: {
        name: 'Questions to Insights v2',
        tools: ['list_entities', 'describe_entity', 'run_readonly_sql'],
        maxSteps: 15,
      },
      exits: [
        { label: 'Model error', outcome: 'fails' },
        { label: 'Stop', outcome: 'stops' },
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
  id: 'qti-v2-turn',
  name: 'Questions to Insights v2',
  trigger: 'run',
  stepCount: 1,
  agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
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
    workflowId: 'qti-v2-turn',
    workflowName: 'Questions to Insights v2',
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

  describe('Run only (ui.md 4.4b)', () => {
    it('has no tabs and none of the configuration: only the run form', () => {
      open(SEQ);
      expect(el.querySelector('[role="tablist"]')).toBeNull();
      expect(el.querySelector('[role="tab"]')).toBeNull();
      expect(q('workflow-panel-trigger')).toBeNull();
      expect(q('workflow-code')).toBeNull();
      expect(q('workflow-input-text')).not.toBeNull();
      expect(text('workflow-run')).toBe('Execute');
    });

    it('a workflow without an input shows no run form', () => {
      open(V2);
      expect(q('workflow-run')).toBeNull();
    });

    it('Execute workflow on the canvas focuses the first field of the form, once', fakeAsync(() => {
      open(SEQ);
      (document.activeElement as HTMLElement | null)?.blur();
      designer.requestRunForm();
      fixture.detectChanges();
      tick();
      expect(document.activeElement).toBe(q('workflow-input-text'));
      expect(designer.runFormRequest()).toBe(0);
    }));

    it('with no field to focus, Execute workflow focuses Execute', fakeAsync(() => {
      open({
        ...SEQ,
        input: [{ name: 'secret', label: 'Secret', type: 'text', required: false, hidden: true }],
      });
      designer.requestRunForm();
      fixture.detectChanges();
      tick();
      expect(document.activeElement).toBe(q('workflow-run'));
    }));
  });

  describe('Run tab (workflows R12, R13)', () => {
    function type(value: string): void {
      const field = q('workflow-input-text') as HTMLTextAreaElement;
      field.value = value;
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    function execute() {
      click('workflow-run');
      return runs.last;
    }

    function done(run: Partial<WorkflowRun>): void {
      runs.last.handlers.onDone!(seqRun(run));
      fixture.detectChanges();
    }

    function openRun(): void {
      open(SEQ);
    }

    it('shows the input form and Execute', () => {
      openRun();
      const field = q('workflow-input-text') as HTMLTextAreaElement;
      expect(field.tagName).toBe('TEXTAREA');
      expect(field.placeholder).toBe('Paste or type any text');
      expect(field.getAttribute('aria-required')).toBe('true');
      expect(el.querySelector(`label[for="${field.id}"]`)?.textContent?.trim()).toBe('Text');
      expect(text('workflow-run')).toBe('Execute');
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
      const button = q('workflow-run') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.textContent?.trim()).toBe('Executing…');
      expect(text('workflow-run-stop')).toBe('Stop');
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
      expect(button.disabled).toBe(false);
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

    it("shows the server's refusal and keeps no result; running again replaces the result", () => {
      openRun();
      type('a');
      execute().handlers.onError!('Backend unreachable');
      fixture.detectChanges();
      expect(text('workflow-run-error')).toBe('Backend unreachable');
      expect(q('workflow-run-error')?.getAttribute('role')).toBe('alert');
      expect(q('workflow-run-result')).toBeNull();

      execute();
      done({ output: { summary: 'first' } });
      expect(q('workflow-run-error')).toBeNull();
      execute();
      done({ output: { summary: 'second' } });
      expect(q('workflow-run-output')?.textContent).toContain('second');
      expect(q('workflow-run-output')?.textContent).not.toContain('first');
    });
  });

  describe('Run tab of a workflow with an agent step (workflows R21)', () => {
    const DATASETS = [
      { name: 'World Cup Core', tables: ['a', 'b'], datasourceKind: 'postgres' },
      { name: 'Sales', tables: ['c'], datasourceKind: 'rest' },
    ];

    function openAssistant(workflow: WorkflowDetail = ASSISTANT): void {
      open(workflow, () => {
        if (workflow.input.some((f) => f.type === 'datasets')) {
          http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: DATASETS });
        }
      });
    }

    function typeQuestion(value: string): void {
      const field = q('workflow-input-question') as HTMLTextAreaElement;
      field.value = value;
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    function pickDataset(): void {
      q('workflow-input-datasets')!.querySelector('button')!.click();
      fixture.detectChanges();
    }

    it('refuses an invalid input before any request: each field shows its error and the first is focused', fakeAsync(() => {
      openAssistant();
      typeQuestion('   ');
      click('workflow-run');
      tick();
      expect(runs.calls.length).toBe(0);
      expect(q('workflow-run-error')).toBeNull();
      expect(text('workflow-input-error-question')).toBe('Question is required');
      expect(text('workflow-input-error-datasets')).toBe('Select at least one dataset');
      const question = q('workflow-input-question')!;
      expect(question.getAttribute('aria-invalid')).toBe('true');
      expect(question.getAttribute('aria-describedby')).toBe('workflow-input-error-question');
      expect(q('workflow-input-error-question')!.id).toBe('workflow-input-error-question');
      const picker = q('workflow-input-datasets')!;
      expect(picker.getAttribute('aria-invalid')).toBe('true');
      expect(picker.getAttribute('aria-describedby')).toBe('workflow-input-error-datasets');
      expect(q('workflow-input-verbose')!.hasAttribute('aria-invalid')).toBe(false);
      expect(document.activeElement).toBe(question);

      typeQuestion('Which team?');
      expect(q('workflow-input-error-question')).toBeNull();
      expect(question.hasAttribute('aria-invalid')).toBe(false);
      expect(question.hasAttribute('aria-describedby')).toBe(false);
      expect(q('workflow-input-error-datasets')).not.toBeNull();

      pickDataset();
      expect(q('workflow-input-error-datasets')).toBeNull();
      click('workflow-run');
      expect(runs.calls.length).toBe(1);
    }));

    it('focuses the first dataset when the datasets field is the first invalid one', fakeAsync(() => {
      openAssistant();
      typeQuestion('Which team?');
      click('workflow-run');
      tick();
      expect(document.activeElement).toBe(
        q('workflow-input-datasets')!.querySelector('button'),
      );
    }));

    it("shows a server refusal's field errors on the fields", () => {
      openAssistant();
      typeQuestion('Which team?');
      pickDataset();
      click('workflow-run');
      runs.last.handlers.onError!('Question must be at most 4000 characters', [
        { field: 'question', message: 'Question must be at most 4000 characters' },
      ]);
      fixture.detectChanges();
      expect(text('workflow-input-error-question')).toBe(
        'Question must be at most 4000 characters',
      );
      expect(q('workflow-run-error')).toBeNull();
      expect(q('workflow-run-result')).toBeNull();
    });

    it('generates a control per field type: a text area, a datasets picker and a checkbox', () => {
      openAssistant();
      const question = q('workflow-input-question') as HTMLTextAreaElement;
      expect(question.tagName).toBe('TEXTAREA');
      expect(question.placeholder).toBe('Ask a question about your data');
      expect(el.querySelector(`label[for="${question.id}"]`)?.textContent?.trim()).toBe('Question');

      const picker = q('workflow-input-datasets')!;
      expect(picker.getAttribute('role')).toBe('group');
      expect(picker.textContent).toContain('Datasets');
      const cards = Array.from(picker.querySelectorAll('button'));
      expect(
        cards.map((b) =>
          Array.from(b.querySelectorAll('span')).map((span) => span.textContent?.trim()),
        ),
      ).toEqual([
        ['World Cup Core', ', 2 entities'],
        ['Sales', ', 1 entities'],
      ]);
      expect(cards[0].getAttribute('aria-pressed')).toBe('false');
      cards[0].click();
      fixture.detectChanges();
      expect(cards[0].getAttribute('aria-pressed')).toBe('true');
      expect(designer.picked('datasets')).toEqual(['World Cup Core']);

      const verbose = q('workflow-input-verbose') as HTMLInputElement;
      expect(verbose.type).toBe('checkbox');
      expect(verbose.checked).toBe(false);
      expect(verbose.closest('label')?.textContent?.trim()).toBe(
        'Verbose',
      );
      verbose.click();
      fixture.detectChanges();
      expect(designer.checked('verbose')).toBe(true);

      typeQuestion('Which team scored the most goals?');
      click('workflow-run');
      expect(runs.last.body).toEqual({
        input: {
          question: 'Which team scored the most goals?',
          datasets: ['World Cup Core'],
          verbose: true,
        },
      });
    });

    it('a datasets field lists only the datasets of its kinds', () => {
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
      const picker = q('workflow-input-datasets')!;
      expect(
        Array.from(picker.querySelectorAll('button')).map((b) =>
          b.querySelector('span')?.textContent?.trim(),
        ),
      ).toEqual(['World Cup Core']);
    });

    it('example chips fill the question and do not run', () => {
      openAssistant({ ...ASSISTANT, starterQuestions: ['Which team scored the most goals?'] });
      click('workflow-example-0');
      expect((q('workflow-input-question') as HTMLTextAreaElement).value).toBe(
        'Which team scored the most goals?',
      );
      expect(runs.calls.length).toBe(0);
    });

    it('a run requirement disables Execute with its text', () => {
      openAssistant({ ...ASSISTANT, runRequirement: "None of this agent's datasets exist" });
      const button = q('workflow-run') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.title).toBe("None of this agent's datasets exist");
      expect(text('workflow-run-requirement')).toBe("None of this agent's datasets exist");
    });

    it('shows the agent step live (Thinking, tool rows, the answer forming), then the answer and Follow up', () => {
      openAssistant();
      typeQuestion('Which team scored the most goals?');
      pickDataset();
      click('workflow-run');
      const h = runs.last.handlers;
      h.onRun!({ runId: 'run-1', workflowId: 'qti-v2-turn' });
      h.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
      h.onReasoning!('Looking at the goals table');
      h.onTool!({ name: 'run_readonly_sql', input: 'SELECT 1' });
      h.onToolResult!({ tool: 'run_readonly_sql', rowCount: 3 });
      h.onText!('Brazil scored');
      fixture.detectChanges();
      const live = q('workflow-run-live')!;
      expect(live.textContent).toContain('Thinking');
      expect(live.textContent).toContain('Looking at the goals table');
      expect(
        Array.from(q('workflow-run-tool')!.querySelectorAll('span')).map((span) =>
          span.textContent?.trim(),
        ),
      ).toEqual(['run_readonly_sql', '3 rows']);
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

      const followUp = q('workflow-follow-up-input') as HTMLInputElement;
      expect(followUp.placeholder).toBe('Ask a follow-up about this result');
      expect((q('workflow-run-follow-up') as HTMLButtonElement).disabled).toBe(true);
      followUp.value = 'And the fewest?';
      followUp.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      click('workflow-run-follow-up');
      expect(runs.last.body).toEqual({
        input: { question: 'And the fewest?', datasets: [], verbose: false },
        context: { fromRunId: 'run-1' },
      });
      fixture.detectChanges();
      expect(text('workflow-run-context')).toBe(
        'Follows up on “Which team scored the most goals?”',
      );
    });

    it('Stop ends the run: the run reads "Run stopped"', () => {
      openAssistant();
      typeQuestion('Which team scored the most goals?');
      pickDataset();
      click('workflow-run');
      const h = runs.last.handlers;
      h.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
      fixture.detectChanges();
      click('workflow-run-stop');
      expect(runs.last.signal?.aborted).toBe(true);
      expect(text('workflow-run-status')).toBe('Run stopped');
      expect(q('workflow-run-step-answer')).toBeNull();
      expect(text('workflow-run')).toBe('Execute');
    });

    it('an old run that carries an rfpId, a deep-analysis report or files shows as a plain answer', () => {
      openAssistant();
      typeQuestion('Export a draft');
      pickDataset();
      click('workflow-run');
      const h = runs.last.handlers;
      h.onRun!({ runId: 'run-3', workflowId: 'qti-v2-turn' });
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
      const field = q('workflow-input-question') as HTMLTextAreaElement;
      field.value = value;
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
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
      expect(q('workflow-run-empty')!.textContent).toContain('Questions to Insights v2');
      expect(q('workflow-run-empty')!.textContent).toContain(
        'Pick the datasets below and type a question.',
      );
      const list = el.querySelector('[aria-label="Example questions"]')!;
      expect(list.querySelectorAll('button').length).toBe(2);
      expect(text('workflow-example-1')).toBe('Who won in 2022?');
      expect(q('workflow-run-new')).toBeNull();
      expect(q('workflow-run-question')).toBeNull();
      expect(el.querySelector('h3')?.textContent).toContain('Chat');
    });

    it('an example chip fills the question but never runs', () => {
      openForm();
      click('workflow-example-1');
      expect((q('workflow-input-question') as HTMLTextAreaElement).value).toBe('Who won in 2022?');
      expect(runs.calls.length).toBe(0);
    });

    it('says to type a question when there are no datasets to pick, and to fill the input without a question', () => {
      openForm({
        ...ASSISTANT,
        input: ASSISTANT.input.filter((f) => f.type !== 'datasets'),
      });
      expect(text('workflow-run-empty')).toContain('Type a question below.');
      open({
        ...SEQ,
        input: [{ name: 'count', label: 'Count', type: 'number', required: true }],
      });
      expect(text('workflow-run-empty')).toContain('Fill in the input below and press Execute.');
      expect(el.querySelector('[aria-label="Example questions"]')).toBeNull();
    });

    it('the question field comes first, its label is screen-reader only and it has two rows', () => {
      openForm();
      const form = q('workflow-run-composer')!;
      expect(form.getAttribute('aria-label')).toBe('Input');
      expect(form.querySelector('textarea')).toBe(q('workflow-input-question') as HTMLTextAreaElement);
      expect((q('workflow-input-question') as HTMLTextAreaElement).rows).toBe(2);
      const label = el.querySelector('label[for="workflow-input-question"]')!;
      expect(label.classList).toContain('sr-only');
      expect(q('workflow-follow-up-input')).toBeNull();
    });

    it('Enter in the question submits; Shift+Enter does not', () => {
      openForm();
      typeQuestion('Which team scored the most goals?');
      q('workflow-input-datasets')!.querySelector('button')!.click();
      fixture.detectChanges();
      const shifted = pressEnter('workflow-input-question', { shiftKey: true });
      expect(shifted.defaultPrevented).toBeFalse();
      expect(runs.calls.length).toBe(0);
      const plain = pressEnter('workflow-input-question');
      expect(plain.defaultPrevented).toBeTrue();
      expect(runs.calls.length).toBe(1);
      expect(runs.last.body.input).toEqual(
        jasmine.objectContaining({ question: 'Which team scored the most goals?' }),
      );
    });

    it('under a stored answer the composer follows up, without the run form', () => {
      openStored(answered());
      expect(q('workflow-follow-up-input')).not.toBeNull();
      expect(q('workflow-input-question')).toBeNull();
      expect(q('workflow-input-datasets')).toBeNull();
      expect(q('workflow-run')).toBeNull();
      const follow = q('workflow-follow-up-input') as HTMLTextAreaElement;
      expect(follow.rows).toBe(1);
      expect(follow.getAttribute('aria-describedby')).toBe('workflow-follow-up-hint');
      const hint = el.querySelector('#workflow-follow-up-hint')!;
      expect(hint.textContent?.trim()).toBe('Follows up on this run');
      expect(hint.classList).toContain('sr-only');
      expect(q('workflow-run-empty')).toBeNull();
    });

    it('Enter in the follow-up sends it; Shift+Enter does not', () => {
      openStored(answered());
      const follow = q('workflow-follow-up-input') as HTMLTextAreaElement;
      follow.value = 'And the fewest?';
      follow.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      pressEnter('workflow-follow-up-input', { shiftKey: true });
      expect(runs.calls.length).toBe(0);
      pressEnter('workflow-follow-up-input');
      expect(runs.calls.length).toBe(1);
      expect(runs.last.body.context).toEqual({ fromRunId: 'run-1' });
    });

    it('a clarification answer keeps the normal composer', () => {
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
      expect(q('workflow-follow-up-input')).toBeNull();
      expect(q('workflow-input-question')).not.toBeNull();
      expect(q('workflow-run')).not.toBeNull();
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
      expect(q('workflow-input-question')).not.toBeNull();
      expect(q('workflow-run-new')).toBeNull();
    });

    it('New question is hidden while a run streams', () => {
      openForm();
      typeQuestion('Which team?');
      q('workflow-input-datasets')!.querySelector('button')!.click();
      fixture.detectChanges();
      click('workflow-run');
      runs.last.handlers.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
      fixture.detectChanges();
      expect(designer.running()).toBeTrue();
      expect(q('workflow-run-new')).toBeNull();
      expect(text('workflow-run-question')).toBe('Which team?');
      // The normal composer shows while it streams.
      expect(text('workflow-run')).toBe('Executing…');
      expect(q('workflow-follow-up-input')).toBeNull();
      runs.last.handlers.onDone!(answered());
      fixture.detectChanges();
      expect(q('workflow-run-new')).not.toBeNull();
    });

    it('renders no step card and no progress list, with or without a run', () => {
      openStored(answered());
      expect(el.querySelector('[data-testid^="workflow-run-step-"]')).toBeNull();
      expect(el.querySelector('[data-testid^="workflow-run-progress"]')).toBeNull();
      expect(q('workflow-run-result')).toBeNull();
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
      const field = q('workflow-input-question') as HTMLTextAreaElement;
      field.value = 'Which year?';
      field.dispatchEvent(new Event('input'));
      q('workflow-input-datasets')!.querySelector('button')!.click();
      fixture.detectChanges();
      click('workflow-run');
      return runs.last.handlers;
    }

    it('shows no step cards, progress list or activity line in the chat while the run goes (they live in the Logs and the Run header)', () => {
      const h = startV2();
      h.onRun!({ runId: 'run-1', workflowId: 'qti-v2-turn' });
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
      h.onRun!({ runId: 'run-1', workflowId: 'qti-v2-turn' });
      h.onStep!({ id: 'analyse', title: 'Analyse', status: 'suspended' });
      h.onInputRequired!({ runId: 'run-1', ...WAITING });
      h.onDone!(
        assistantRun({
          id: 'run-1',
          workflowId: 'qti-v2-turn',
          status: 'suspended',
          answer: undefined,
          waitingFor: WAITING,
          steps: [{ id: 'analyse', title: 'Analyse', status: 'suspended' }],
        }),
      );
      fixture.detectChanges();
      expect(text('workflow-run-input-question')).toBe('Which year?');
      expect(text('workflow-run-status')).toBe('Waiting for you');
      const order = Array.from(q('workflow-run-chat-log')!.children).map((child) =>
        child.tagName.toLowerCase(),
      );
      // After the question bubble, before the status line.
      expect(order.indexOf('app-workflow-run-input-required')).toBeGreaterThan(-1);
      expect(order.indexOf('app-workflow-run-input-required')).toBeLessThan(
        order.indexOf('p', order.indexOf('app-workflow-run-input-required')),
      );
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
            workflowId: 'qti-v2-turn',
            status: 'stopped',
            answer: undefined,
            waitingFor: { ...WAITING, expired: true },
          }),
        );
        designer.load(FLOW.id);
        http
          .expectOne((r) => r.url.endsWith('/workflows/qti-v2-turn'))
          .flush(FLOW);
        http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: [] });
      });
      expect(text('workflow-run-input-expired')).toBe('This run can no longer continue.');
      expect((q('workflow-run-input-rerun') as HTMLButtonElement).disabled).toBeTrue();
    });
  });
});
