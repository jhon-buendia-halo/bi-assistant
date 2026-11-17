import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { WorkflowRun } from '../models/workflow.model';
import { WorkflowConversation, turnQuestion } from './workflow-conversation';
import { WorkflowDesigner } from './workflow-designer.service';

const run = (
  id: string,
  question: string,
  fromRunId?: string,
): WorkflowRun => ({
  id,
  workflowId: 'answer-business-question',
  workflowName: 'Answer a Business Question',
  input: { question },
  ...(fromRunId ? { context: { fromRunId } } : {}),
  status: 'success',
  steps: [],
  datasets: [],
  question,
  answer: {
    role: 'assistant',
    content: `Answer to ${question}`,
    at: '2026-11-17T10:00:00.000Z',
  },
  startedAt: '2026-11-17T10:00:00.000Z',
});

describe('WorkflowConversation, the Business view thread (workflows R38)', () => {
  let http: HttpTestingController;
  let designer: WorkflowDesigner;
  let conversation: WorkflowConversation;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        WorkflowConversation,
      ],
    });
    http = TestBed.inject(HttpTestingController);
    designer = TestBed.inject(WorkflowDesigner);
    conversation = TestBed.inject(WorkflowConversation);
  });

  afterEach(() => http.verify());

  const expectRun = (id: string) =>
    http.expectOne((r) => r.url.endsWith(`/workflow-runs/${id}`));

  it('reads nothing while off', () => {
    designer.run.set(run('c', 'Third', 'b'));
    TestBed.tick();
    http.expectNone((r) => r.url.includes('/workflow-runs/'));
    expect(conversation.earlier()).toEqual([]);
  });

  it('follows the follow-ups back to the first question, oldest first', () => {
    conversation.active.set(true);
    designer.run.set(run('c', 'Third', 'b'));
    TestBed.tick();
    expectRun('b').flush(run('b', 'Second', 'a'));
    expectRun('a').flush(run('a', 'First'));
    expect(conversation.earlier().map((turn) => turn.question)).toEqual([
      'First',
      'Second',
    ]);
    expect(conversation.earlier()[0].answer?.content).toBe('Answer to First');

    // A live follow-up on the shown run: the earlier runs come from the cache.
    designer.contextRun.set({ id: 'c', question: 'Third' });
    TestBed.tick();
    expectRun('c').flush(run('c', 'Third', 'b'));
    expect(conversation.earlier().map((turn) => turn.runId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('ends the thread at a deleted earlier run', () => {
    conversation.active.set(true);
    designer.run.set(run('c', 'Third', 'b'));
    TestBed.tick();
    expectRun('b').flush(run('b', 'Second', 'gone'));
    expectRun('gone').flush('Run not found', {
      status: 404,
      statusText: 'Not Found',
    });
    expect(conversation.earlier().map((turn) => turn.question)).toEqual([
      'Second',
    ]);
  });

  it('a new question, with no earlier run, empties it', () => {
    conversation.active.set(true);
    designer.run.set(run('b', 'Second', 'a'));
    TestBed.tick();
    expectRun('a').flush(run('a', 'First'));
    expect(conversation.earlier().length).toBe(1);
    designer.run.set(run('d', 'Fresh'));
    TestBed.tick();
    expect(conversation.earlier()).toEqual([]);
  });

  it('a turn reads the run question, else its input question, else the workflow name', () => {
    expect(turnQuestion(run('a', 'First'))).toBe('First');
    expect(
      turnQuestion({
        ...run('a', ''),
        question: undefined,
        input: { question: 'Typed' },
      }),
    ).toBe('Typed');
    expect(
      turnQuestion({ ...run('a', ''), question: undefined, input: {} }),
    ).toBe('Answer a Business Question');
  });
});
