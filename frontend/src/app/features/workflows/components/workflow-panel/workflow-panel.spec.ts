import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkflowDetail, WorkflowRunResult } from '../../models/workflow.model';
import { WorkflowDesigner } from '../../services/workflow-designer.service';
import { NO_STEP_SELECTED, WorkflowPanel } from './workflow-panel';

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
  picksDatasets: false,
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
  trigger: 'chat',
  input: [],
  agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
  picksDatasets: true,
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

describe('WorkflowPanel, the right panel of a workflow page (workflows R7–R13; ui.md 4.4b)', () => {
  let fixture: ComponentFixture<WorkflowPanel>;
  let designer: WorkflowDesigner;
  let http: HttpTestingController;
  let el: HTMLElement;
  let openedAgents: string[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowPanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    designer = TestBed.inject(WorkflowDesigner);
    openedAgents = [];
  });

  afterEach(() => http.verify());

  function open(workflow: WorkflowDetail): void {
    designer.load(workflow.id);
    http
      .expectOne((r) => r.url.endsWith(`/workflows/${workflow.id}`))
      .flush(workflow);
    fixture = TestBed.createComponent(WorkflowPanel);
    fixture.componentInstance.openAgent.subscribe((key) => openedAgents.push(key));
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const q = (testId: string) =>
    el.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  const text = (testId: string) => q(testId)?.textContent?.trim() ?? '';
  const tabs = () =>
    Array.from(el.querySelectorAll<HTMLElement>('[role="tab"]')).map((tab) =>
      tab.textContent?.trim(),
    );

  function click(testId: string): void {
    q(testId)!.click();
    fixture.detectChanges();
  }

  describe('tabs', () => {
    it('a run workflow has Workflow, Step, Run and Code; a chat workflow no Run', () => {
      open(SEQ);
      expect(tabs()).toEqual(['Workflow', 'Step', 'Run', 'Code']);
      fixture.destroy();
      open(V2);
      expect(tabs()).toEqual(['Workflow', 'Step', 'Code']);
    });

    it('opens on Workflow; a tab is selected with aria-selected and labels its panel', () => {
      open(SEQ);
      const workflowTab = q('workflow-panel-tab-workflow')!;
      expect(workflowTab.getAttribute('aria-selected')).toBe('true');
      expect(q('workflow-panel-tab-code')?.getAttribute('aria-selected')).toBe('false');
      click('workflow-panel-tab-code');
      expect(q('workflow-panel-tab-code')?.getAttribute('aria-selected')).toBe('true');
      const panel = el.querySelector('[role="tabpanel"]')!;
      expect(panel.getAttribute('aria-labelledby')).toBe('workflow-panel-tab-code');
      expect(q('workflow-panel-tab-code')?.getAttribute('aria-controls')).toBe(panel.id);
    });

    it('Left and Right move between the tabs, wrapping', () => {
      open(V2);
      const list = el.querySelector('[role="tablist"]')!;
      q('workflow-panel-tab-workflow')!.focus();
      list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      fixture.detectChanges();
      expect(designer.tab()).toBe('code');
      expect(document.activeElement).toBe(q('workflow-panel-tab-code'));
      list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      fixture.detectChanges();
      expect(designer.tab()).toBe('workflow');
    });
  });

  describe('Workflow tab', () => {
    it("shows a run workflow's name, id, description, trigger, input parameters and output", () => {
      open(SEQ);
      expect(text('workflow-panel-name')).toBe('Sequential test workflow');
      expect(text('workflow-panel-description')).toBe('A three-step example.');
      expect(text('workflow-panel-trigger')).toBe('Runs on an input');
      expect(q('workflow-bar-note')).toBeNull();
      const param = q('workflow-param-text')!;
      expect(param.textContent).toContain('text');
      expect(param.textContent).toContain('Text');
      expect(param.textContent).toContain('textarea');
      expect(param.textContent).toContain('required');
      expect(text('workflow-panel-output')).toBe('summary');
      expect(el.querySelector('#workflow-agents-heading')).toBeNull();
    });

    it('a chat workflow with a typed input lists that input once, not its first step', () => {
      open({
        ...V2,
        input: [
          { name: 'question', label: 'Question', type: 'textarea', required: true },
          { name: 'datasets', label: 'Datasets', type: 'text', required: true },
        ],
      });
      const params = el.querySelectorAll('[data-testid="workflow-param-question"]');
      expect(params.length).toBe(1);
      expect(params[0].textContent).not.toContain('from each chat message');
      expect(el.querySelectorAll('[data-testid="workflow-param-datasets"]').length).toBe(1);
    });

    it('a chat workflow: its trigger, bar note, what it takes from each message, and its agents', () => {
      open(V2);
      expect(text('workflow-panel-trigger')).toBe('Runs in a chat');
      expect(text('workflow-bar-note')).toBe(
        'In a chat, the workflow bar shows these steps as they run.',
      );
      expect(q('workflow-param-question')?.textContent).toContain('from each chat message');
      expect(q('workflow-param-datasets')).not.toBeNull();
      expect(
        Array.from(q('workflow-panel-output')!.querySelectorAll('li')).map((li) =>
          li.textContent?.trim(),
        ),
      ).toEqual(['sqlQueries', 'failedQueries', 'rows']);
      const agent = q('workflow-agent-assistant-v2')!;
      expect(agent.getAttribute('aria-label')).toBe('Open agent Questions to Insights v2');
      expect(agent.textContent).toContain('Official');
      agent.click();
      expect(openedAgents).toEqual(['assistant-v2']);
    });

    it("says the agent's own steps drive the bar for a one-step workflow", () => {
      open({ ...V2, bar: 'agent' });
      expect(text('workflow-bar-note')).toBe(
        "In a chat, the workflow bar shows the agent's own steps as it sets them.",
      );
    });
  });

  describe('Step tab', () => {
    it('asks for a selection when no step is selected', () => {
      open(V2);
      click('workflow-panel-tab-step');
      expect(text('workflow-step-empty')).toBe(NO_STEP_SELECTED);
      expect(NO_STEP_SELECTED).toBe('Select a step in the graph to see its configuration.');
    });

    it("shows the selected agent step's configuration: tools and Max steps", () => {
      open(V2);
      designer.select('analyse');
      fixture.detectChanges();
      expect(q('workflow-panel-tab-step')?.getAttribute('aria-selected')).toBe('true');
      expect(text('workflow-step-heading')).toBe('2. Analyse');
      expect(text('workflow-step-field-id')).toBe('analyse');
      expect(text('workflow-step-field-kind')).toBe('LLM');
      expect(text('workflow-step-field-summary')).toBe('Analyse summary');
      expect(text('workflow-step-field-input')).toBe('question, catalog');
      expect(text('workflow-step-field-output')).toBe('calls, stopped');
      expect(q('workflow-step-field-exits')?.textContent).toContain('Model error');
      expect(q('workflow-step-field-exits')?.textContent).toContain('Stop');
      expect(text('workflow-step-field-agent')).toBe('Questions to Insights v2');
      expect(
        Array.from(q('workflow-step-field-tools')!.querySelectorAll('li')).map((li) =>
          li.textContent?.trim(),
        ),
      ).toEqual(['list_entities', 'describe_entity', 'run_readonly_sql']);
      expect(text('workflow-step-field-max-steps')).toBe('15');
    });

    it('a code step has no agent rows and says None for no exits', () => {
      open(V2);
      designer.select('wrap-up');
      fixture.detectChanges();
      expect(text('workflow-step-field-kind')).toBe('Code');
      expect(text('workflow-step-field-exits')).toBe('None');
      expect(q('workflow-step-field-tools')).toBeNull();
      expect(q('workflow-step-field-max-steps')).toBeNull();
    });
  });

  describe('Code tab', () => {
    it('shows the definition as the API returns it, as pretty JSON, and copies it', async () => {
      open(SEQ);
      click('workflow-panel-tab-code');
      expect(q('workflow-code')?.tagName).toBe('PRE');
      expect(q('workflow-code')?.textContent).toBe(JSON.stringify(SEQ, null, 2));
      const write = spyOn(window.navigator.clipboard, 'writeText').and.resolveTo();
      click('workflow-code-copy');
      expect(write).toHaveBeenCalledWith(JSON.stringify(SEQ, null, 2));
      await write.calls.mostRecent().returnValue;
      fixture.detectChanges();
      expect(text('workflow-code-copy')).toBe('Copied');
    });
  });

  describe('Run tab (workflows R12, R13)', () => {
    function type(value: string): void {
      const field = q('workflow-input-text') as HTMLTextAreaElement;
      field.value = value;
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    function execute(): ReturnType<HttpTestingController['expectOne']> {
      click('workflow-run');
      return http.expectOne(
        (r) => r.method === 'POST' && r.url.endsWith('/workflows/seq-text-demo/runs'),
      );
    }

    function openRun(): void {
      open(SEQ);
      click('workflow-panel-tab-run');
    }

    it('shows the input form and Execute', () => {
      openRun();
      const field = q('workflow-input-text') as HTMLTextAreaElement;
      expect(field.tagName).toBe('TEXTAREA');
      expect(field.placeholder).toBe('Paste or type any text');
      expect(field.getAttribute('aria-required')).toBe('true');
      expect(el.querySelector(`label[for="${field.id}"]`)?.textContent?.trim()).toBe('Text');
      expect(text('workflow-run')).toBe('Execute');
      expect(q('workflow-run-result')).toBeNull();
    });

    it('runs on the typed input, says Executing… meanwhile, then shows each step and the output', () => {
      openRun();
      type('  Hello  ');
      const req = execute();
      expect(req.request.body).toEqual({ input: { text: '  Hello  ' } });
      const button = q('workflow-run') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.textContent?.trim()).toBe('Executing…');
      const result: WorkflowRunResult = {
        workflowId: 'seq-text-demo',
        status: 'success',
        steps: [
          { id: 'clean-text', title: 'Clean text', status: 'success', output: { text: 'Hello' } },
          { id: 'count-words', title: 'Count words', status: 'success', output: { words: 1 } },
          { id: 'format-result', title: 'Format result', status: 'success', output: { summary: 'S' } },
        ],
        output: { summary: '1 word, 5 characters: "Hello"' },
      };
      req.flush(result);
      fixture.detectChanges();
      expect(button.disabled).toBe(false);
      expect(text('workflow-run-status')).toBe('Run succeeded');
      const row = q('workflow-run-step-clean-text')!;
      expect(row.textContent).toContain('Clean text');
      expect(row.textContent).toContain('Done');
      expect(row.querySelector('pre')?.textContent).toBe(
        JSON.stringify({ text: 'Hello' }, null, 2),
      );
      expect(q('workflow-run-output')?.textContent).toContain('1 word, 5 characters: "Hello"');
      expect(designer.stepStatuses()).toEqual({
        'clean-text': 'success',
        'count-words': 'success',
        'format-result': 'success',
      });
    });

    it('shows a failed run: the failing step with its error, the others skipped', () => {
      openRun();
      type('   ');
      execute().flush({
        workflowId: 'seq-text-demo',
        status: 'failed',
        steps: [
          { id: 'clean-text', title: 'Clean text', status: 'failed', error: 'The text is empty' },
          { id: 'count-words', title: 'Count words', status: 'skipped' },
          { id: 'format-result', title: 'Format result', status: 'skipped' },
        ],
        error: 'The text is empty',
      } satisfies WorkflowRunResult);
      fixture.detectChanges();
      expect(text('workflow-run-status')).toBe('Run failed: The text is empty');
      expect(q('workflow-run-step-clean-text')?.textContent).toContain('Failed');
      expect(q('workflow-run-step-clean-text')?.textContent).toContain('The text is empty');
      expect(q('workflow-run-step-count-words')?.textContent).toContain('Skipped');
      expect(q('workflow-run-output')).toBeNull();
    });

    it("shows the server's refusal and keeps no result; running again replaces the result", () => {
      openRun();
      execute().flush(
        { statusCode: 400, message: 'Text is required', error: 'Bad Request' },
        { status: 400, statusText: 'Bad Request' },
      );
      fixture.detectChanges();
      expect(text('workflow-run-error')).toBe('Text is required');
      expect(q('workflow-run-error')?.getAttribute('role')).toBe('alert');
      expect(q('workflow-run-result')).toBeNull();

      type('a');
      execute().flush({ workflowId: 'seq-text-demo', status: 'success', steps: [], output: { summary: 'first' } });
      fixture.detectChanges();
      expect(q('workflow-run-error')).toBeNull();
      execute().flush({ workflowId: 'seq-text-demo', status: 'success', steps: [], output: { summary: 'second' } });
      fixture.detectChanges();
      expect(q('workflow-run-output')?.textContent).toContain('second');
      expect(q('workflow-run-output')?.textContent).not.toContain('first');
    });

    it('keeps the typed input and the result when switching tabs', () => {
      openRun();
      type('kept');
      click('workflow-panel-tab-workflow');
      click('workflow-panel-tab-run');
      expect((q('workflow-input-text') as HTMLTextAreaElement).value).toBe('kept');
    });
  });
});
