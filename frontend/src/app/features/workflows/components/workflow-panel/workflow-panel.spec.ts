import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
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

const SEQ: WorkflowDetail = {
  id: 'seq-text-demo',
  name: 'Sequential test workflow',
  description: 'A three-step example.',
  kind: 'code',
  owner: 'Official',
  agents: [],
  stepCount: 3,
  bar: 'steps',
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
  downloadPanelItem = jasmine.createSpy('downloadPanelItem');
  downloadRfpPackage = jasmine
    .createSpy('downloadRfpPackage')
    .and.returnValue(of(new Blob(['zip'])));
  panelItemFile = jasmine.createSpy('panelItemFile').and.returnValue(
    of({
      item: { id: 'p1' },
      contentType: 'text/markdown',
      text: '# DRAFT — Orchard Manufacturing — 2027 benefits RFP',
    }),
  );

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

const ASSISTANT: WorkflowDetail = {
  ...SEQ,
  id: 'agent:assistant',
  name: 'Assistant',
  kind: 'agent',
  trigger: 'run',
  bar: 'agent',
  stepCount: 1,
  agents: [{ key: 'assistant', name: 'Questions to Insights Assistant' }],
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
      name: 'careful',
      label: 'Careful: cross-check the result with an independent query',
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
    workflowId: 'seq-text-demo',
    workflowName: 'Sequential test workflow',
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
    workflowId: 'agent:assistant',
    workflowName: 'Assistant',
    input: { question: 'Which team scored the most goals?', datasets: [], careful: false },
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
        input: [{ name: 'rfpId', label: 'RFP', type: 'text', required: false, hidden: true }],
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
      expect(call.workflowId).toBe('seq-text-demo');
      expect(call.body).toEqual({ input: { text: '  Hello  ' } });
      fixture.detectChanges();
      const button = q('workflow-run') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.textContent?.trim()).toBe('Executing…');
      expect(text('workflow-run-stop')).toBe('Stop');
      expect(text('workflow-run-status')).toBe('Running…');

      call.handlers.onRun!({ runId: 'run-1', workflowId: 'seq-text-demo' });
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
      type('   ');
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
      execute().handlers.onError!('Text is required');
      fixture.detectChanges();
      expect(text('workflow-run-error')).toBe('Text is required');
      expect(q('workflow-run-error')?.getAttribute('role')).toBe('alert');
      expect(q('workflow-run-result')).toBeNull();

      type('a');
      execute();
      done({ output: { summary: 'first' } });
      expect(q('workflow-run-error')).toBeNull();
      execute();
      done({ output: { summary: 'second' } });
      expect(q('workflow-run-output')?.textContent).toContain('second');
      expect(q('workflow-run-output')?.textContent).not.toContain('first');
    });
  });

  describe('Run tab of an agent workflow (workflows R21)', () => {
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
      const field = q('workflow-input-question') as HTMLTextAreaElement;
      field.value = value;
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

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

      const careful = q('workflow-input-careful') as HTMLInputElement;
      expect(careful.type).toBe('checkbox');
      expect(careful.checked).toBe(false);
      expect(careful.closest('label')?.textContent?.trim()).toBe(
        'Careful: cross-check the result with an independent query',
      );
      careful.click();
      fixture.detectChanges();
      expect(designer.checked('careful')).toBe(true);

      typeQuestion('Which team scored the most goals?');
      click('workflow-run');
      expect(runs.last.body).toEqual({
        input: {
          question: 'Which team scored the most goals?',
          datasets: ['World Cup Core'],
          careful: true,
        },
      });
    });

    it('a dataset field is a list of the datasets of its kinds', () => {
      openAssistant({
        ...ASSISTANT,
        input: [
          {
            name: 'dataset',
            label: 'Dataset',
            type: 'dataset',
            required: true,
            datasourceKinds: ['postgres', 'databricks'],
          },
        ],
      });
      const select = q('workflow-input-dataset') as HTMLSelectElement;
      expect(select.tagName).toBe('SELECT');
      expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual([
        'Select a dataset',
        'World Cup Core',
      ]);
    });

    it('example chips fill the question and do not run', () => {
      openAssistant({ ...ASSISTANT, starterQuestions: ['Which team scored the most goals?'] });
      click('workflow-example-0');
      expect((q('workflow-input-question') as HTMLTextAreaElement).value).toBe(
        'Which team scored the most goals?',
      );
      expect(runs.calls.length).toBe(0);
    });

    it("a user agent's own datasets are read-only chips, not a picker", () => {
      openAssistant({
        ...ASSISTANT,
        id: 'agent:u1',
        owner: 'You',
        datasets: ['World Cup Core'],
        input: ASSISTANT.input.filter((f) => f.type !== 'datasets'),
      });
      expect(q('workflow-input-datasets')).toBeNull();
      expect(text('workflow-run-datasets')).toContain('World Cup Core');
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
      click('workflow-run');
      const h = runs.last.handlers;
      h.onRun!({ runId: 'run-1', workflowId: 'agent:assistant' });
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
        input: { question: 'And the fewest?', datasets: [], careful: false },
        context: { fromRunId: 'run-1' },
      });
      fixture.detectChanges();
      expect(text('workflow-run-context')).toBe(
        'Follows up on “Which team scored the most goals?”',
      );
    });

    describe('a Data Readiness run (1.23.16; data-readiness R2, R5)', () => {
      const REPORT = sampleReadinessReport({ id: 'r1', datasourceName: 'World Cup DB' });
      const READINESS: WorkflowDetail = {
        ...ASSISTANT,
        id: 'agent:data-readiness',
        name: 'Data Readiness Agent',
        agents: [{ key: 'data-readiness', name: 'Data Readiness Agent' }],
        input: [
          {
            name: 'dataset',
            label: 'Dataset',
            type: 'dataset',
            required: true,
            datasourceKinds: ['postgres', 'databricks'],
          },
          {
            name: 'question',
            label: 'Question',
            type: 'textarea',
            required: false,
            placeholder: 'Assess the readiness of this dataset',
            default: 'Assess the readiness of this dataset',
          },
        ],
      };
      const SQL_FILE = {
        id: 'file:synthetic/world_cup.sql',
        kind: 'file' as const,
        title: 'Synthetic data — World Cup',
        shownAt: '2026-11-11T10:00:02.000Z',
        path: 'synthetic/world_cup.sql',
        bytes: 2048,
      };

      function readinessRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
        return assistantRun({
          workflowId: 'agent:data-readiness',
          workflowName: 'Data Readiness Agent',
          input: { dataset: 'World Cup Core', question: 'Assess the readiness of this dataset' },
          question: 'Assess the readiness of this dataset',
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
        click('workflow-run');
        const h = runs.last.handlers;
        h.onRun!({ runId: run.id, workflowId: run.workflowId });
        h.onDone!(run);
        fixture.detectChanges();
      }

      it('the running tool row shows the assessment progress', () => {
        openAssistant(READINESS);
        click('workflow-run');
        const h = runs.last.handlers;
        h.onRun!({ runId: 'run-1', workflowId: 'agent:data-readiness' });
        h.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
        h.onTool!({ name: 'assess_data_readiness' });
        h.onToolProgress!({
          tool: 'assess_data_readiness',
          phase: 'profiling',
          message: 'Profiling world_cup.goals (3/12)…',
          done: 3,
          total: 12,
        });
        fixture.detectChanges();
        expect(q('workflow-run-tool')?.textContent).toContain(
          'Profiling world_cup.goals (3/12)…',
        );
      });

      it('Open scorecard on the readiness card shows the scorecard in the Run tab, and Close hides it', () => {
        openAssistant(READINESS);
        finishRun(readinessRun());
        expect(q('workflow-run-scorecard')).toBeNull();
        click('readiness-open-scorecard');
        http
          .expectOne((r) => r.url.endsWith('/data-readiness/assessments/r1'))
          .flush(REPORT);
        fixture.detectChanges();
        const scorecard = q('workflow-run-scorecard')!;
        expect(scorecard.querySelector('[data-testid="readiness-scorecard"]')?.textContent).toContain(
          'World Cup DB',
        );
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
        finishRun(readinessRun({ id: 'run-2' }));
        expect(q('workflow-run-scorecard')).toBeNull();
      });

      it("lists the run's synthetic SQL files and downloads one through the run's route", () => {
        runs.downloadPanelItem.and.returnValue(of(new Blob(['INSERT INTO t VALUES (1);'])));
        spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
        const clicks = spyOn(HTMLAnchorElement.prototype, 'click');
        openAssistant(READINESS);
        finishRun(readinessRun({ panelItems: [sampleReadinessPanelItem('r1'), SQL_FILE] }));
        const files = q('workflow-run-files')!;
        expect(files.textContent).toContain('Synthetic data — World Cup');
        expect(files.textContent).toContain('world_cup.sql');
        const button = files.querySelector<HTMLButtonElement>(
          'button[aria-label="Download world_cup.sql"]',
        )!;
        button.click();
        fixture.detectChanges();
        expect(runs.downloadPanelItem).toHaveBeenCalledOnceWith(
          'run-1',
          'file:synthetic/world_cup.sql',
        );
        expect(clicks).toHaveBeenCalled();
      });

      it('a run without file items lists no files', () => {
        openAssistant(READINESS);
        finishRun(readinessRun());
        expect(q('workflow-run-files')).toBeNull();
      });
    });

    it('Stop ends the run: the run reads "Run stopped"', () => {
      openAssistant();
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
  });

  describe('Run tab of the RFP Builder (plan 4.3; rfp R2, R4, R9, R16)', () => {
    const RFP: WorkflowDetail = {
      ...ASSISTANT,
      id: 'agent:rfp',
      name: 'RFP Builder',
      agents: [{ key: 'rfp', name: 'RFP Builder' }],
      datasets: ['Intellify RFP API'],
      input: [
        {
          name: 'message',
          label: 'Message',
          type: 'textarea',
          required: true,
          placeholder: 'Name the client and plan year, or state your decision',
        },
        { name: 'rfpId', label: 'RFP', type: 'text', required: false, hidden: true },
      ],
    };
    const START = 'Start an RFP for Orchard Manufacturing, plan year 2027';
    const STAGES = [
      { number: 1, title: 'Client and renewal' },
      { number: 2, title: 'Current program' },
      { number: 3, title: 'What to market' },
    ];

    function rfpRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
      return assistantRun({
        workflowId: 'agent:rfp',
        workflowName: 'RFP Builder',
        input: { message: START },
        question: START,
        answer: { role: 'assistant', content: 'Stage 1 proposal. Confirm?', at: 'x' },
        rfpId: 'rfp-1',
        ...overrides,
      });
    }

    function openRfp(workflow: WorkflowDetail = RFP): void {
      open(workflow);
    }

    function typeMessage(value: string): void {
      const field = q('workflow-input-message') as HTMLTextAreaElement;
      field.value = value;
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    it('the form is the message only; the hidden RFP has no control', () => {
      openRfp();
      expect(
        (q('workflow-input-message') as HTMLTextAreaElement).placeholder,
      ).toBe('Name the client and plan year, or state your decision');
      expect(q('workflow-input-rfpId')).toBeNull();
      expect(q('workflow-input-datasets')).toBeNull();
    });

    it('without the API sample Execute is disabled with the requirement', () => {
      const requirement =
        'Load the "Intellify RFP API" sample in Settings → Testing Data first';
      openRfp({ ...RFP, runRequirement: requirement });
      const button = q('workflow-run') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.title).toBe(requirement);
      expect(text('workflow-run-requirement')).toBe(requirement);
    });

    it('shows the stages inside the agent step, then Continue under the answer; Continue sends the RFP and the context', () => {
      openRfp();
      typeMessage(START);
      click('workflow-run');
      const h = runs.last.handlers;
      h.onRun!({ runId: 'run-1', workflowId: 'agent:rfp' });
      h.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
      h.onWorkflow!({ phases: STAGES, current: 1, done: [], source: 'prompt', skipped: [] });
      fixture.detectChanges();
      const phases = q('workflow-run-phases')!;
      expect(phases).not.toBeNull();
      expect(q('workflow-run-phase-1')?.getAttribute('aria-current')).toBe('step');
      expect(q('workflow-run-phase-1')?.textContent).toContain('Client and renewal');

      h.onDone!(
        rfpRun({
          workflow: { phases: STAGES, current: 2, done: [1], source: 'prompt', skipped: [] },
        }),
      );
      fixture.detectChanges();
      expect(q('workflow-run-phase-1')?.textContent).toContain('Done');
      expect(q('workflow-run-phase-2')?.getAttribute('aria-current')).toBe('step');
      expect(q('workflow-follow-up-input')).toBeNull();
      expect(text('workflow-run-continue')).toBe('Continue');

      click('workflow-run-continue');
      expect((q('workflow-input-message') as HTMLTextAreaElement).value).toBe('');
      expect(text('workflow-run-continue-from')).toContain(`Continues “${START}”`);
      typeMessage('yes');
      click('workflow-run');
      expect(runs.last.body).toEqual({
        input: { message: 'yes', rfpId: 'rfp-1' },
        context: { fromRunId: 'run-1' },
      });
    });

    it('a code workflow (bar: steps) shows no phases list, even when the run carries phases', () => {
      openRfp({ ...RFP, bar: 'steps' });
      typeMessage(START);
      click('workflow-run');
      const h = runs.last.handlers;
      h.onRun!({ runId: 'run-1', workflowId: 'agent:rfp' });
      h.onStep!({ id: 'answer', title: 'Answer', status: 'running' });
      h.onWorkflow!({ phases: STAGES, current: 1, done: [], source: 'prompt', skipped: [] });
      fixture.detectChanges();
      expect(q('workflow-run-phases')).toBeNull();
    });

    it("the package card downloads from the run's route, and the RFP document shows in the panel", () => {
      openRfp();
      typeMessage('Export a draft');
      click('workflow-run');
      const h = runs.last.handlers;
      h.onRun!({ runId: 'run-3', workflowId: 'agent:rfp' });
      h.onDone!(
        rfpRun({
          id: 'run-3',
          answer: {
            role: 'assistant',
            content: 'Here is a draft, marked DRAFT.',
            at: 'x',
            rfpPackage: {
              rfpId: 'rfp-1',
              title: 'Orchard Manufacturing — 2027 benefits RFP',
              files: [{ name: 'rfp.md', bytes: 10 }],
              exportedAt: 'x',
              draft: true,
            },
          },
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
      );
      fixture.detectChanges();
      expect(runs.panelItemFile).toHaveBeenCalledWith('run-3', 'p1');
      expect(text('run-rfp-document')).toContain(
        'DRAFT — Orchard Manufacturing — 2027 benefits RFP',
      );
      const click$ = spyOn(HTMLAnchorElement.prototype, 'click');
      click('rfp-package-download');
      expect(runs.downloadRfpPackage).toHaveBeenCalledWith(
        'run-3',
        'rfp-1',
        undefined,
        true,
      );
      expect(click$).toHaveBeenCalledTimes(1);
    });
  });
});
