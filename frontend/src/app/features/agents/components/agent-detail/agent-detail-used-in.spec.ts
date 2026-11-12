import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../../../core/config/api.config';
import { AgentDetail as AgentDetailModel } from '../../services/agents-api.service';
import { AgentDetail } from './agent-detail';

function agent(
  key: string,
  kind: 'official' | 'system' | 'user',
  usedInWorkflows: { id: string; name: string }[],
  extra: Partial<AgentDetailModel> = {},
): AgentDetailModel {
  return {
    key,
    id: key,
    name: key,
    description: '',
    tools: [],
    kind,
    status: kind === 'user' ? 'draft' : 'builtin',
    instructions: 'SERVED',
    toolDetails: [],
    memory: null,
    model: null,
    datasets: [],
    usedInWorkflows,
    ...extra,
  } as unknown as AgentDetailModel;
}

/**
 * The agent header's Used in line (agents-evals R109, plan 5.8) and the tab
 * an agent opens on (R5, R91): no Start chat anywhere, Chat Box for user
 * agents only.
 */
describe('AgentDetail Used in and tabs (agents-evals R5, R109)', () => {
  let fixture: ComponentFixture<AgentDetail>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentDetail],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  function open(model: AgentDetailModel): HTMLElement {
    fixture = TestBed.createComponent(AgentDetail);
    fixture.componentRef.setInput('agentKey', model.key);
    fixture.detectChanges();
    http.expectOne(`${API_BASE_URL}/agents/${model.key}`).flush(model);
    // Whatever else the page loads (skills, library, preview) stays pending.
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const byId = (el: HTMLElement, id: string) =>
    el.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  it('lists each workflow as a button that opens it', () => {
    const el = open(
      agent('assistant-v2', 'official', [
        { id: 'qti-v2-turn', name: 'Questions to Insights v2' },
      ]),
    );
    const line = byId(el, 'agent-used-in')!;
    expect(line.textContent).toContain('Used in');
    const chip = byId(el, 'agent-used-in-qti-v2-turn') as HTMLButtonElement;
    expect(chip.tagName).toBe('BUTTON');
    expect(chip.textContent?.trim()).toBe('Questions to Insights v2');
    const opened = jasmine.createSpy('openWorkflow');
    fixture.componentInstance.openWorkflow.subscribe(opened);
    chip.click();
    expect(opened).toHaveBeenCalledOnceWith('qti-v2-turn');
  });

  it('says a draft-only user agent is not used yet', () => {
    const el = open(agent('u-1', 'user', []));
    expect(byId(el, 'agent-used-in')!.textContent).toContain(
      'Not used in any workflow yet. Publish it to get its one-step workflow.',
    );
    expect(el.querySelector('[data-testid^="agent-used-in-"]')).toBeNull();
  });

  it('says the app calls a System agent itself', () => {
    const el = open(agent('sql-fixer', 'system', []));
    expect(byId(el, 'agent-used-in')!.textContent).toContain(
      'Not used in any workflow. The app calls this agent itself.',
    );
  });

  it('opens an Official agent on System Prompt, with no Chat Box tab and no Start chat', () => {
    const el = open(
      agent('report', 'official', [{ id: 'agent:report', name: 'Report Builder' }]),
    );
    expect(fixture.componentInstance.activeTab()).toBe('prompt');
    expect(byId(el, 'agent-tab-chat')).toBeNull();
    expect(byId(el, 'agent-tab-prompt')).not.toBeNull();
    expect(byId(el, 'agent-start-chat')).toBeNull();
    expect(byId(el, 'agent-used-in-agent:report')?.textContent?.trim()).toBe(
      'Report Builder',
    );
  });

  it('opens a Live user agent on the Chat Box, with no Start chat', () => {
    const el = open(
      agent('u-2', 'user', [{ id: 'agent:u-2', name: 'Health plan' }], {
        status: 'live',
        datasets: ['World Cup Core'],
      }),
    );
    expect(fixture.componentInstance.activeTab()).toBe('chat');
    expect(byId(el, 'agent-tab-chat')).not.toBeNull();
    expect(byId(el, 'agent-start-chat')).toBeNull();
    expect(byId(el, 'agent-used-in-agent:u-2')).not.toBeNull();
  });
});
