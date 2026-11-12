import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkflowDetail } from '../../models/workflow.model';
import { WorkflowDesigner } from '../../services/workflow-designer.service';
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
    { name: 'text', label: 'Text', type: 'textarea', required: true },
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

describe('WorkflowDetailPage, the designer page (workflows R6, R7, R12; ui.md 4.4b)', () => {
  let fixture: ComponentFixture<WorkflowDetailPage>;
  let http: HttpTestingController;
  let designer: WorkflowDesigner;
  let el: HTMLElement;
  let events: string[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorkflowDetailPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    designer = TestBed.inject(WorkflowDesigner);
    events = [];
  });

  afterEach(() => http.verify());

  function open(workflow: WorkflowDetail): void {
    fixture = TestBed.createComponent(WorkflowDetailPage);
    fixture.componentRef.setInput('workflowId', workflow.id);
    const page = fixture.componentInstance;
    page.back.subscribe(() => events.push('back'));
    page.openPanel.subscribe(() => events.push('openPanel'));
    page.startChat.subscribe((w) => events.push(`startChat:${w.id}`));
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Loading workflow…');
    http
      .expectOne((r) => r.url.endsWith(`/workflows/${workflow.id}`))
      .flush(workflow);
    fixture.detectChanges();
  }

  const q = (testId: string) =>
    el.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  const text = (testId: string) => q(testId)?.textContent?.trim() ?? '';

  it('shows the breadcrumb, the name as h1, the id and kind, and the canvas', () => {
    open(SEQ);
    const nav = el.querySelector('nav[aria-label="Breadcrumb"]')!;
    expect(nav.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Workflows / Sequential test workflow',
    );
    expect(nav.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe(
      'Sequential test workflow',
    );
    q('workflow-breadcrumb')!.click();
    expect(events).toEqual(['back']);
    expect(q('workflow-detail-name')?.tagName).toBe('H1');
    expect(text('workflow-detail-name')).toBe('Sequential test workflow');
    expect(text('workflow-detail-id')).toBe('seq-text-demo');
    expect(text('workflow-detail-kind')).toBe('Runs on an input');
    expect(q('workflow-canvas')).not.toBeNull();
    expect(
      Array.from(el.querySelectorAll('[data-testid="workflow-node-title"]')).map((n) =>
        n.textContent?.trim(),
      ),
    ).toEqual(['Clean text', 'Count words', 'Format result']);
  });

  it('a run workflow has Execute, which asks for the panel on Run; no Start chat', () => {
    open(SEQ);
    expect(q('workflow-start-chat')).toBeNull();
    expect(text('workflow-execute')).toBe('Execute');
    q('workflow-execute')!.click();
    expect(designer.tab()).toBe('run');
    expect(events).toEqual(['openPanel']);
  });

  it('a chat workflow keeps Start chat and has no Execute', () => {
    open(V2);
    expect(q('workflow-execute')).toBeNull();
    q('workflow-start-chat')!.click();
    expect(events).toEqual(['startChat:qti-v2-turn']);
  });

  it('writes the chat requirement beside a disabled Start chat', () => {
    open({ ...V2, chatRequirement: 'Load the sample first' });
    const start = q('workflow-start-chat') as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(start.title).toBe('Load the sample first');
    expect(text('workflow-chat-requirement')).toBe('Load the sample first');
  });

  it('a node selects its step and asks for the panel on Step; the background clears it', () => {
    open(SEQ);
    q('workflow-node-count-words')!.click();
    fixture.detectChanges();
    expect(designer.selectedStepId()).toBe('count-words');
    expect(designer.tab()).toBe('step');
    expect(events).toEqual(['openPanel']);
    expect(q('workflow-node-count-words')?.getAttribute('aria-pressed')).toBe('true');

    const canvas = q('workflow-canvas')!;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    fixture.detectChanges();
    expect(designer.selectedStepId()).toBeNull();
    expect(q('workflow-node-count-words')?.getAttribute('aria-pressed')).toBe('false');
    expect(events).toEqual(['openPanel']);
  });

  it('shows the run status on the canvas nodes while a run is shown', () => {
    open(SEQ);
    designer.runResult.set({
      workflowId: 'seq-text-demo',
      status: 'success',
      steps: SEQ.steps.map((s) => ({ id: s.id, title: s.title, status: 'success' })),
    });
    fixture.detectChanges();
    expect(
      Array.from(el.querySelectorAll('[data-testid="workflow-node-status"]')).map((n) =>
        n.textContent?.trim(),
      ),
    ).toEqual(['Done', 'Done', 'Done']);
  });

  it("shows the server's error, and leaving the page discards the workflow and its run", () => {
    fixture = TestBed.createComponent(WorkflowDetailPage);
    fixture.componentRef.setInput('workflowId', 'nope');
    fixture.detectChanges();
    http
      .expectOne((r) => r.url.endsWith('/workflows/nope'))
      .flush(
        { statusCode: 404, message: 'Workflow "nope" not found' },
        { status: 404, statusText: 'Not Found' },
      );
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Workflow "nope" not found');
    expect(el.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe('nope');

    fixture.destroy();
    open(SEQ);
    designer.select('clean-text');
    designer.setInput('text', 'x');
    fixture.destroy();
    expect(designer.workflow()).toBeNull();
    expect(designer.selectedStepId()).toBeNull();
    expect(designer.inputValues()).toEqual({});
    expect(designer.tab()).toBe('workflow');
  });

  it('leaves room for the Expand button when the right panel is closed', () => {
    open(SEQ);
    const header = el.querySelector('header')!;
    expect(header.classList).toContain('pr-6');
    fixture.componentRef.setInput('panelOpen', false);
    fixture.detectChanges();
    expect(header.classList).toContain('pr-14');
  });
});
