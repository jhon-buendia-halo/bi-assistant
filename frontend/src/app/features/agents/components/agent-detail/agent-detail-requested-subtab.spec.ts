import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { API_BASE_URL } from '../../../../core/config/api.config';
import { ShellState } from '../../../../core/shell/shell-state';
import { AgentPageState } from '../../services/agent-page-state.service';
import { AgentsNavState } from '../../services/agents-nav-state';
import { AgentDetail as AgentDetailModel } from '../../services/agents-api.service';
import { AgentDetail } from './agent-detail';

const key = 'assistant';
const agentUrl = `${API_BASE_URL}/agents/${key}`;
const runsUrl = `${agentUrl}/evals/runs`;

/**
 * Monitoring's Agent quality row opens the agent's Evals tab on Executions
 * (monitoring R67, agents-evals R34).
 */
describe('AgentDetail requested Evals sub-tab', () => {
  let http: HttpTestingController;
  let pageState: AgentPageState;
  let nav: AgentsNavState;
  let shell: ShellState;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [AgentDetail],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    pageState = TestBed.inject(AgentPageState);
    nav = TestBed.inject(AgentsNavState);
    shell = TestBed.inject(ShellState);
    pageState.requestedTab.set(null);
    pageState.requestedEvalTab.set(null);
    pageState.reset();
  });

  afterEach(() => {
    http.match(() => true);
  });

  function open(): ComponentFixture<AgentDetail> {
    const fixture = TestBed.createComponent(AgentDetail);
    fixture.componentRef.setInput('agentKey', key);
    fixture.detectChanges();
    http.expectOne(agentUrl).flush({
      key,
      id: key,
      name: 'Assistant',
      description: '',
      tools: [],
      kind: 'official',
      status: 'builtin',
      instructions: '',
      toolDetails: [],
      memory: null,
      model: null,
      datasets: [],
      usedInWorkflows: [],
    } as unknown as AgentDetailModel);
    fixture.detectChanges();
    return fixture;
  }

  it('opens Executions on the Evals tab and loads the runs', () => {
    nav.openAgentEvalRuns(key);
    expect(nav.activeAgentKey()).toBe(key);
    const fixture = open();
    const req = http.expectOne(runsUrl);
    req.flush({ runs: [] });
    fixture.detectChanges();
    const page = fixture.componentInstance;
    expect(page.activeTab()).toBe('evals');
    expect(page.evalTab()).toBe('runs');
    expect(page.evalRunsLoading()).toBeFalse();
    expect(pageState.requestedTab()).toBeNull();
    expect(pageState.requestedEvalTab()).toBeNull();
  });

  it('clears both requests when the shell refuses the open', () => {
    spyOn(shell, 'confirmLeaveAgentEditor').and.returnValue(false);
    nav.openAgentEvalRuns(key);
    expect(nav.activeAgentKey()).toBeNull();
    expect(pageState.requestedTab()).toBeNull();
    expect(pageState.requestedEvalTab()).toBeNull();
  });

  it('a plain open lands on the default tab and sub-tab', () => {
    nav.openAgentByKey(key);
    const fixture = open();
    http.expectNone(runsUrl);
    const page = fixture.componentInstance;
    expect(page.activeTab()).not.toBe('evals');
    expect(page.evalTab()).toBe('questions');
  });
});
