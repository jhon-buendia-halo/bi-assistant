import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from '../../../../app';
import { ShellState } from '../../../../core/shell/shell-state';
import { RunsState } from '../../../runs/services/runs-state';
import { SessionsState } from '../../../../features/sessions/services/sessions-state';

const shellState = () => TestBed.inject(ShellState);
const sessionsState = () => TestBed.inject(SessionsState);
const runsState = () => TestBed.inject(RunsState);

describe('Runs area (app-shell R3, R49)', () => {
  beforeEach(async () => {
    localStorage.removeItem('questions-to-insights:right-panel-width');
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  it('should list past chats on the Runs page, not in the drawer', async () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    sessionsState().sessions.set([{ id: 's1', name: 'Alpha', datasets: [], messages: [] }]);
    sessionsState().sessionsLoaded.set(true);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(
      compiled.querySelector('[aria-label="Sessions navigation"]'),
    ).toBeFalsy();
    expect(compiled.querySelector('[data-testid="session-s1"]')).toBeFalsy();

    shellState().selectArea('runs');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(shellState().mainView()).toBe('runs');
    // From an open chat, the rail returns to the list.
    shellState().mainView.set('session-chat');
    shellState().selectArea('runs');
    expect(shellState().mainView()).toBe('runs');
    // Past chats are the Runs page's second tab (past-chats R63).
    runsState().setTab('past-chats');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      compiled.querySelector(
        'nav[aria-label="Past chats"] [data-testid="session-s1"]',
      ),
    ).toBeTruthy();
  });

  it('should show the active session datasource in the header', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    sessionsState().activeSession.set({
      id: 'session-1',
      name: 'World Cup analysis',
      datasets: ['Futbol DB'],
      messages: [],
    });
    shellState().mainView.set('session-chat');
    sessionsState().activeSessionDatasources.set([
      {
        id: 'postgres-1',
        name: 'futbol local',
        kind: 'postgres',
        summary: 'localhost:55432/world_cup',
        config: {
          host: 'localhost',
          port: 55432,
          database: 'world_cup',
          user: 'world_cup',
          password: 'masked',
          ssl: false,
        },
      },
    ]);

    fixture.detectChanges();

    const header = fixture.nativeElement.querySelector('header') as HTMLElement;
    expect(header.textContent).toContain('Datasource');
    expect(header.textContent).toContain('futbol local');
    expect(header.textContent).toContain('PostgreSQL');
  });
});

describe('Chat header Workflow chip (past-chats R57, R59, roadmap 1.23.6)', () => {
  beforeEach(async () => {
    localStorage.removeItem('questions-to-insights:right-panel-width');
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  function header(workflowRef: {
    id: string;
    name: string;
    kind: 'code' | 'agent';
    deleted: boolean;
  }): HTMLElement {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    sessionsState().activeSession.set({
      id: 'session-1',
      name: 'World Cup analysis',
      datasets: ['World Cup Core'],
      messages: [],
      workflowRef,
    });
    shellState().mainView.set('session-chat');
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('header') as HTMLElement;
  }

  it('names the workflow of a plain Assistant chat', () => {
    const el = header({
      id: 'agent:assistant',
      name: 'Assistant',
      kind: 'agent',
      deleted: false,
    });
    expect(el.textContent).toContain('Workflow');
    expect(
      el.querySelector('[data-testid="session-workflow"]')?.textContent?.trim(),
    ).toBe('Assistant');
    expect(el.querySelector('[data-testid="session-agent"]')).toBeNull();
  });

  it('names a code-defined workflow', () => {
    const el = header({
      id: 'qti-v2-turn',
      name: 'Questions to Insights v2',
      kind: 'code',
      deleted: false,
    });
    expect(
      el.querySelector('[data-testid="session-workflow"]')?.textContent?.trim(),
    ).toBe('Questions to Insights v2');
  });

  it('marks a deleted agent\'s workflow', () => {
    const el = header({
      id: 'agent:u-1',
      name: 'Cup historian',
      kind: 'agent',
      deleted: true,
    });
    expect(
      el.querySelector('[data-testid="session-workflow"]')?.textContent?.trim(),
    ).toBe('Cup historian · agent deleted');
  });
});
