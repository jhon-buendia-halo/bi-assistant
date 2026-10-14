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

function builtIn(
  key: string,
  kind: 'official' | 'system',
  linksAllowed: boolean,
): AgentDetailModel {
  return {
    key,
    id: key,
    name: key === 'rfp' ? 'RFP Builder' : 'SQL Fixer',
    description: '',
    tools: [],
    kind,
    status: 'builtin',
    instructions: 'SERVED',
    toolDetails:
      key === 'rfp'
        ? [
            { name: 'list_clients', description: 'List clients.', inputs: [] },
            { name: 'get_rfp', description: 'Read an RFP.', inputs: [] },
          ]
        : [],
    memory: null,
    model: null,
    prompt: {
      editable:
        key === 'rfp'
          ? 'You are the RFP Builder. Load [[skill:rfp-process]], then [[tool:list_clients]].'
          : 'Fix it.',
      shipped: '',
      modified: false,
      builtInChanged: false,
      linksAllowed,
      updatedAt: null,
    },
  } as unknown as AgentDetailModel;
}

describe('AgentDetail Graph tab (agents-evals R88, R105)', () => {
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

  function open(agent: AgentDetailModel): HTMLElement {
    fixture = TestBed.createComponent(AgentDetail);
    fixture.componentRef.setInput('agentKey', agent.key);
    fixture.detectChanges();
    http.expectOne(`${API_BASE_URL}/agents/${agent.key}`).flush(agent);
    http
      .match(`${API_BASE_URL}/agents/${agent.key}/skills`)
      .forEach((req) => req.flush({ skills: [] }));
    http.match(`${API_BASE_URL}/skills/built-in`).forEach((req) =>
      req.flush({
        skills: [
          {
            name: 'rfp-process',
            description: 'The stages.',
            loading: 'on-demand',
            agents: ['rfp'],
          },
          {
            name: 'curated-knowledge',
            description: 'Curated.',
            loading: 'on-demand',
            agents: ['assistant'],
          },
        ],
      }),
    );
    fixture.componentInstance.activeTab.set('graph');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it("draws the RFP Builder's links: its skill and its tools", () => {
    const el = open(builtIn('rfp', 'official', true));
    expect(el.querySelector('[data-testid="agent-graph"]')).not.toBeNull();
    expect(el.textContent).not.toContain('This agent has no links');
    const text = el.querySelector('[data-testid="agent-graph"]')!.textContent;
    expect(text).toContain('rfp-process');
    expect(text).toContain('list_clients');
    expect(text).toContain('get_rfp');
    // The assistant's skill is not the RFP Builder's.
    expect(text).not.toContain('curated-knowledge');
  });

  it('says a System agent has no links', () => {
    const el = open(builtIn('sql-fixer', 'system', false));
    expect(el.querySelector('[data-testid="agent-graph"]')).toBeNull();
    expect(el.textContent).toContain(
      'This agent has no links: it gets all of its tools.',
    );
  });
});
