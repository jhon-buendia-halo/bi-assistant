import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { MonitoringApiService } from '../../services/monitoring-api.service';
import { MonitoringStateService } from '../../services/monitoring-state.service';
import { MonitoringTabs } from './monitoring-tabs';

describe('MonitoringTabs', () => {
  let fixture: ComponentFixture<MonitoringTabs>;
  let state: MonitoringStateService;
  let el: HTMLElement;

  const facets = { agents: [], models: [], providers: [], sessions: [] };

  beforeEach(async () => {
    localStorage.clear();
    (document.activeElement as HTMLElement | null)?.blur();
    const api = jasmine.createSpyObj<MonitoringApiService>('Api', [
      'list',
      'listSessions',
      'getAgentQuality',
    ]);
    api.list.and.returnValue(
      of({ items: [], total: 0, page: 1, pageSize: 25, facets }),
    );
    api.listSessions.and.returnValue(
      of({
        items: [],
        total: 0,
        page: 1,
        pageSize: 25,
        facets: { agents: [] },
      }),
    );
    api.getAgentQuality.and.returnValue(
      of({
        from: null,
        to: '2026-11-22T10:00:00.000Z',
        rows: [],
        facets: { agents: [], sets: [], models: [] },
      }),
    );
    await TestBed.configureTestingModule({
      imports: [MonitoringTabs],
      providers: [{ provide: MonitoringApiService, useValue: api }],
    }).compileComponents();
    state = TestBed.inject(MonitoringStateService);
    fixture = TestBed.createComponent(MonitoringTabs);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  const tab = (id: string) =>
    el.querySelector(`[data-testid="monitoring-tab-${id}"]`) as HTMLElement;

  async function press(id: string, key: string): Promise<void> {
    tab(id).dispatchEvent(new KeyboardEvent('keydown', { key }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('has three tabs with a note each', async () => {
    expect(
      Array.from(el.querySelectorAll('[role="tab"]')).map((t) =>
        t.textContent!.trim(),
      ),
    ).toEqual(['LLM calls', 'Runs', 'Agent quality']);
    const note = () =>
      el.querySelector('[data-testid="monitoring-note"]')!.textContent!.trim();
    expect(note()).toBe(
      "LLM calls made by the app's agent personas, newest first.",
    );
    tab('sessions').click();
    fixture.detectChanges();
    expect(note()).toBe(
      'Runs with recorded agent persona calls, most recent first.',
    );
    tab('quality').click();
    fixture.detectChanges();
    expect(note()).toBe(
      'How each agent persona scores on its evals and behaves in live calls.',
    );
    expect(
      el.querySelector('[data-testid="monitoring-panel-quality"]'),
    ).not.toBeNull();
    expect(
      el.querySelector('[data-testid="agent-quality-page"]'),
    ).not.toBeNull();
  });

  it('moves with the arrow keys, wrapping at the ends', async () => {
    await press('calls', 'ArrowRight');
    expect(state.tab()).toBe('sessions');
    await press('sessions', 'ArrowRight');
    expect(state.tab()).toBe('quality');
    await press('quality', 'ArrowRight');
    expect(state.tab()).toBe('calls');
    await press('calls', 'ArrowLeft');
    expect(state.tab()).toBe('quality');
    await press('quality', 'ArrowLeft');
    expect(state.tab()).toBe('sessions');
  });

  it('jumps with Home and End and focuses the tab', async () => {
    await press('calls', 'End');
    expect(state.tab()).toBe('quality');
    expect(document.activeElement).toBe(tab('quality'));
    await press('quality', 'Home');
    expect(state.tab()).toBe('calls');
    expect(document.activeElement).toBe(tab('calls'));
  });

  it('forwards the agent key of a quality row as openAgentEvals', async () => {
    const keys: string[] = [];
    fixture.componentInstance.openAgentEvals.subscribe((k) => keys.push(k));
    fixture.debugElement
      .query((d) => d.name === 'app-agent-quality-page')
      ?.triggerEventHandler('openAgent', 'assistant');
    state.setTab('quality');
    fixture.detectChanges();
    fixture.debugElement
      .query((d) => d.name === 'app-agent-quality-page')
      .triggerEventHandler('openAgent', 'assistant');
    expect(keys).toEqual(['assistant']);
  });
});
