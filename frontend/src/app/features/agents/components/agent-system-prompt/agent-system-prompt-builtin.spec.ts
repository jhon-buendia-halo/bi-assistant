import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../../core/config/api.config';
import { AuthService } from '../../../../core/auth/auth.service';
import { ToastService } from '../../../../core/toast/toast.service';
import { AgentPageState } from '../../services/agent-page-state.service';
import {
  AgentDetail,
  AgentPromptView,
} from '../../services/agents-api.service';
import { AgentSystemPrompt } from './agent-system-prompt';

function builtIn(
  key: string,
  prompt: Partial<AgentPromptView> = {},
): AgentDetail {
  return {
    key,
    id: key,
    name: key === 'assistant' ? 'Assistant' : 'SQL fixer',
    description: '',
    tools: [],
    kind: key === 'assistant' ? 'official' : 'system',
    status: 'builtin',
    instructions: 'SERVED PROMPT',
    toolDetails: [],
    memory: null,
    model: null,
    prompt: {
      editable: 'SHIPPED',
      shipped: 'SHIPPED',
      modified: false,
      builtInChanged: false,
      linksAllowed: key === 'assistant',
      updatedAt: null,
      ...prompt,
    },
  } as unknown as AgentDetail;
}

describe('AgentSystemPrompt (built-in agents)', () => {
  let fixture: ComponentFixture<AgentSystemPrompt>;
  let http: HttpTestingController;
  let component: AgentSystemPrompt;
  let toast: ToastService;
  let allowed: boolean;

  beforeEach(async () => {
    allowed = true;
    await TestBed.configureTestingModule({
      imports: [AgentSystemPrompt],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(ToastService);
    spyOn(TestBed.inject(AuthService), 'can').and.callFake(
      (p) => allowed && p === 'edit-policies',
    );
  });

  afterEach(() => http.verify());

  function render(agent: AgentDetail): void {
    fixture = TestBed.createComponent(AgentSystemPrompt);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
  }
  const el = () => fixture.nativeElement as HTMLElement;
  const byId = (id: string) =>
    el().querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);

  it('shows the prompt as served with a Built-in chip and Edit', () => {
    render(builtIn('sql-fixer'));
    expect(el().textContent).toContain('Built-in');
    expect(byId('agent-prompt-view')?.textContent).toContain('SERVED PROMPT');
    expect(byId('agent-prompt-edit')).not.toBeNull();
    expect(byId('agent-prompt-reset')).toBeNull();
    expect(byId('agent-prompt-modified')).toBeNull();
  });

  it('is read-only without edit-policies', () => {
    allowed = false;
    render(builtIn('sql-fixer', { modified: true }));
    expect(byId('agent-prompt-edit')).toBeNull();
    expect(byId('agent-prompt-reset')).toBeNull();
    expect(byId('agent-prompt-modified')?.textContent).toContain('Modified');
  });

  it('edits a System agent in a textarea, saves and toasts', () => {
    const success = spyOn(toast, 'success');
    render(builtIn('sql-fixer'));
    const saved = jasmine.createSpy('saved');
    component.saved.subscribe(saved);
    byId('agent-prompt-edit')!.click();
    fixture.detectChanges();
    expect(byId('agent-prompt-banner')?.textContent).toContain(
      'Changes apply to every session and agent as soon as you save.',
    );
    const area = el().querySelector<HTMLTextAreaElement>(
      '[data-testid="agent-prompt-textarea"]',
    )!;
    expect(area.value).toBe('SHIPPED');
    expect(el().querySelector('app-prompt-editor')).toBeNull();
    expect(byId('agent-prompt-save')!.disabled).toBeTrue();
    expect(byId('agent-prompt-count')?.textContent).toContain('7/20,000');

    area.value = 'NEW TEXT';
    area.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(byId('agent-prompt-save')!.disabled).toBeFalse();
    byId('agent-prompt-save')!.click();
    const put = http.expectOne(`${API_BASE_URL}/agents/sql-fixer/prompt`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ prompt: 'NEW TEXT' });
    put.flush({ ok: true, message: 'System prompt of "SQL fixer" saved' });
    expect(success).toHaveBeenCalledWith('System prompt of "SQL fixer" saved');
    expect(saved).toHaveBeenCalled();
    fixture.detectChanges();
    expect(byId('agent-prompt-save')).toBeNull();
  });

  it('disables Save for an empty prompt and Cancel discards', () => {
    render(builtIn('sql-fixer'));
    byId('agent-prompt-edit')!.click();
    component.draft.set('   ');
    fixture.detectChanges();
    expect(byId('agent-prompt-save')!.disabled).toBeTrue();
    byId('agent-prompt-cancel')!.click();
    fixture.detectChanges();
    expect(byId('agent-prompt-editing')).toBeNull();
    expect(byId('agent-prompt-view')).not.toBeNull();
  });

  it('uses the link editor and the Tools note for the assistant', async () => {
    render(builtIn('assistant'));
    byId('agent-prompt-edit')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelector('app-prompt-editor')).not.toBeNull();
    expect(el().querySelector('textarea')).toBeNull();
    expect(byId('agent-prompt-tools-note')?.textContent).toContain(
      'The ## Tools list is generated',
    );
  });

  it('marks the page dirty while an edit is unsaved', () => {
    render(builtIn('sql-fixer'));
    const state = TestBed.inject(AgentPageState);
    byId('agent-prompt-edit')!.click();
    fixture.detectChanges();
    expect(state.promptDirty()).toBeFalse();
    component.draft.set('changed');
    fixture.detectChanges();
    expect(state.promptDirty()).toBeTrue();
  });

  it('resets after the confirm, and not when it is declined', () => {
    const success = spyOn(toast, 'success');
    render(builtIn('sql-fixer', { modified: true }));
    expect(byId('agent-prompt-modified')).not.toBeNull();
    const saved = jasmine.createSpy('saved');
    component.saved.subscribe(saved);

    const confirm = spyOn(window, 'confirm').and.returnValue(false);
    byId('agent-prompt-reset')!.click();
    http.expectNone(`${API_BASE_URL}/agents/sql-fixer/prompt`);

    confirm.and.returnValue(true);
    byId('agent-prompt-reset')!.click();
    expect(confirm).toHaveBeenCalledWith(
      'Reset the system prompt of "SQL fixer" to the built-in version?',
    );
    const del = http.expectOne(`${API_BASE_URL}/agents/sql-fixer/prompt`);
    expect(del.request.method).toBe('DELETE');
    del.flush({ ok: true, message: 'System prompt of "SQL fixer" reset' });
    expect(success).toHaveBeenCalledWith('System prompt of "SQL fixer" reset');
    expect(saved).toHaveBeenCalled();
  });

  it('shows the drift notice and the shipped version on request', () => {
    render(
      builtIn('sql-fixer', {
        modified: true,
        builtInChanged: true,
        editable: 'MINE',
        shipped: 'NEW SHIPPED',
      }),
    );
    expect(byId('agent-prompt-drift')?.textContent).toContain(
      "The app's built-in version changed since this was edited.",
    );
    expect(byId('agent-prompt-shipped')).toBeNull();
    byId('agent-prompt-show-shipped')!.click();
    fixture.detectChanges();
    expect(byId('agent-prompt-shipped')?.textContent).toContain('NEW SHIPPED');
  });
});
