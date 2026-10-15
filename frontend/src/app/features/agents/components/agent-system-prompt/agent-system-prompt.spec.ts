import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../../core/config/api.config';
import { ToastService } from '../../../../core/toast/toast.service';
import { AgentPageState } from '../../services/agent-page-state.service';
import { AgentDetail } from '../../services/agents-api.service';
import { SkillSummary } from '../../services/skills-api.service';
import { AgentSystemPrompt } from './agent-system-prompt';

const agent = {
  key: 'a1',
  id: 'a1',
  name: 'Fan',
  description: 'About fans',
  tools: [],
  kind: 'user',
  status: 'live',
  instructions: 'CORE PROMPT',
  toolDetails: [],
  memory: null,
  model: null,
  draft: {
    name: 'Fan',
    description: 'About fans',
    instructions: 'Be brief [[skill:planner]]',
    datasets: ['world-cup'],
    starterQuestions: ['Who won?'],
    model: 'gpt-x',
  },
} as unknown as AgentDetail;

const library = [
  { id: 's1', name: 'planner', description: 'Use when planning', tools: [] },
] as unknown as SkillSummary[];

describe('AgentSystemPrompt', () => {
  let fixture: ComponentFixture<AgentSystemPrompt>;
  let http: HttpTestingController;
  let component: AgentSystemPrompt;
  let toast: ToastService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentSystemPrompt],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(ToastService);
    fixture = TestBed.createComponent(AgentSystemPrompt);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('agent', agent);
    fixture.componentRef.setInput('library', library);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const byId = (id: string) =>
    el().querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);

  it('shows the instructions with chips and the core prompt collapsed', () => {
    expect(byId('agent-instructions')?.textContent).toContain('Be brief');
    expect(
      el().querySelector('[data-link="skill:planner"]')?.className,
    ).toContain('chip-info');
    expect(el().querySelector('details summary')?.textContent).toContain(
      'Assistant core prompt (fixed)',
    );
  });

  it('saves the draft keeping its other fields and toasts', () => {
    const success = spyOn(toast, 'success');
    const saved = jasmine.createSpy('saved');
    component.saved.subscribe(saved);
    byId('prompt-edit')!.click();
    fixture.detectChanges();
    expect(byId('prompt-save')!.disabled).toBeTrue();

    component.draft.set('Be brief [[skill:planner]] [[tool:sample_rows]]');
    fixture.detectChanges();
    expect(byId('prompt-save')!.disabled).toBeFalse();
    expect(
      el().querySelector('[data-testid="prompt-links"]')?.textContent,
    ).toContain('sample_rows');
    byId('prompt-save')!.click();

    const put = http.expectOne(`${API_BASE_URL}/agents/a1/draft`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({
      name: 'Fan',
      description: 'About fans',
      instructions: 'Be brief [[skill:planner]] [[tool:sample_rows]]',
      datasets: ['world-cup'],
      starterQuestions: ['Who won?'],
      model: 'gpt-x',
    });
    put.flush({ ok: true, message: 'x' });
    expect(success).toHaveBeenCalledWith('Draft saved');
    expect(saved).toHaveBeenCalled();
    fixture.detectChanges();
    expect(byId('prompt-save')).toBeNull();
  });

  it('refuses to save with a broken link and says so', () => {
    byId('prompt-edit')!.click();
    component.draft.set('Use [[skill:ghost]]');
    fixture.detectChanges();
    expect(byId('prompt-save')!.disabled).toBeTrue();
    expect(byId('prompt-link-error')?.textContent?.trim()).toBe(
      'No skill named ghost. Remove the link or create the skill on the Skills tab.',
    );
    expect(
      el().querySelector('[data-link="skill:ghost"]')?.className,
    ).toContain('chip-danger');
  });

  it('flags unsaved typing for the leave guard and clears it on Cancel', () => {
    const state = TestBed.inject(AgentPageState);
    byId('prompt-edit')!.click();
    component.draft.set('changed');
    fixture.detectChanges();
    expect(state.dirty()).toBeTrue();
    byId('prompt-cancel')!.click();
    fixture.detectChanges();
    expect(state.dirty()).toBeFalse();
  });
});
