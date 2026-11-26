import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { ChatMessage } from '../../../sessions/models/session.model';
import { WorkflowRun } from '../../../workflows/models/workflow.model';
import {
  RunStreamHandlers,
  WorkflowRunsApiService,
} from '../../../workflows/services/workflow-runs-api.service';
import { AgentTryItSheet } from '../agent-try-it-sheet/agent-try-it-sheet';
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

const withData = (id: string): WorkflowRun =>
  ({
    ...run(undefined),
    id,
    answer: {
      ...answer('The data holds 964 matches.'),
      data: [
        {
          tool: 'run_readonly_sql',
          input: 'select count(*) as n from matches',
          columns: ['n'],
          rows: [{ n: 964 }],
          rowCount: 1,
          rationale: 'Counting the matches.',
        },
      ],
      evidence: [{ index: 0, coverage: 'whole-table' }],
    },
  }) as unknown as WorkflowRun;

interface ResumeCall {
  agentId: string;
  runId: string;
  stepId: string;
  answer: string;
  handlers: RunStreamHandlers;
  finish: () => void;
}

const suspended = (): WorkflowRun =>
  ({
    ...run(undefined),
    status: 'suspended',
    waitingFor: {
      stepId: 'answer',
      title: 'Answer',
      question: 'Which World Cup do you mean?',
      options: ['2018', '2022'],
      expiresAt: '2026-11-26T10:30:00.000Z',
    },
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
  let resumes: ResumeCall[];
  let evidenceCalls: string[];
  /** What the evidence endpoints answer; a test swaps it to answer 404. */
  let evidenceReply: (id: string) => Observable<{ ok: boolean; run: WorkflowRun }>;

  beforeEach(async () => {
    calls = [];
    resumes = [];
    evidenceCalls = [];
    evidenceReply = (id) => of({ ok: true, run: withData(id) });
    window.document.body.focus();
    await TestBed.configureTestingModule({
      imports: [AgentTryIt, AgentTryItSheet],
      providers: [
        {
          provide: WorkflowRunsApiService,
          useValue: {
            prepareEvidence: (id: string) => {
              evidenceCalls.push(`prepare ${id}`);
              return evidenceReply(id);
            },
            explainQuery: (id: string, index: number) => {
              evidenceCalls.push(`explain ${id} ${index}`);
              return evidenceReply(id);
            },
            resumeDraftRun: (
              agentId: string,
              runId: string,
              stepId: string,
              answer: string,
              handlers: RunStreamHandlers,
            ) =>
              new Promise<void>((resolve) =>
                resumes.push({
                  agentId,
                  runId,
                  stepId,
                  answer,
                  handlers,
                  finish: resolve,
                }),
              ),
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

  describe('a draft that waits for the user (api.md 129, 169)', () => {
    /** The agent asks: the stream's `run`, then a suspended `done`. */
    async function waitForUser(): Promise<void> {
      await ask('Who won the World Cup?');
      calls[0].handlers.onRun?.({ runId: 'r1', workflowId: 'agent:a1' });
      calls[0].handlers.onDone?.(suspended());
      calls[0].finish();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    async function pick(option: number): Promise<void> {
      (
        byId(`workflow-run-input-option-${option}`) as HTMLButtonElement
      ).click();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('shows the question as a waiting card, not as an answer or an error', async () => {
      await waitForUser();
      expect(byId('workflow-run-input-question')?.textContent).toContain(
        'Which World Cup do you mean?',
      );
      expect(byId('workflow-run-input-option-1')?.textContent).toContain(
        '2022',
      );
      expect(byId('agent-tryit-answer')).toBeNull();
      expect(byId('agent-tryit-error')).toBeNull();
      expect(byId('agent-tryit-stop')).toBeNull();
    });

    it('takes the question from the input-required event when the run carries none', async () => {
      await ask('Who won?');
      calls[0].handlers.onInputRequired?.({
        runId: 'r1',
        stepId: 'answer',
        title: 'Answer',
        question: 'Men or women?',
        options: [],
        expiresAt: '2026-11-26T10:30:00.000Z',
      });
      calls[0].handlers.onDone?.({
        ...suspended(),
        waitingFor: undefined,
      } as WorkflowRun);
      calls[0].finish();
      fixture.detectChanges();
      expect(byId('workflow-run-input-question')?.textContent).toContain(
        'Men or women?',
      );
    });

    it('sends the answer to the same draft and shows the continued answer', async () => {
      await waitForUser();
      await pick(1);

      expect(resumes.length).toBe(1);
      expect(resumes[0]).toEqual(
        jasmine.objectContaining({
          agentId: 'a1',
          runId: 'r1',
          stepId: 'answer',
          answer: '2022',
        }),
      );
      expect(calls.length).toBe(1);
      expect(byId('workflow-run-input-question')).toBeNull();
      expect(byId('agent-tryit-stop')).not.toBeNull();

      resumes[0].handlers.onDone?.(run(answer('Argentina won in 2022.')));
      resumes[0].finish();
      fixture.detectChanges();
      expect(byId('agent-tryit-answer')?.textContent).toContain(
        'Argentina won in 2022.',
      );
    });

    it('can wait again after the answer', async () => {
      await waitForUser();
      await pick(0);
      resumes[0].handlers.onDone?.(suspended());
      resumes[0].finish();
      fixture.detectChanges();
      expect(byId('workflow-run-input-question')).not.toBeNull();
    });

    it('keeps the card and shows the refusal when the answer is refused', async () => {
      await waitForUser();
      await pick(0);
      resumes[0].handlers.onRefused?.(400);
      resumes[0].handlers.onError?.('Answer is required');
      resumes[0].finish();
      fixture.detectChanges();
      expect(byId('workflow-run-input-error')?.textContent).toContain(
        'Answer is required',
      );
      expect(byId('workflow-run-input-option-0')).not.toBeNull();
    });

    it('a 410 marks the card expired; the rerun adds the answer to the question', async () => {
      await waitForUser();
      await pick(0);
      resumes[0].handlers.onRefused?.(410);
      resumes[0].handlers.onError?.(
        'This run can no longer continue — run it again with your answer',
      );
      resumes[0].finish();
      fixture.detectChanges();

      expect(byId('workflow-run-input-expired')).not.toBeNull();
      expect(byId('workflow-run-input-continue')).toBeNull();
      expect(byId('agent-tryit-error')).toBeNull();

      await pick(1);
      (byId('workflow-run-input-rerun') as HTMLButtonElement).click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(calls.length).toBe(2);
      expect(calls[1].question).toBe('Who won the World Cup?\n2022');
      expect(byId('workflow-run-input-expired')).toBeNull();
    });

    it('a failure of the continued run reads as an error', async () => {
      await waitForUser();
      await pick(0);
      resumes[0].handlers.onError?.('provider down');
      fixture.detectChanges();
      expect(byId('agent-tryit-error')?.textContent).toContain('provider down');
    });

    it('Reset drops the waiting card', async () => {
      await waitForUser();
      (byId('agent-tryit-reset') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(byId('workflow-run-input-question')).toBeNull();
    });
  });

  it('aborts a running stream when it is destroyed', async () => {
    await ask('Who won?');
    fixture.destroy();
    expect(calls[0].signal?.aborted).toBeTrue();
  });

  describe('the query inspector (agents-evals R60; plan m1-25 1.25.11)', () => {
    let sheet: ComponentFixture<AgentTryItSheet>;
    const sheetEl = () => sheet.nativeElement as HTMLElement;
    const inSheet = (id: string) =>
      sheetEl().querySelector<HTMLElement>(`[data-testid="${id}"]`);

    beforeEach(() => {
      // TestBed keeps one root element in the page: the sheet is made first,
      // moved to the body, and Try it is made again after it.
      sheet = TestBed.createComponent(AgentTryItSheet);
      window.document.body.appendChild(sheet.nativeElement);
      sheet.detectChanges();
      fixture = TestBed.createComponent(AgentTryIt);
      fixture.componentRef.setInput('agentId', 'a1');
      fixture.detectChanges();
    });

    afterEach(() => {
      sheet.destroy();
      sheetEl().remove();
    });

    /** The stream's `run` event, then its `done`. */
    async function answerWithData(runId = 'draft-1'): Promise<void> {
      await ask('How many matches?');
      calls[0].handlers.onRun?.({ runId, workflowId: 'agent:a1' });
      calls[0].handlers.onDone?.(withData('ignored'));
      calls[0].finish();
      fixture.detectChanges();
    }

    it('shows chips and query rows for an answer with data, and renders one without data as before', async () => {
      await answerWithData();
      expect(byId('agent-tryit-answer')?.querySelector('[data-testid="query-row-0"]')).not.toBeNull();
      expect(byId('agent-tryit-answer')?.querySelector('[data-testid="figure-ref"]')?.textContent).toBe('1');
      expect(byId('agent-tryit-answer')?.textContent).not.toContain('Data used');

      await ask('Again');
      calls[1].handlers.onDone?.(run(answer('Brazil won.')));
      fixture.detectChanges();
      expect(byId('agent-tryit-answer')?.querySelector('[data-testid="query-row-0"]')).toBeNull();
      expect(byId('agent-tryit-answer')?.textContent).toContain('Brazil won.');
    });

    it('passes the question that was run to the answer, so its numbers get no chip', async () => {
      await ask('Count the 964 matches');
      calls[0].handlers.onRun?.({ runId: 'draft-1', workflowId: 'agent:a1' });
      calls[0].handlers.onDone?.(withData('x'));
      fixture.detectChanges();
      expect(byId('agent-tryit-answer')?.querySelector('[data-testid="figure-ref"]')).toBeNull();
    });

    it('prepares the evidence once, with the run id the stream sent, when the answer arrives', async () => {
      await answerWithData('draft-7');
      expect(evidenceCalls).toEqual(['prepare draft-7']);
      fixture.detectChanges();
      expect(evidenceCalls.length).toBe(1);
    });

    it('prepares nothing for an answer without data, and says nothing when prepare fails', async () => {
      await ask('Who won?');
      calls[0].handlers.onDone?.(run(answer('Brazil won.')));
      expect(evidenceCalls).toEqual([]);

      evidenceReply = () => throwError(() => ({ status: 500 }));
      await ask('Again');
      calls[1].handlers.onRun?.({ runId: 'draft-2', workflowId: 'agent:a1' });
      calls[1].handlers.onDone?.(withData('draft-2'));
      fixture.detectChanges();
      expect(byId('agent-tryit-error')).toBeNull();
    });

    it('opens the inspector in the sheet from a row, calls the adapter with the stream\'s run id, and Escape returns the focus', async () => {
      await answerWithData('draft-3');
      const row = byId('query-row-0') as HTMLElement;
      row.focus();
      row.click();
      sheet.detectChanges();
      expect(inSheet('query-inspector-position')?.textContent).toContain('Source 1 of 1');

      // The steps tab is the first shown: the query is explained at once.
      expect(evidenceCalls).toEqual(['prepare draft-3', 'explain draft-3 0']);

      inSheet('query-inspector')!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      sheet.detectChanges();
      expect(inSheet('query-inspector-sheet')).toBeNull();
      await new Promise((resolve) => setTimeout(resolve));
      expect(window.document.activeElement).toBe(row);
    });

    it('shows the expired-preview message in place of the inspector on a 404', async () => {
      await answerWithData('draft-4');
      evidenceReply = () => throwError(() => ({ status: 404 }));
      (byId('query-row-0') as HTMLElement).click();
      sheet.detectChanges();
      await sheet.whenStable();
      sheet.detectChanges();
      expect(inSheet('agent-tryit-gone')?.textContent).toContain(
        'This preview is no longer available. Run it again.',
      );
      expect(inSheet('query-inspector')).toBeNull();
    });

    it('closes an open inspector and forgets the old run id when the draft runs again', async () => {
      await answerWithData('draft-5');
      (byId('query-row-0') as HTMLElement).click();
      sheet.detectChanges();
      expect(inSheet('query-inspector-sheet')).not.toBeNull();

      await ask('Another question');
      sheet.detectChanges();
      expect(inSheet('query-inspector-sheet')).toBeNull();
      evidenceCalls.length = 0;
      calls[1].handlers.onRun?.({ runId: 'draft-6', workflowId: 'agent:a1' });
      calls[1].handlers.onDone?.(withData('draft-6'));
      expect(evidenceCalls).toEqual(['prepare draft-6']);
    });
  });
});
