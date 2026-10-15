import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../../core/config/api.config';
import {
  BuiltInSkillSummary,
  SkillSummary,
} from '../../services/skills-api.service';
import { AgentSkillsInline } from './agent-skills-inline';

const library = [
  {
    id: 's1',
    name: 'planner',
    description: 'Use when planning',
    agents: ['Fan'],
    tools: ['sample_rows'],
  },
  {
    id: 's2',
    name: 'budget',
    description: 'Use when budgeting',
    agents: [],
    tools: [],
  },
] as unknown as SkillSummary[];

const builtIn = [
  {
    name: 'curated-knowledge',
    description: 'Use when curated',
    loading: 'on-demand',
    agents: [],
    modified: false,
    builtInChanged: false,
    updatedAt: null,
  },
] as unknown as BuiltInSkillSummary[];

describe('AgentSkillsInline', () => {
  let fixture: ComponentFixture<AgentSkillsInline>;
  let http: HttpTestingController;
  let component: AgentSkillsInline;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentSkillsInline],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AgentSkillsInline);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('agentKey', 'a1');
    fixture.componentRef.setInput('instructions', 'Use [[skill:planner]]');
    fixture.componentRef.setInput('library', library);
    fixture.componentRef.setInput('builtIn', builtIn);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const el = () => fixture.nativeElement as HTMLElement;
  const byId = (id: string) =>
    el().querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  const text = (id: string) => byId(id)?.textContent?.trim();

  it('marks Linked and Not linked from the draft links', () => {
    expect(text('agent-skill-linked-planner')).toBe('Linked');
    expect(byId('agent-skill-linked-planner')?.className).toContain(
      'chip-success',
    );
    expect(text('agent-skill-linked-budget')).toBe('Not linked');
    expect(byId('agent-skill-linked-budget')?.className).toContain(
      'chip-neutral',
    );
    expect(
      byId('agent-skill-row-planner')?.querySelector('.chip-neutral')
        ?.textContent,
    ).toContain('sample_rows');
    expect(component.count()).toBe(2);
    expect(byId('agent-builtin-skill-curated-knowledge')).not.toBeNull();
  });

  it('deletes a skill in place after confirming', async () => {
    spyOn(window, 'confirm').and.returnValue(true);
    const changed = jasmine.createSpy('changed');
    component.changed.subscribe(changed);
    byId('agent-skill-delete-budget')!.click();
    const del = http.expectOne(`${API_BASE_URL}/skills/s2`);
    expect(del.request.method).toBe('DELETE');
    del.flush({ ok: true, message: 'Skill "budget" deleted' });
    await fixture.whenStable();
    expect(changed).toHaveBeenCalled();
  });

  it('creates a skill with the inline form', async () => {
    const changed = jasmine.createSpy('changed');
    component.changed.subscribe(changed);
    byId('agent-skill-new')!.click();
    fixture.detectChanges();
    expect(byId('agent-skill-form')).not.toBeNull();
    component.editor.update({
      name: 'notes',
      description: 'Use when noting',
      body: 'Body',
    });
    fixture.detectChanges();
    expect(byId('agent-skill-save')!.disabled).toBeFalse();
    const saving = component.save();
    const post = http.expectOne(`${API_BASE_URL}/skills`);
    expect(post.request.method).toBe('POST');
    expect(post.request.body.name).toBe('notes');
    post.flush({
      ok: true,
      message: 'Skill "notes" saved',
      skill: { id: 's3', name: 'notes', agents: [] },
    });
    await saving;
    fixture.detectChanges();
    expect(changed).toHaveBeenCalled();
    expect(byId('agent-skill-form')).toBeNull();
  });

  it('edits a skill in place', () => {
    byId('agent-skill-edit-planner')!.click();
    const get = http.expectOne(`${API_BASE_URL}/skills/s1`);
    get.flush({
      ...library[0],
      body: 'Body',
      files: [],
    });
    fixture.detectChanges();
    expect(component.editing()).toBe('s1');
    expect(component.editor.form().name).toBe('planner');
  });
});
