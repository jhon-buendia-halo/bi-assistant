import { Component, input, output } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../../core/config/api.config';
import { SessionChat } from '../../../sessions/components/session-chat/session-chat';
import { Session } from '../../../sessions/models/session.model';
import { AgentDetail } from '../../services/agents-api.service';
import { AgentChatBox } from './agent-chat-box';

@Component({ selector: 'app-session-chat', template: 'chat' })
class StubSessionChat {
  readonly session = input<Session>();
  readonly sessionUpdated = output<Session>();
}

const userAgent = {
  key: 'a1',
  id: 'a1',
  name: 'Fan',
  kind: 'user',
  status: 'draft',
  datasets: ['world-cup'],
} as unknown as AgentDetail;

const session = (id: string) =>
  ({ id, name: 'Preview', datasets: [], messages: [] }) as Session;

describe('AgentChatBox', () => {
  let fixture: ComponentFixture<AgentChatBox>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentChatBox],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    })
      .overrideComponent(AgentChatBox, {
        remove: { imports: [SessionChat] },
        add: { imports: [StubSessionChat] },
      })
      .compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function render(agent: AgentDetail): void {
    fixture = TestBed.createComponent(AgentChatBox);
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const byId = (id: string) =>
    el().querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);

  async function flushPreview(id: string): Promise<void> {
    const post = http.expectOne(`${API_BASE_URL}/sessions`);
    expect(post.request.body).toEqual({ agentId: 'a1', preview: true });
    post.flush({ ok: true, message: 'ok', session: session(id) });
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('starts a preview of the draft and New chat discards it and starts another', async () => {
    render(userAgent);
    await flushPreview('p1');
    expect(el().textContent).toContain('Chat with the draft');
    expect(el().querySelector('app-session-chat')).not.toBeNull();

    byId('agent-chat-new')!.click();
    const del = http.expectOne(`${API_BASE_URL}/sessions/p1`);
    expect(del.request.method).toBe('DELETE');
    del.flush({ ok: true, message: 'ok' });
    await flushPreview('p2');
    expect(el().querySelector('app-session-chat')).not.toBeNull();
  });

  it('discards the preview when the page is left', async () => {
    render(userAgent);
    await flushPreview('p1');
    fixture.destroy();
    http
      .expectOne(`${API_BASE_URL}/sessions/p1`)
      .flush({ ok: true, message: 'ok' });
  });

  it('says to add a dataset, with an Edit link', async () => {
    render(userAgent);
    const edit = jasmine.createSpy('edit');
    fixture.componentInstance.edit.subscribe(edit);
    http.expectOne(`${API_BASE_URL}/sessions`).flush({
      ok: false,
      message: 'Select at least one dataset to preview',
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(byId('agent-chat-no-dataset')?.textContent).toContain(
      'Add a dataset to this agent to chat with it.',
    );
    byId('agent-chat-edit')!.click();
    expect(edit).toHaveBeenCalledWith(userAgent);
  });

  it('offers Start chat for the Official assistant, with no preview', () => {
    render({
      key: 'assistant',
      id: 'assistant',
      name: 'Assistant',
      kind: 'official',
      datasets: [],
    } as unknown as AgentDetail);
    const start = jasmine.createSpy('start');
    fixture.componentInstance.startChat.subscribe(start);
    expect(el().textContent).toContain(
      'Chats with the assistant run over datasets you choose.',
    );
    byId('agent-chat-start')!.click();
    expect(start).toHaveBeenCalled();
  });
});
