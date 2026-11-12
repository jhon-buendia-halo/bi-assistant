import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatMessage } from '../../../sessions/models/session.model';
import { WorkflowRun } from '../../../workflows/models/workflow.model';
import {
  RunStreamHandlers,
  WorkflowRunsApiService,
} from '../../../workflows/services/workflow-runs-api.service';
import { AgentTryIt } from './agent-try-it';

const answer = (content: string): ChatMessage => ({
  role: 'assistant',
  content,
  at: '2026-01-01T00:00:00Z',
});

const run = (message: ChatMessage | undefined): WorkflowRun =>
  ({
    id: 'r1',
    workflowId: 'agent:a1',
    workflowName: 'Fan',
    input: { question: 'Who won?' },
    status: 'success',
    steps: [],
    ...(message ? { answer: message } : {}),
  }) as unknown as WorkflowRun;

interface Call {
  agentId: string;
  question: string;
  handlers: RunStreamHandlers;
  signal?: AbortSignal;
  finish: () => void;
}

describe('AgentTryIt', () => {
  let fixture: ComponentFixture<AgentTryIt>;
  let calls: Call[];

  beforeEach(async () => {
    calls = [];
    await TestBed.configureTestingModule({
      imports: [AgentTryIt],
      providers: [
        {
          provide: WorkflowRunsApiService,
          useValue: {
            streamDraftRun: (
              agentId: string,
              question: string,
              handlers: RunStreamHandlers,
              signal?: AbortSignal,
            ) =>
              new Promise<void>((resolve) =>
                calls.push({
                  agentId,
                  question,
                  handlers,
                  signal,
                  finish: resolve,
                }),
              ),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AgentTryIt);
    fixture.componentRef.setInput('agentId', 'a1');
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const byId = (id: string) =>
    el().querySelector<HTMLElement>(`[data-testid="${id}"]`);

  async function ask(text: string): Promise<void> {
    const box = byId('agent-tryit-question') as HTMLTextAreaElement;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (byId('agent-tryit-run') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('disables Run until there is a question, then runs the draft once and shows the answer', async () => {
    expect((byId('agent-tryit-run') as HTMLButtonElement).disabled).toBeTrue();
    await ask('  Who won?  ');

    expect(calls.length).toBe(1);
    expect(calls[0].agentId).toBe('a1');
    expect(calls[0].question).toBe('Who won?');
    expect(byId('agent-tryit-stop')).not.toBeNull();
    expect(byId('agent-tryit-run')).toBeNull();

    calls[0].handlers.onDone?.(run(answer('Brazil won.')));
    calls[0].finish();
    fixture.detectChanges();
    expect(byId('agent-tryit-answer')?.textContent).toContain('Brazil won.');
    expect(byId('agent-tryit-run')).not.toBeNull();
  });

  it('Stop aborts the stream and shows no result; Reset clears the question and answer', async () => {
    await ask('Who won?');
    (byId('agent-tryit-stop') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(calls[0].signal?.aborted).toBeTrue();
    expect(byId('agent-tryit-stopped')).not.toBeNull();
    expect(byId('agent-tryit-answer')).toBeNull();

    (byId('agent-tryit-reset') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(byId('agent-tryit-stopped')).toBeNull();
    expect(
      (byId('agent-tryit-question') as HTMLTextAreaElement).value,
    ).toBe('');
  });

  it('shows a failed run as an error, and a refusal for want of a dataset as the blocked message', async () => {
    await ask('Who won?');
    calls[0].handlers.onError?.('provider down');
    fixture.detectChanges();
    expect(byId('agent-tryit-error')?.textContent).toContain('provider down');

    await ask('Again');
    calls[1].handlers.onError?.('Select at least one dataset to preview');
    fixture.detectChanges();
    expect(byId('agent-tryit-no-dataset')?.textContent).toContain(
      'Select at least one dataset to preview',
    );
    expect(byId('agent-tryit-question')).toBeNull();
  });

  it('runs nothing when the gate refuses, and uses the id the gate saved', async () => {
    let allow = false;
    fixture.componentRef.setInput('agentId', null);
    fixture.componentRef.setInput('beforeRun', async () => {
      if (allow) fixture.componentRef.setInput('agentId', 'saved-1');
      return allow;
    });
    fixture.detectChanges();
    await ask('Who won?');
    expect(calls.length).toBe(0);

    allow = true;
    await ask('Who won?');
    expect(calls[0].agentId).toBe('saved-1');
  });

  it('says why it cannot run when blocked, with an Edit link when editable', () => {
    fixture.componentRef.setInput('blocked', 'Add a dataset to this agent to try it.');
    fixture.componentRef.setInput('editable', true);
    fixture.detectChanges();
    expect(byId('agent-tryit-no-dataset')?.textContent).toContain(
      'Add a dataset to this agent to try it.',
    );
    expect(byId('agent-tryit-edit')?.textContent).toContain('Edit');
    expect(byId('agent-tryit-run')).toBeNull();
  });

  it('aborts a running stream when it is destroyed', async () => {
    await ask('Who won?');
    fixture.destroy();
    expect(calls[0].signal?.aborted).toBeTrue();
  });
});
