import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ShellState } from './shell-state';

describe('ShellState.rightPanelAvailable', () => {
  let shell: ShellState;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    shell = TestBed.inject(ShellState);
  });

  it('is true on views that use the right panel', () => {
    for (const view of ['home', 'workflows', 'runs'] as const) {
      shell.mainView.set(view);
      expect(shell.rightPanelAvailable()).toBe(true);
    }
  });

  it('is false on a workflow page, whatever rightPanelOpen holds', () => {
    shell.mainView.set('workflow-detail');
    expect(shell.rightPanelAvailable()).toBe(false);
    shell.rightPanelOpen.set(true);
    expect(shell.rightPanelAvailable()).toBe(false);
    expect(shell.rightPanelOpen()).toBe(true);
  });

  it('is true while settings are open, even over a workflow page', () => {
    shell.mainView.set('workflow-detail');
    shell.settingsOpen.set(true);
    expect(shell.rightPanelAvailable()).toBe(true);
    shell.settingsOpen.set(false);
    expect(shell.rightPanelAvailable()).toBe(false);
  });
});
