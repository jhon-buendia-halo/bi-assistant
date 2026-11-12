import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { WorkflowDetail } from '../../models/workflow.model';
import { WorkflowDesigner } from '../../services/workflow-designer.service';
import { FIXTURE_WORKFLOW } from '../workflow-node-dialog/workflow-node.testing';
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
  trigger: 'run',
  input: [],
  agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
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
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Loading workflow…');
    http
      .expectOne((r) => r.url.endsWith(`/workflows/${encodeURIComponent(workflow.id)}`))
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
    expect(text('workflow-detail-kind')).toBe('3 steps');
    expect(q('workflow-canvas')).not.toBeNull();
    expect(
      Array.from(el.querySelectorAll('[data-testid="workflow-node-title"]')).map((n) =>
        n.textContent?.trim(),
      ),
    ).toEqual(['Clean text', 'Count words', 'Format result']);
  });

  it('Execute workflow on the canvas opens the panel and asks for its run form; it never runs', () => {
    open(SEQ);
    expect(q('workflow-start-chat')).toBeNull();
    expect(text('workflow-execute')).toBe('Execute workflow');
    expect(el.querySelector('header [data-testid="workflow-execute"]')).toBeNull();
    designer.setInput('text', 'a b');
    q('workflow-execute')!.click();
    expect(designer.runFormRequest()).toBe(1);
    expect(events).toEqual(['openPanel']);
    expect(designer.running()).toBe(false);
    expect(designer.runResult()).toBeNull();
  });

  it('an agent workflow with an input has Execute and no Start chat (workflows R21)', () => {
    open({
      ...V2,
      input: [
        { name: 'question', label: 'Question', type: 'textarea', required: true },
        { name: 'datasets', label: 'Datasets', type: 'datasets', required: true },
      ],
    });
    http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: [] });
    expect(text('workflow-execute')).toBe('Execute workflow');
    expect(q('workflow-start-chat')).toBeNull();
    q('workflow-execute')!.click();
    expect(designer.runFormRequest()).toBe(1);
    expect(events).toEqual(['openPanel']);
  });

  it('the Data Readiness Agent has Execute workflow (every agent workflow runs from its page)', () => {
    open({
      ...V2,
      id: 'agent:data-readiness',
      input: [{ name: 'question', label: 'Question', type: 'textarea', required: false }],
    });
    expect(text('workflow-execute')).toBe('Execute workflow');
  });

  it('the RFP Builder has Execute: one exchange per run (plan 4.3)', () => {
    open({
      ...V2,
      id: 'agent:rfp',
      input: [
        { name: 'message', label: 'Message', type: 'textarea', required: true },
        { name: 'rfpId', label: 'RFP', type: 'text', required: false, hidden: true },
      ],
    });
    expect(text('workflow-execute')).toBe('Execute workflow');
  });

  it('a node selects it on the canvas and in the Workflow state panel; the background clears it', () => {
    open(SEQ);
    q('workflow-node-count-words')!.click();
    fixture.detectChanges();
    expect(designer.selectedStepId()).toBe('count-words');
    expect(events).toEqual([]);
    expect(q('workflow-node-count-words')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('workflow-state-node-count-words')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('workflow-ndv')).toBeNull();

    const canvas = q('workflow-canvas')!;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    fixture.detectChanges();
    expect(designer.selectedStepId()).toBeNull();
    expect(q('workflow-node-count-words')?.getAttribute('aria-pressed')).toBe('false');
    expect(q('workflow-state-node-all')?.getAttribute('aria-pressed')).toBe('true');
    expect(events).toEqual([]);
  });

  it('a state panel row selects its node; the toggle collapses the panel', () => {
    open(SEQ);
    q('workflow-state-node-clean-text')!.click();
    fixture.detectChanges();
    expect(designer.selectedStepId()).toBe('clean-text');
    expect(q('workflow-node-clean-text')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('workflow-state-toggle')?.getAttribute('aria-expanded')).toBe('true');
    q('workflow-state-toggle')!.click();
    fixture.detectChanges();
    expect(designer.stateOpen()).toBe(false);
    expect(q('workflow-state-toggle')?.getAttribute('aria-expanded')).toBe('false');
    designer.stateOpen.set(true);
  });

  it('a double click opens the node dialog; Close returns the focus to the node', fakeAsync(() => {
    open(SEQ);
    q('workflow-node-count-words')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    fixture.detectChanges();
    expect(designer.openNodeId()).toBe('count-words');
    expect(q('workflow-ndv')?.getAttribute('role')).toBe('dialog');
    expect(text('workflow-ndv-title')).toBe('Count words');
    q('workflow-ndv-close')!.click();
    fixture.detectChanges();
    tick();
    expect(q('workflow-ndv')).toBeNull();
    expect(designer.openNodeId()).toBeNull();
    expect(document.activeElement).toBe(q('workflow-node-count-words'));
  }));

  it('Start opens its dialog; an agent link there closes it and asks for the agent page (R8)', () => {
    const agentKeys: string[] = [];
    fixture = TestBed.createComponent(WorkflowDetailPage);
    fixture.componentRef.setInput('workflowId', FIXTURE_WORKFLOW.id);
    fixture.componentInstance.openAgent.subscribe((key) => agentKeys.push(key));
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    http
      .expectOne((r) => r.url.endsWith(`/workflows/${encodeURIComponent(FIXTURE_WORKFLOW.id)}`))
      .flush(FIXTURE_WORKFLOW);
    http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: [] });
    fixture.detectChanges();
    q('workflow-node-start')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    fixture.detectChanges();
    expect(text('workflow-ndv-title')).toBe('Start');
    q('workflow-agent-qti')!.click();
    fixture.detectChanges();
    expect(agentKeys).toEqual(['qti']);
    expect(q('workflow-ndv')).toBeNull();
  });

  it('shows the run status on the canvas nodes while a run is shown', () => {
    open(SEQ);
    designer.run.set({
      id: 'run-1',
      workflowId: 'seq-text-demo',
      workflowName: 'Sequential test workflow',
      input: { text: 'a' },
      status: 'success',
      steps: SEQ.steps.map((s) => ({ id: s.id, title: s.title, status: 'success' as const })),
      datasets: [],
      startedAt: '2026-11-11T10:00:00.000Z',
    });
    fixture.detectChanges();
    expect(
      Array.from(el.querySelectorAll('[data-testid="workflow-node-status"]')).map((n) =>
        n.textContent?.trim(),
      ),
    ).toEqual(['Done', 'Done', 'Done', 'Done', 'Done']);
    expect(text('workflow-state-progress')).toBe('5 of 5 nodes ran');
    expect(text('workflow-state-run-id')).toBe('run-1');
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
    designer.openNode('clean-text');
    designer.setInput('text', 'x');
    fixture.destroy();
    expect(designer.workflow()).toBeNull();
    expect(designer.selectedStepId()).toBeNull();
    expect(designer.openNodeId()).toBeNull();
    expect(designer.inputValues()).toEqual({});
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
