import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkflowDetail, WorkflowRunResult } from '../../models/workflow.model';
import { WorkflowDetailPage } from './workflow-detail';

const STEP = (id: string, title: string) => ({
  id,
  title,
  kind: 'code' as const,
  summary: `${title} summary`,
  input: ['text'],
  output: ['text'],
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
    STEP('clean-text', 'Clean text'),
    STEP('count-words', 'Count words'),
    STEP('format-result', 'Format result'),
  ],
};

const V2: WorkflowDetail = {
  ...SEQ,
  id: 'qti-v2-turn',
  name: 'Questions to Insights v2',
  trigger: 'chat',
  input: [],
  agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
  picksDatasets: true,
};

describe('WorkflowDetailPage, a run workflow (workflows R12, R13; ui.md 4.4b)', () => {
  let fixture: ComponentFixture<WorkflowDetailPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowDetailPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function open(workflow: WorkflowDetail): void {
    fixture = TestBed.createComponent(WorkflowDetailPage);
    fixture.componentRef.setInput('workflowId', workflow.id);
    fixture.detectChanges();
    http
      .expectOne((r) => r.url.endsWith(`/workflows/${workflow.id}`))
      .flush(workflow);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const q = (testId: string) =>
    el.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;

  function type(text: string): void {
    const field = q('workflow-input-text') as HTMLTextAreaElement;
    field.value = text;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function run(): ReturnType<HttpTestingController['expectOne']> {
    q('workflow-run')!.click();
    fixture.detectChanges();
    return http.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/workflows/seq-text-demo/runs'),
    );
  }

  it('shows the input form and Run instead of Start chat, with no bar note or Agents', () => {
    open(SEQ);
    expect(q('workflow-detail-kind')?.textContent?.trim()).toBe(
      'Runs on an input',
    );
    expect(q('workflow-start-chat')).toBeNull();
    expect(q('workflow-bar-note')).toBeNull();
    expect(el.querySelector('#workflow-agents-heading')).toBeNull();
    const field = q('workflow-input-text') as HTMLTextAreaElement;
    expect(field.tagName).toBe('TEXTAREA');
    expect(field.placeholder).toBe('Paste or type any text');
    expect(field.getAttribute('aria-required')).toBe('true');
    const label = el.querySelector(`label[for="${field.id}"]`);
    expect(label?.textContent?.trim()).toBe('Text');
    expect(q('workflow-run')?.textContent?.trim()).toBe('Run');
    expect(q('workflow-run-result')).toBeNull();
  });

  it('runs on the typed input, says Running… meanwhile, then shows each step and the output', () => {
    open(SEQ);
    type('  Hello  ');
    const req = run();
    expect(req.request.body).toEqual({ input: { text: '  Hello  ' } });
    const button = q('workflow-run') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent?.trim()).toBe('Running…');
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
    expect(q('workflow-run-status')?.textContent?.trim()).toBe('Run succeeded');
    const row = q('workflow-run-step-clean-text')!;
    expect(row.textContent).toContain('1');
    expect(row.textContent).toContain('Clean text');
    expect(row.textContent).toContain('Done');
    expect(row.querySelector('pre')?.textContent).toBe(
      JSON.stringify({ text: 'Hello' }, null, 2),
    );
    expect(q('workflow-run-output')?.textContent).toContain(
      '1 word, 5 characters: "Hello"',
    );
  });

  it('shows a failed run: the failing step with its error, the others skipped', () => {
    open(SEQ);
    type('   ');
    run().flush({
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
    expect(q('workflow-run-status')?.textContent?.trim()).toBe(
      'Run failed: The text is empty',
    );
    expect(q('workflow-run-step-clean-text')?.textContent).toContain('Failed');
    expect(q('workflow-run-step-clean-text')?.textContent).toContain(
      'The text is empty',
    );
    expect(q('workflow-run-step-count-words')?.textContent).toContain('Skipped');
    expect(q('workflow-run-output')).toBeNull();
  });

  it("shows the server's refusal and keeps no result; running again replaces the result", () => {
    open(SEQ);
    run().flush(
      { statusCode: 400, message: 'Text is required', error: 'Bad Request' },
      { status: 400, statusText: 'Bad Request' },
    );
    fixture.detectChanges();
    expect(q('workflow-run-error')?.textContent?.trim()).toBe('Text is required');
    expect(q('workflow-run-error')?.getAttribute('role')).toBe('alert');
    expect(q('workflow-run-result')).toBeNull();

    type('a');
    run().flush({
      workflowId: 'seq-text-demo',
      status: 'success',
      steps: [],
      output: { summary: 'first' },
    });
    fixture.detectChanges();
    expect(q('workflow-run-error')).toBeNull();
    run().flush({
      workflowId: 'seq-text-demo',
      status: 'success',
      steps: [],
      output: { summary: 'second' },
    });
    fixture.detectChanges();
    expect(q('workflow-run-output')?.textContent).toContain('second');
    expect(q('workflow-run-output')?.textContent).not.toContain('first');
  });

  it('a chat workflow keeps Start chat and shows no input form', () => {
    open(V2);
    expect(q('workflow-start-chat')).not.toBeNull();
    expect(q('workflow-run')).toBeNull();
    expect(q('workflow-bar-note')).not.toBeNull();
  });
});
