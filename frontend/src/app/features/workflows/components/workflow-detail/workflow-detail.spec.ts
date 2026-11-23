import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import {
  ComponentFixture,
  TestBed,
  fakeAsync,
  tick,
} from '@angular/core/testing';
import { WorkflowDetail } from '../../models/workflow.model';
import { WorkflowDesigner } from '../../services/workflow-designer.service';
import { FIXTURE_WORKFLOW } from '../workflow-node-dialog/workflow-node.testing';
import { WORKFLOW_VIEW_STORAGE_KEY } from '../../services/workflow-view';
import { RunDashboardState } from '../../../runs/services/run-dashboard-state';
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
  input: [{ name: 'text', label: 'Text', type: 'textarea', required: true }],
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
  id: 'answer-business-question',
  name: 'Insights Analyst',
  trigger: 'run',
  input: [],
  agents: [{ key: 'insights-analyst', name: 'Insights Analyst' }],
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
    // The kept view is shared browser state. Business is the default (R38);
    // the designer tests start from a kept Builder, as a builder's device would.
    localStorage.setItem(WORKFLOW_VIEW_STORAGE_KEY, 'builder');
  });

  afterEach(() => http.verify());

  function open(workflow: WorkflowDetail): void {
    fixture = TestBed.createComponent(WorkflowDetailPage);
    fixture.componentRef.setInput('workflowId', workflow.id);
    const page = fixture.componentInstance;
    page.back.subscribe(() => events.push('back'));
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Loading user journey…');
    http
      .expectOne((r) =>
        r.url.endsWith(`/workflows/${encodeURIComponent(workflow.id)}`),
      )
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
      'User journeys / Three steps',
    );
    expect(
      nav.querySelector('[aria-current="page"]')?.textContent?.trim(),
    ).toBe('Three steps');
    q('workflow-breadcrumb')!.click();
    expect(events).toEqual(['back']);
    expect(q('workflow-detail-name')?.tagName).toBe('H1');
    // One line: the name is the breadcrumb's current item.
    expect(nav.querySelector('[aria-current="page"] h1')).toBe(
      q('workflow-detail-name'),
    );
    expect(text('workflow-detail-name')).toBe('Three steps');
    expect(text('workflow-detail-id')).toBe('three-steps');
    expect(text('workflow-detail-kind')).toBe('3 steps');
    expect(q('workflow-canvas')).not.toBeNull();
    expect(
      Array.from(
        el.querySelectorAll('[data-testid="workflow-node-title"]'),
      ).map((n) => n.textContent?.trim()),
    ).toEqual(['Clean text', 'Count words', 'Format result']);
  });

  it('Execute workflow on the canvas unfolds the Run panel and asks for its composer; it never runs', () => {
    open(THREE_STEPS);
    expect(q('workflow-start-chat')).toBeNull();
    expect(text('workflow-execute')).toBe('Execute user journey');
    expect(
      el.querySelector('header [data-testid="workflow-execute"]'),
    ).toBeNull();
    designer.stateOpen.set(false);
    designer.setInput('text', 'a b');
    q('workflow-execute')!.click();
    expect(designer.stateOpen()).toBe(true);
    expect(designer.runFormRequest()).toBe(1);
    expect(events).toEqual([]);
    expect(designer.running()).toBe(false);
    expect(designer.runResult()).toBeNull();
  });

  it('Insights Analyst with its input has Execute and no Start chat (workflows R21)', () => {
    open({
      ...V2,
      input: [
        {
          name: 'question',
          label: 'Question',
          type: 'textarea',
          required: true,
        },
        {
          name: 'datasets',
          label: 'Datasets',
          type: 'datasets',
          required: true,
        },
      ],
    });
    http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: [] });
    expect(text('workflow-execute')).toBe('Execute user journey');
    expect(q('workflow-start-chat')).toBeNull();
    q('workflow-execute')!.click();
    expect(designer.runFormRequest()).toBe(1);
    expect(events).toEqual([]);
  });

  it('a node selects it on the canvas; the background clears it', () => {
    open(THREE_STEPS);
    q('workflow-node-count-words')!.click();
    fixture.detectChanges();
    expect(designer.selectedStepId()).toBe('count-words');
    expect(events).toEqual([]);
    expect(q('workflow-node-count-words')?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(q('workflow-ndv')).toBeNull();

    const canvas = q('workflow-canvas')!;
    canvas.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, button: 0 }),
    );
    canvas.dispatchEvent(
      new PointerEvent('pointerup', { bubbles: true, button: 0 }),
    );
    fixture.detectChanges();
    expect(designer.selectedStepId()).toBeNull();
    expect(q('workflow-node-count-words')?.getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(events).toEqual([]);
  });

  it('the Run toggle folds the Chat', () => {
    open(THREE_STEPS);
    expect(text('workflow-state-toggle')).toBe('Run');
    expect(q('workflow-state-toggle')?.getAttribute('aria-expanded')).toBe(
      'true',
    );
    q('workflow-state-toggle')!.click();
    fixture.detectChanges();
    expect(designer.stateOpen()).toBe(false);
    expect(q('workflow-state-toggle')?.getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(q('workflow-run-chat')).toBeNull();
    designer.stateOpen.set(true);
  });

  it('a double click opens the node dialog; Close returns the focus to the node', fakeAsync(() => {
    open(THREE_STEPS);
    q('workflow-node-count-words')!.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    );
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
      .expectOne((r) =>
        r.url.endsWith(`/workflows/${encodeURIComponent(FIXTURE_WORKFLOW.id)}`),
      )
      .flush(FIXTURE_WORKFLOW);
    http.expectOne((r) => r.url.endsWith('/datasets')).flush({ datasets: [] });
    fixture.detectChanges();
    q('workflow-node-start')!.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    );
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
      steps: THREE_STEPS.steps.map((s) => ({
        id: s.id,
        title: s.title,
        status: 'success' as const,
      })),
      datasets: [],
      startedAt: '2026-11-11T10:00:00.000Z',
    });
    fixture.detectChanges();
    expect(
      Array.from(
        el.querySelectorAll('[data-testid="workflow-node-status"]'),
      ).map((n) => n.textContent?.trim()),
    ).toEqual(['Done', 'Done', 'Done', 'Done', 'Done']);
    expect(text('workflow-state-progress')).toBe('5 of 5 nodes ran');
    expect(text('workflow-state-run-id')).toBe('Execution ID run-1');
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
    expect(el.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe(
      'nope',
    );

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

  it('has two zones: the Run panel (Chat) on the left and the canvas, and no Logs or app right panel', () => {
    open(THREE_STEPS);
    const dock = q('workflow-run-dock')!;
    expect(dock.tagName.toLowerCase()).toBe('app-workflow-run-dock');
    expect(dock.querySelector('app-workflow-run-chat')).not.toBeNull();
    // No Logs panel: the canvas has its column to itself.
    expect(q('workflow-logs-dock')).toBeNull();
    const canvas = el.querySelector('app-workflow-canvas') as HTMLElement;
    expect(dock.parentElement).toBe(canvas.parentElement!.parentElement);
    expect(canvas.compareDocumentPosition(dock)).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
    expect(el.querySelector('header')!.classList).toContain('px-6');
    expect('openPanel' in fixture.componentInstance).toBe(false);
  });

  it('opens a query in the sheet beside the Run panel; Escape closes it and the focus returns to what opened it', fakeAsync(() => {
    open(THREE_STEPS);
    designer.run.set({
      id: 'run-1',
      workflowId: 'three-steps',
      workflowName: 'Three steps',
      input: {},
      status: 'success',
      steps: [],
      datasets: [],
      startedAt: '2026-11-15T10:00:00.000Z',
      answer: {
        role: 'assistant',
        content: 'Done',
        at: '2026-11-15T10:00:01.000Z',
        data: [
          {
            tool: 'run_readonly_sql',
            input: 'select 1',
            rowCount: 1,
            rows: [{ n: 1 }],
          },
        ],
      },
    });
    fixture.detectChanges();
    expect(q('query-inspector')).toBeNull();

    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    designer.runDockMaximized.set(true);
    designer.openQuery(0, opener);
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(designer.runDockMaximized()).toBe(false);
    const sheet = q('query-inspector-sheet')!;
    expect(sheet.contains(q('query-inspector'))).toBe(true);
    expect(sheet.parentElement).toBe(
      el.querySelector('app-workflow-canvas')!.parentElement,
    );
    expect(q('query-inspector')!.getAttribute('role')).toBe('dialog');

    q('query-inspector')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    tick();
    expect(q('query-inspector')).toBeNull();
    expect(designer.openQueryIndex()).toBeNull();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  }));

  describe('the Builder and Business views (R38)', () => {
    const pressed = (testId: string) => q(testId)?.getAttribute('aria-pressed');

    const answeredRun = () =>
      designer.run.set({
        id: 'run-1',
        workflowId: 'three-steps',
        workflowName: 'Three steps',
        input: { text: 'a b' },
        status: 'success',
        steps: [],
        datasets: [],
        startedAt: '2026-11-15T10:00:00.000Z',
        answer: {
          role: 'assistant',
          content: 'Two words',
          at: '2026-11-15T10:00:01.000Z',
          data: [
            {
              tool: 'run_readonly_sql',
              input: 'select 1',
              rowCount: 1,
              rows: [{ n: 1 }],
            },
          ],
        },
      });

    it('opens in Business when no view is kept: the View control lists Business first', () => {
      localStorage.removeItem(WORKFLOW_VIEW_STORAGE_KEY);
      open(THREE_STEPS);
      const group = el.querySelector('header [data-testid="workflow-view"]')!;
      expect(group.getAttribute('role')).toBe('group');
      expect(
        el
          .querySelector(`#${group.getAttribute('aria-labelledby')}`)
          ?.textContent?.trim(),
      ).toBe('View');
      expect(
        Array.from(group.querySelectorAll('button')).map((b) =>
          b.textContent?.trim(),
        ),
      ).toEqual(['Business', 'Builder']);
      expect(pressed('workflow-view-business')).toBe('true');
      expect(pressed('workflow-view-builder')).toBe('false');
      expect(q('workflow-canvas')).toBeNull();
      expect(q('workflow-run-dock')).toBeNull();
      const view = q('workflow-business-view')!;
      const chat = view.querySelector('[data-testid="workflow-run-chat"]')!;
      const log = chat.querySelector('[data-testid="workflow-run-chat-log"]')!;
      const composer = chat.querySelector('[data-testid="run-composer"]')!;
      // A chat: the conversation, then the composer at the bottom.
      expect(
        log.compareDocumentPosition(composer) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        chat.querySelector('[data-testid="run-composer-input"]'),
      ).not.toBeNull();
      expect(q('workflow-run-empty')).not.toBeNull();
      // No run yet: nothing to open in Builder.
      expect(q('workflow-run-open-builder')).toBeNull();
    });

    it('Builder shows the canvas and the Run panel, and the view picked is kept', () => {
      localStorage.removeItem(WORKFLOW_VIEW_STORAGE_KEY);
      open(THREE_STEPS);
      q('workflow-view-builder')!.click();
      fixture.detectChanges();
      expect(pressed('workflow-view-builder')).toBe('true');
      expect(pressed('workflow-view-business')).toBe('false');
      expect(q('workflow-canvas')).not.toBeNull();
      expect(q('workflow-run-dock')).not.toBeNull();
      expect(q('workflow-business-view')).toBeNull();
      expect(localStorage.getItem(WORKFLOW_VIEW_STORAGE_KEY)).toBe('builder');

      // Another workflow page opens in the kept view; Business brings the form back.
      fixture.destroy();
      open(THREE_STEPS);
      expect(pressed('workflow-view-builder')).toBe('true');
      q('workflow-view-business')!.click();
      fixture.detectChanges();
      expect(q('workflow-business-view')).not.toBeNull();
      expect(localStorage.getItem(WORKFLOW_VIEW_STORAGE_KEY)).toBe('business');
    });

    it("Business shows the answer and the agents' thread but not How it ran; a query still opens in the sheet", fakeAsync(() => {
      localStorage.setItem(WORKFLOW_VIEW_STORAGE_KEY, 'business');
      open(THREE_STEPS);
      answeredRun();
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      const view = q('workflow-business-view')!;
      expect(
        view.querySelector('[data-testid="run-answer"]')?.textContent,
      ).toContain('Two words');
      expect(view.querySelector('app-workflow-run-team')).not.toBeNull();
      expect(view.querySelector('app-workflow-run-story')).toBeNull();
      expect(text('workflow-run-open-builder')).toBe('Open in Builder');
      // The id to quote when reporting the run, as in Builder's Run panel.
      expect(text('workflow-run-execution-id')).toContain('Execution ID run-1');

      designer.openQuery(0, null);
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      const sheet = q('query-inspector-sheet')!;
      expect(sheet.contains(q('query-inspector'))).toBe(true);
      expect(sheet.parentElement).toBe(view.parentElement);
      designer.closeQuery();
      fixture.detectChanges();
    }));

    it('Open in Builder shows the same run in Builder and keeps Builder; a step opens its dialog there', () => {
      localStorage.setItem(WORKFLOW_VIEW_STORAGE_KEY, 'business');
      open(THREE_STEPS);
      answeredRun();
      fixture.detectChanges();
      q('workflow-run-open-builder')!.click();
      fixture.detectChanges();
      expect(pressed('workflow-view-builder')).toBe('true');
      expect(q('workflow-canvas')).not.toBeNull();
      expect(
        q('workflow-run-dock')!.querySelector('[data-testid="run-answer"]')
          ?.textContent,
      ).toContain('Two words');
      expect(localStorage.getItem(WORKFLOW_VIEW_STORAGE_KEY)).toBe('builder');

      // An agent's See its data in the Business view: Builder, with that step's dialog.
      fixture.componentInstance.setView('business');
      fixture.detectChanges();
      fixture.componentInstance.openInBuilder('count-words');
      expect(fixture.componentInstance.view()).toBe('builder');
      expect(designer.openNodeId()).toBe('count-words');
      designer.closeNode();
    });

    it('Business reads a follow-up as one conversation, with a navigation over its questions', fakeAsync(() => {
      localStorage.setItem(WORKFLOW_VIEW_STORAGE_KEY, 'business');
      open(THREE_STEPS);
      designer.run.set({
        id: 'run-2',
        workflowId: 'three-steps',
        workflowName: 'Three steps',
        input: { text: 'And per word?' },
        context: { fromRunId: 'run-1' },
        status: 'success',
        steps: [],
        datasets: [],
        startedAt: '2026-11-15T10:01:00.000Z',
        question: 'And per word?',
        answer: {
          role: 'assistant',
          content: 'One each',
          at: '2026-11-15T10:01:01.000Z',
        },
      });
      fixture.detectChanges();
      tick();
      http
        .expectOne((r) => r.url.endsWith('/workflow-runs/run-1'))
        .flush({
          id: 'run-1',
          workflowId: 'three-steps',
          workflowName: 'Three steps',
          input: { text: 'a b' },
          status: 'success',
          steps: [],
          datasets: [],
          startedAt: '2026-11-15T10:00:00.000Z',
          question: 'How many words?',
          answer: {
            role: 'assistant',
            content: 'Two words',
            at: '2026-11-15T10:00:01.000Z',
            data: [
              {
                tool: 'run_readonly_sql',
                input: 'select 2',
                rowCount: 1,
                rows: [{ n: 2 }],
              },
            ],
          },
        });
      fixture.detectChanges();
      tick();
      fixture.detectChanges();

      const view = q('workflow-business-view')!;
      const turn = view.querySelector('[data-testid="workflow-turn"]')!;
      expect(turn.getAttribute('data-history-id')).toBe('run-1');
      expect(
        turn
          .querySelector('[data-testid="workflow-turn-question"]')
          ?.textContent?.trim(),
      ).toBe('How many words?');
      expect(turn.textContent).toContain('Two words');
      // The thread replaces the Follows up on line.
      expect(q('workflow-run-context')).toBeNull();
      expect(
        Array.from(
          view.querySelectorAll('[data-testid^="workflow-conversation-item-"]'),
        ).map((b) => b.textContent?.trim()),
      ).toEqual(['How many words?', 'And per word?']);

      // An earlier figure opens the query of its own run.
      const earlier = designer.run();
      designer.openQuery(0, null, {
        ...earlier!,
        id: 'run-1',
        answer: {
          role: 'assistant',
          content: 'Two words',
          at: '',
          data: [
            {
              tool: 'run_readonly_sql',
              input: 'select 2',
              rowCount: 1,
              rows: [{ n: 2 }],
            },
          ],
        },
      });
      fixture.detectChanges();
      tick();
      fixture.detectChanges();
      expect(q('query-inspector-sheet')).not.toBeNull();
      expect(designer.queryRun()?.id).toBe('run-1');
      designer.closeQuery();
      fixture.detectChanges();
      expect(designer.queryRun()).toBeNull();
    }));

    it('an unknown kept value opens in Business', () => {
      localStorage.setItem(WORKFLOW_VIEW_STORAGE_KEY, 'reports');
      open(THREE_STEPS);
      expect(pressed('workflow-view-business')).toBe('true');
      expect(q('workflow-canvas')).toBeNull();
    });
  });

  describe('the dashboard beside the chat (dashboard-panel)', () => {
    const DASHBOARD = {
      artifactId: 'a-1',
      version: 1,
      title: 'Penetration by client',
      action: 'created' as const,
      widgetCount: 11,
      filterCount: 5,
      rowCount: 418,
      saved: false,
    };
    const runWith = (id: string, version: number) =>
      designer.run.set({
        id,
        workflowId: 'three-steps',
        workflowName: 'Three steps',
        input: { text: 'a' },
        status: 'success',
        steps: [],
        datasets: [],
        startedAt: '2026-11-22T10:00:00.000Z',
        answer: {
          role: 'assistant',
          content: 'I built the dashboard.',
          at: '2026-11-22T10:00:01.000Z',
          dashboard: { ...DASHBOARD, version },
        },
      });
    const loadDashboard = async (version: number) => {
      const req = http.expectOne((r) => r.url.endsWith('/artifacts/a-1'));
      expect(req.request.params.get('version')).toBe(String(version));
      req.flush({
        id: 'a-1',
        kind: 'dashboard',
        name: 'Penetration by client',
        description: '',
        widgetCount: 11,
        filterCount: 5,
        hasImage: false,
        createdAt: '2026-11-22T10:00:00.000Z',
        updatedAt: '2026-11-22T10:00:00.000Z',
        blueprint: {},
        document: `<html>v${version}</html>`,
        version,
        status: 'draft',
        savedVersions: [],
        versions: [
          {
            version,
            createdAt: '2026-11-22T10:00:00.000Z',
            widgetCount: 11,
            filterCount: 5,
            rowCount: 418,
            saved: false,
          },
        ],
      });
      fixture.detectChanges();
      // The panel is deferred (@defer): wait for it to render.
      await fixture.whenStable();
      fixture.detectChanges();
    };

    it('Business: a run that ends with a dashboard opens it beside the chat, never over it', async () => {
      localStorage.setItem(WORKFLOW_VIEW_STORAGE_KEY, 'business');
      open(THREE_STEPS);
      expect(q('run-dashboard-panel')).toBeNull();
      runWith('run-1', 1);
      fixture.detectChanges();
      await loadDashboard(1);
      const panel = el.querySelector('app-run-dashboard-panel') as HTMLElement;
      const chatColumn = q('workflow-business-view')!;
      // Siblings in one flex row: the chat column narrows, the panel follows it.
      expect(panel.parentElement).toBe(chatColumn.parentElement);
      expect(chatColumn.compareDocumentPosition(panel)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(getComputedStyle(panel.parentElement!).display).toBe('flex');
      expect(getComputedStyle(panel).position).toBe('static');
      expect(chatColumn.classList).toContain('min-w-0');
      expect(text('run-dashboard-panel-status')).toBe('Draft');
      // At a 1200 px content width the panel takes 640 px and the chat the
      // rest, side by side with no overlap.
      Object.assign(el.style, { width: '1200px', height: '700px' });
      const chat = chatColumn.getBoundingClientRect();
      const side = panel.getBoundingClientRect();
      expect(Math.round(side.width)).toBe(640);
      expect(chat.width).toBeGreaterThanOrEqual(520);
      expect(side.left).toBeGreaterThanOrEqual(chat.right - 0.5);
      // Narrower: the chat keeps 520 px, the panel gives way.
      el.style.width = '1000px';
      expect(Math.round(panel.getBoundingClientRect().width)).toBe(480);
      expect(
        Math.round(chatColumn.getBoundingClientRect().width),
      ).toBeGreaterThanOrEqual(520);
    });

    it('a later run with a newer version updates the panel and reopens it once closed', async () => {
      localStorage.setItem(WORKFLOW_VIEW_STORAGE_KEY, 'business');
      open(THREE_STEPS);
      runWith('run-1', 1);
      fixture.detectChanges();
      await loadDashboard(1);
      q('run-dashboard-close')!.click();
      fixture.detectChanges();
      expect(q('run-dashboard-panel')).toBeNull();
      // The same run shown again: the closed panel stays closed.
      runWith('run-1', 1);
      fixture.detectChanges();
      expect(q('run-dashboard-panel')).toBeNull();
      runWith('run-2', 2);
      fixture.detectChanges();
      await loadDashboard(2);
      expect(text('run-dashboard-panel-meta')).toContain('Version 2');
    });

    it('Builder: the panel docks on the right edge beside the canvas, after the Run panel', async () => {
      open(THREE_STEPS);
      runWith('run-1', 1);
      fixture.detectChanges();
      await loadDashboard(1);
      const panel = el.querySelector('app-run-dashboard-panel') as HTMLElement;
      const dock = q('workflow-run-dock')!;
      const canvasColumn = el.querySelector('app-workflow-canvas')!
        .parentElement as HTMLElement;
      expect(panel.parentElement).toBe(dock.parentElement);
      expect(panel.parentElement).toBe(canvasColumn.parentElement);
      expect(canvasColumn.compareDocumentPosition(panel)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });

    it('leaving the page closes the panel', async () => {
      open(THREE_STEPS);
      runWith('run-1', 1);
      fixture.detectChanges();
      await loadDashboard(1);
      fixture.destroy();
      expect(TestBed.inject(RunDashboardState).shown()).toBeNull();
    });
  });
});
