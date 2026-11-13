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

const THREE_STEPS: WorkflowDetail = {
  id: 'three-steps',
  name: 'Three steps',
  description: 'A three-step example.',
  kind: 'code',
  owner: 'Official',
  agents: [],
  stepCount: 3,
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
  ...THREE_STEPS,
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
    open(THREE_STEPS);
    const nav = el.querySelector('nav[aria-label="Breadcrumb"]')!;
    expect(nav.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Workflows / Three steps',
    );
    expect(nav.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe(
      'Three steps',
    );
    q('workflow-breadcrumb')!.click();
    expect(events).toEqual(['back']);
    expect(q('workflow-detail-name')?.tagName).toBe('H1');
    expect(text('workflow-detail-name')).toBe('Three steps');
    expect(text('workflow-detail-id')).toBe('three-steps');
    expect(text('workflow-detail-kind')).toBe('3 steps');
    expect(q('workflow-canvas')).not.toBeNull();
    expect(
      Array.from(el.querySelectorAll('[data-testid="workflow-node-title"]')).map((n) =>
        n.textContent?.trim(),
      ),
    ).toEqual(['Clean text', 'Count words', 'Format result']);
  });

  it('Execute workflow on the canvas unfolds the Run panel and asks for its composer; it never runs', () => {
    open(THREE_STEPS);
    expect(q('workflow-start-chat')).toBeNull();
    expect(text('workflow-execute')).toBe('Execute workflow');
    expect(el.querySelector('header [data-testid="workflow-execute"]')).toBeNull();
    designer.stateOpen.set(false);
    designer.setInput('text', 'a b');
    q('workflow-execute')!.click();
    expect(designer.stateOpen()).toBe(true);
    expect(designer.runFormRequest()).toBe(1);
    expect(events).toEqual([]);
    expect(designer.running()).toBe(false);
    expect(designer.runResult()).toBeNull();
  });

  it('Questions to Insights v2 with its input has Execute and no Start chat (workflows R21)', () => {
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
    expect(events).toEqual([]);
  });

  it('a node selects it on the canvas and in the Logs; the background clears it', () => {
    open(THREE_STEPS);
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

  it('a Logs row selects its node; the Run toggle folds the panel to its header', () => {
    open(THREE_STEPS);
    q('workflow-state-node-clean-text')!.click();
    fixture.detectChanges();
    expect(designer.selectedStepId()).toBe('clean-text');
    expect(q('workflow-node-clean-text')?.getAttribute('aria-pressed')).toBe('true');
    expect(text('workflow-state-toggle')).toBe('Run');
    expect(q('workflow-state-toggle')?.getAttribute('aria-expanded')).toBe('true');
    q('workflow-state-toggle')!.click();
    fixture.detectChanges();
    expect(designer.stateOpen()).toBe(false);
    expect(q('workflow-state-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(q('workflow-state-node-all')).toBeNull();
    designer.stateOpen.set(true);
  });

  it('a double click opens the node dialog; Close returns the focus to the node', fakeAsync(() => {
    open(THREE_STEPS);
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
    open(THREE_STEPS);
    designer.run.set({
      id: 'run-1',
      workflowId: 'three-steps',
      workflowName: 'Three steps',
      input: { text: 'a' },
      status: 'success',
      steps: THREE_STEPS.steps.map((s) => ({ id: s.id, title: s.title, status: 'success' as const })),
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
    open(THREE_STEPS);
    designer.openNode('clean-text');
    designer.setInput('text', 'x');
    fixture.destroy();
    expect(designer.workflow()).toBeNull();
    expect(designer.selectedStepId()).toBeNull();
    expect(designer.openNodeId()).toBeNull();
    expect(designer.inputValues()).toEqual({});
  });

  it('has the Run panel on the right of the canvas and no app right panel to open or make room for', () => {
    open(THREE_STEPS);
    const dock = q('workflow-run-dock')!;
    expect(dock.tagName.toLowerCase()).toBe('app-workflow-run-dock');
    expect(dock.querySelector('app-workflow-run-chat')).not.toBeNull();
    expect(dock.querySelector('app-workflow-state-panel')).not.toBeNull();
    expect(q('workflow-canvas')!.compareDocumentPosition(dock)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(el.querySelector('header')!.classList).toContain('px-6');
    expect('openPanel' in fixture.componentInstance).toBe(false);
  });
});
