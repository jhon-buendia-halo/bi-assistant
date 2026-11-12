import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { App } from '../../../../app';
import { ShellState } from '../../../../core/shell/shell-state';
import { WorkflowsNavState } from '../../../../features/workflows/services/workflows-nav-state';

const shellState = () => TestBed.inject(ShellState);
const workflowsNav = () => TestBed.inject(WorkflowsNavState);

describe('Workflows area (workflows R5-R8, app-shell R3)', () => {
  beforeEach(async () => {
    localStorage.removeItem('questions-to-insights:right-panel-width');
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

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
    workflowsNav().openWorkflow('agent:report');
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('workflow-detail');
    expect(workflowsNav().activeWorkflowId()).toBe('agent:report');
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
});
