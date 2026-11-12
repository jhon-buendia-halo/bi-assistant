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
import { WorkflowPanel } from './workflow-panel';

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

describe('WorkflowPanel, the right panel of a workflow page (workflows R7–R13; ui.md 4.4b)', () => {
  let fixture: ComponentFixture<WorkflowPanel>;
  let designer: WorkflowDesigner;
  let http: HttpTestingController;
  let el: HTMLElement;
  let runs: FakeRunsApi;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowPanel],
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
    fixture = TestBed.createComponent(WorkflowPanel);
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
      expect(q('workflow-run-step-clean-text')?.textContent).toContain('Running');

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
      const row = q('workflow-run-step-clean-text')!;
      expect(row.textContent).toContain('Clean text');
      expect(row.textContent).toContain('Done');
      // Step outputs read as key/value rows, a text with its quotes unescaped.
      const output = row.querySelector('[data-testid="workflow-run-step-output"]')!;
      expect(output.querySelector('dt')?.textContent?.trim()).toBe('text');
      expect(output.querySelector('dd')?.textContent?.trim()).toBe('"Hello"');
      expect(output.textContent).not.toContain('\\"');
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
      expect(q('workflow-run-step-clean-text')?.textContent).toContain('Failed');
      expect(q('workflow-run-step-clean-text')?.textContent).toContain('The text is empty');
      expect(q('workflow-run-step-count-words')?.textContent).toContain('Skipped');
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
        ['World Cup Core', '2 entities'],
        ['Sales', '1 entities'],
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
      expect(q('workflow-run-step-answer')?.textContent).toContain('Stopped');
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
});
