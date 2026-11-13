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
    workflowsNav().openWorkflow('qti-v2-turn');
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('workflow-detail');
    expect(workflowsNav().activeWorkflowId()).toBe('qti-v2-turn');
    expect(shellState().currentArea()).toBe('workflows');
    expect(
      el
        .querySelector('button[aria-label="Workflows"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
    shellState().selectArea('workflows');
    expect(shellState().mainView()).toBe('workflows');
  });

  it('opens a workflow page without the right panel: the Run panel sits under the canvas (ui.md 4.4b)', async () => {
    const { fixture, el } = setup();
    expect(shellState().rightPanelOpen()).toBe(false);
    workflowsNav().openWorkflow('qti-v2-turn');
    fixture.detectChanges();
    // The page is a deferred block.
    await fixture.whenStable();
    fixture.detectChanges();
    // Opening a workflow no longer opens the right panel.
    expect(shellState().rightPanelOpen()).toBe(false);
    expect(shellState().rightPanelAvailable()).toBe(false);
    expect(el.querySelector('aside[aria-label="Details panel"]')).toBeNull();
    expect(el.querySelector('button[title="Expand right panel"]')).toBeNull();
    expect(el.querySelector('app-workflow-panel')).toBeNull();
    expect(el.querySelector('[data-testid="workflow-panel-title"]')).toBeNull();
    expect(el.querySelector('main app-workflow-detail')).toBeTruthy();
  });

  it('does not render the Details panel on a workflow page even when it was left open', async () => {
    const { fixture, el } = setup();
    shellState().rightPanelOpen.set(true);
    workflowsNav().openWorkflow('qti-v2-turn');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(shellState().rightPanelOpen()).toBe(true);
    expect(el.querySelector('aside[aria-label="Details panel"]')).toBeNull();
    // Leaving the page brings it back.
    shellState().selectArea('workflows');
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('workflows');
    expect(el.querySelector('aside[aria-label="Details panel"]')).toBeTruthy();
  });
});
