import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { WorkflowRun } from '../../../workflows/models/workflow.model';
import { RunVisualsState } from '../../services/run-visuals-state';
import { RunsState } from '../../services/runs-state';
import { RunDetail, runInputEntries } from './run-detail';

const RUN: WorkflowRun = {
  id: 'r1',
  workflowId: 'qti-v2-turn',
  workflowName: 'Questions to Insights v2',
  input: { question: 'Which team scored the most goals?', datasets: ['World Cup Core', 'Other'] },
  status: 'success',
  steps: [{ id: 'answer', title: 'Answer', status: 'success' }],
  question: 'Which team scored the most goals?',
  answer: { role: 'assistant', content: 'Brazil scored the most.', at: '2026-01-01T00:00:01Z' },
  datasets: ['World Cup Core'],
  startedAt: '2026-01-01T00:00:00Z',
};

describe('RunDetail (workflows R18-R20; plan 1.24.11)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RunDetail],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  function mount(run: WorkflowRun, inCatalogue = true): HTMLElement {
    const state = TestBed.inject(RunsState);
    state.activeRun.set(run);
    state.canRunAgain.set(inCatalogue);
    const fixture = TestBed.createComponent(RunDetail);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the workflow, status, input, steps and the answer, read-only', () => {
    const el = mount(RUN);
    expect(el.querySelector('[data-testid="run-detail-workflow"]')?.textContent).toContain(
      'Questions to Insights v2',
    );
    expect(el.querySelector('[data-testid="run-detail-status"]')?.textContent).toContain(
      'Run succeeded',
    );
    const input = el.querySelector('[data-testid="run-detail-input"]')!.textContent!;
    expect(input).toContain('Which team scored the most goals?');
    expect(input).toContain('World Cup Core, Other');
    expect(el.querySelector('[data-testid="run-detail-step-answer"]')?.textContent).toContain(
      'Done',
    );
    expect(el.querySelector('[data-testid="run-detail-answer"]')?.textContent).toContain(
      'Brazil scored the most.',
    );
    // Nothing on a stored run sends, rates or stops anything.
    expect(el.querySelector('textarea, input')).toBeNull();
    expect(el.querySelector('[data-testid="workflow-run-stop"]')).toBeNull();
  });

  it('Run again hands the run to the Runs state', () => {
    const el = mount(RUN);
    const again = spyOn(TestBed.inject(RunsState), 'runAgain');
    el.querySelector<HTMLButtonElement>('[data-testid="run-again"]')!.click();
    expect(again).toHaveBeenCalledWith(RUN);
  });

  it('a run waiting for an answer offers Answer in the workflow instead of Run again', () => {
    const waiting: WorkflowRun = {
      ...RUN,
      status: 'suspended',
      answer: undefined,
      waitingFor: {
        stepId: 'clarify',
        title: 'Clarify',
        question: 'Which one?',
        options: [],
        expiresAt: '2026-01-01T00:30:00Z',
      },
    };
    const el = mount(waiting);
    expect(
      el.querySelector('[data-testid="run-detail-status"]')?.textContent,
    ).toContain('Waiting for you');
    expect(el.querySelector('[data-testid="run-again"]')).toBeNull();
    const open = spyOn(TestBed.inject(RunsState), 'answerInWorkflow');
    const button = el.querySelector<HTMLButtonElement>(
      '[data-testid="run-answer-in-workflow"]',
    )!;
    expect(button.textContent?.trim()).toBe('Answer in the workflow');
    button.click();
    expect(open).toHaveBeenCalledWith(waiting);
  });

  it('a run of a removed workflow reads as a plain run: its answer, no Run again, no phases bar', () => {
    const el = mount(
      {
        ...RUN,
        workflowId: 'agent:assistant',
        workflowName: 'Assistant',
        workflow: {
          phases: [{ number: 1, title: 'Understand' }],
          current: null,
          done: [1],
          skipped: [],
          source: 'prompt',
        },
      },
      false,
    );
    expect(el.querySelector('[data-testid="run-detail-workflow"]')?.textContent).toContain(
      'Assistant',
    );
    expect(el.querySelector('[data-testid="run-detail-answer"]')?.textContent).toContain(
      'Brazil scored the most.',
    );
    expect(el.querySelector('[data-testid="run-again"]')).toBeNull();
    expect(el.querySelector('[data-testid="run-detail-phases"]')).toBeNull();
  });

  it('shows a failed run with its error and no answer', () => {
    const el = mount({
      ...RUN,
      status: 'failed',
      error: 'Boom',
      answer: undefined,
      steps: [{ id: 'answer', title: 'Answer', status: 'failed', error: 'Boom' }],
    });
    expect(el.querySelector('[data-testid="run-detail-status"]')?.textContent).toContain(
      'Run failed: Boom',
    );
    expect(el.querySelector('[data-testid="run-detail-answer"]')).toBeNull();
  });

  it('offers Generate interactive visuals on the answer and hands the run to the visual state', () => {
    const el = mount(RUN);
    const generate = spyOn(TestBed.inject(RunVisualsState), 'generate');
    const button = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Generate interactive visuals'),
    )!;
    button.click();
    expect(generate).toHaveBeenCalledWith(RUN, jasmine.any(Function));
  });

  it('shows the visual cards stored on the run, and View opens that visual', () => {
    const el = mount({
      ...RUN,
      events: [
        {
          role: 'assistant',
          content: 'Created interactive visual "Goals" (v1).',
          at: '2026-01-01T00:00:02Z',
          visual: {
            visualId: 'vis-1',
            version: 1,
            title: 'Goals',
            action: 'created',
          },
        },
      ],
    });
    const view = spyOn(TestBed.inject(RunVisualsState), 'view');
    const card = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'View',
    )!;
    card.click();
    expect(view).toHaveBeenCalledWith(
      jasmine.objectContaining({ id: 'r1' }),
      jasmine.objectContaining({ visualId: 'vis-1', version: 1 }),
    );
  });

  it('turns an input into one entry per field', () => {
    expect(runInputEntries({ a: 'x', b: ['y', 'z'], c: true })).toEqual([
      { name: 'a', value: 'x' },
      { name: 'b', value: 'y, z' },
      { name: 'c', value: 'true' },
    ]);
  });
});
