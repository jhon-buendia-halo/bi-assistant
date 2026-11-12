import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { WorkflowRun } from '../../../workflows/models/workflow.model';
import { RunsState } from '../../services/runs-state';
import { RunDetail, runInputEntries } from './run-detail';

const RUN: WorkflowRun = {
  id: 'r1',
  workflowId: 'agent:assistant',
  workflowName: 'Assistant',
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

  function mount(run: WorkflowRun): HTMLElement {
    TestBed.inject(RunsState).activeRun.set(run);
    const fixture = TestBed.createComponent(RunDetail);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the workflow, status, input, steps and the answer, read-only', () => {
    const el = mount(RUN);
    expect(el.querySelector('[data-testid="run-detail-workflow"]')?.textContent).toContain(
      'Assistant',
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

  it('turns an input into one entry per field', () => {
    expect(runInputEntries({ a: 'x', b: ['y', 'z'], c: true })).toEqual([
      { name: 'a', value: 'x' },
      { name: 'b', value: 'y, z' },
      { name: 'c', value: 'true' },
    ]);
  });
});
