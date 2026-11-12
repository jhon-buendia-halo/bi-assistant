import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { App } from '../../../../app';
import { ShellState } from '../../../../core/shell/shell-state';
import { ComposerState } from '../../../../features/sessions/services/composer-state';
import { SessionsState } from '../../../../features/sessions/services/sessions-state';
import { WorkflowsNavState } from '../../../../features/workflows/services/workflows-nav-state';

const shellState = () => TestBed.inject(ShellState);
const composerState = () => TestBed.inject(ComposerState);
const sessionsState = () => TestBed.inject(SessionsState);
const workflowsNav = () => TestBed.inject(WorkflowsNavState);

describe('Workflows area (workflows R5-R8, app-shell R3)', () => {
  beforeEach(async () => {
    localStorage.removeItem('questions-to-insights:right-panel-width');
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  const summary = {
    description: '',
    kind: 'agent' as const,
    owner: 'Official' as const,
    stepCount: 1,
    bar: 'agent' as const,
    trigger: 'chat' as const,
    input: [],
    datasets: [] as string[],
    missingDatasets: [] as string[],
    starterQuestions: [] as string[],
  };
  const assistant = {
    ...summary,
    id: 'agent:assistant',
    name: 'Assistant',
    agents: [{ key: 'assistant', name: 'Questions to Insights Assistant' }],
    picksDatasets: true,
  };
  const v2 = {
    ...summary,
    id: 'qti-v2-turn',
    name: 'Questions to Insights v2',
    kind: 'code' as const,
    stepCount: 4,
    bar: 'steps' as const,
    agents: [{ key: 'assistant-v2', name: 'Questions to Insights v2' }],
    picksDatasets: true,
  };
  const health = {
    ...summary,
    id: 'agent:u-1',
    name: 'Health plan analyst',
    owner: 'You' as const,
    agents: [{ key: 'u-1', name: 'Health plan analyst' }],
    picksDatasets: false,
    datasets: ['World Cup Core'],
  };

  function setup() {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    return {
      fixture,
      app: fixture.componentInstance,
      http: TestBed.inject(HttpTestingController),
      el: fixture.nativeElement as HTMLElement,
    };
  }

  it('keeps Workflows current on a workflow page, and the rail returns to the list', () => {
    const { app, fixture, el } = setup();
    shellState().selectArea('workflows');
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('workflows');
    expect(el.querySelector('[data-testid="workflows-page"]')).toBeTruthy();
    workflowsNav().openWorkflow('agent:rfp');
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('workflow-detail');
    expect(workflowsNav().activeWorkflowId()).toBe('agent:rfp');
    expect(shellState().currentArea()).toBe('workflows');
    expect(
      el
        .querySelector('button[aria-label="Workflows"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
    shellState().selectArea('workflows');
    expect(shellState().mainView()).toBe('workflows');
  });

  it('opens a workflow page with the right panel open on its configuration (ui.md 4.4b)', async () => {
    const { app, fixture, el } = setup();
    expect(shellState().rightPanelOpen()).toBe(false);
    workflowsNav().openWorkflow('qti-v2-turn');
    fixture.detectChanges();
    // Both are deferred blocks.
    await fixture.whenStable();
    fixture.detectChanges();
    expect(shellState().rightPanelOpen()).toBe(true);
    const panel = el.querySelector('aside[aria-label="Details panel"]');
    expect(panel?.querySelector('app-workflow-panel')).toBeTruthy();
    expect(panel?.querySelector('app-entity-details')).toBeNull();
    expect(el.querySelector('main app-workflow-detail')).toBeTruthy();
  });

  it('Start chat on a workflow that picks datasets opens the composer preselected', () => {
    const { app } = setup();
    workflowsNav().startChatWithWorkflow(v2);
    expect(shellState().mainView()).toBe('conversation-new');
    expect(composerState().composerWorkflowId()).toBe('qti-v2-turn');

    workflowsNav().startChatWithWorkflow(assistant);
    expect(shellState().mainView()).toBe('conversation-new');
    expect(composerState().composerWorkflowId()).toBe('agent:assistant');
  });

  it('Start chat on any other workflow creates the session from the workflow and opens it', () => {
    const { app, http } = setup();
    workflowsNav().startChatWithWorkflow(health);
    expect(workflowsNav().startingWorkflowId()).toBe('agent:u-1');
    const req = http.expectOne(
      (r) => r.method === 'POST' && r.url.endsWith('/sessions'),
    );
    expect(req.request.body).toEqual({ workflowId: 'agent:u-1' });
    req.flush({
      ok: true,
      message: 'Session "Health plan analyst" created',
      session: {
        id: 's-1',
        name: 'Health plan analyst',
        datasets: ['World Cup Core'],
        messages: [],
      },
    });
    expect(workflowsNav().startingWorkflowId()).toBeNull();
    expect(shellState().mainView()).toBe('session-chat');
    expect(sessionsState().activeSession()?.id).toBe('s-1');
  });

  it('a refused Start chat stays put', () => {
    const { app, http } = setup();
    workflowsNav().openWorkflow(health.id);
    workflowsNav().startChatWithWorkflow(health);
    http
      .expectOne((r) => r.method === 'POST' && r.url.endsWith('/sessions'))
      .flush({ ok: false, message: "None of this agent's datasets exist" });
    expect(shellState().mainView()).toBe('workflow-detail');
    expect(workflowsNav().startingWorkflowId()).toBeNull();
  });
});
