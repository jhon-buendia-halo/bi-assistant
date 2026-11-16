import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { WorkflowRun } from '../../../workflows/models/workflow.model';
import { RunVisualsState } from '../../services/run-visuals-state';
import { RunsState } from '../../services/runs-state';
import { RunDetail, runInputEntries } from './run-detail';

const RUN: WorkflowRun = {
  id: 'r1',
  workflowId: 'answer-business-question',
  workflowName: 'Insights Analyst',
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
    const state = TestBed.inject(RunsState);
    state.activeRun.set(run);
    const fixture = TestBed.createComponent(RunDetail);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the workflow, status, input, steps and the answer, read-only', () => {
    const el = mount(RUN);
    expect(el.querySelector('[data-testid="run-detail-workflow"]')?.textContent).toContain(
      'Insights Analyst',
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

  it('a run waiting for an answer reads "Waiting for you", with no Run again or Answer in the workflow (they are on its workflow page)', () => {
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
    expect(el.querySelector('[data-testid="run-answer-in-workflow"]')).toBeNull();
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

  it('shows the reference images of the input as thumbnails read through the run image endpoint', () => {
    const el = mount({
      ...RUN,
      input: {
        question: 'Why?',
        images: ['inputs/images/1.png', 'inputs/images/2.jpg'],
      },
    });
    const first = el.querySelector<HTMLImageElement>(
      '[data-testid="run-detail-input-image-0"]',
    )!;
    expect(first.alt).toBe('Reference image 1');
    expect(first.src).toContain(
      '/workflow-runs/r1/input-image?path=inputs%2Fimages%2F1.png',
    );
    expect(
      el
        .querySelector<HTMLImageElement>('[data-testid="run-detail-input-image-1"]')!
        .alt,
    ).toBe('Reference image 2');
    expect(el.querySelector('[data-testid="run-detail-input"]')!.textContent).not.toContain(
      'inputs/images',
    );
  });

  it('turns the images of an input into one entry holding their paths', () => {
    expect(runInputEntries({ images: ['inputs/images/1.png'] })).toEqual([
      { name: 'images', value: '', images: ['inputs/images/1.png'] },
    ]);
  });

  describe('the query inspector (workflows R31; plan 1.25.5)', () => {
    const WITH_QUERIES: WorkflowRun = {
      ...RUN,
      answer: {
        role: 'assistant',
        content: 'The data holds 964 matches.',
        at: '2026-01-01T00:00:01Z',
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
        evidence: [{ index: 0, coverage: 'whole-table', datasourceKind: 'postgres' }],
      },
    };

    function mountWithHttp(run: WorkflowRun) {
      const state = TestBed.inject(RunsState);
      state.activeRun.set(run);
      const http = TestBed.inject(HttpTestingController);
      const fixture = TestBed.createComponent(RunDetail);
      fixture.detectChanges();
      return { fixture, http, el: fixture.nativeElement as HTMLElement };
    }
    const evidence = (r: { url: string; method: string }) =>
      r.method === 'POST' && r.url.endsWith('/workflow-runs/r1/answer/evidence');

    it('shows the query rows and a chip, builds the evidence once, and opens the inspector from a row', async () => {
      const { fixture, http, el } = mountWithHttp(WITH_QUERIES);
      http.expectOne(evidence).flush({ ok: true, run: WITH_QUERIES });
      fixture.detectChanges();
      expect(el.textContent).not.toContain('Data used');
      expect(el.querySelector('[data-testid="query-coverage-line"]')).not.toBeNull();
      const row = el.querySelector<HTMLElement>('[data-testid="query-row-0"]')!;
      expect(row.textContent).toContain('Counting the matches.');
      expect(el.querySelector('[data-testid="figure-ref"]')?.textContent).toBe('1');
      expect(el.querySelector('[data-testid="query-inspector"]')).toBeNull();

      row.click();
      fixture.detectChanges();
      // The inspector is a deferred block: it renders once its chunk has loaded.
      await fixture.whenStable();
      fixture.detectChanges();
      const sheet = el.querySelector('[data-testid="query-inspector-sheet"]')!;
      expect(sheet.querySelector('[data-testid="query-inspector-position"]')?.textContent).toContain(
        'Source 1 of 1',
      );
      // Showing the run again builds nothing a second time.
      fixture.detectChanges();
      http.expectNone(evidence);

      el.querySelector<HTMLElement>('[data-testid="query-inspector-close"]')!.click();
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="query-inspector"]')).toBeNull();
      // Opening the query asked for its steps; that is the only call left.
      http.expectOne((r) => r.url.endsWith('/answer/queries/0/explanation'));
      http.verify();
    });

    it('renders a run of another workflow as before: Data used, no query rows, no evidence call', () => {
      const other: WorkflowRun = { ...WITH_QUERIES, workflowId: 'other-workflow' };
      const { http, el } = mountWithHttp(other);
      http.expectNone(evidence);
      expect(el.querySelector('[data-testid="query-row-0"]')).toBeNull();
      expect(el.querySelector('[data-testid="figure-ref"]')).toBeNull();
      expect(el.textContent).toContain('Data used');
      http.verify();
    });
  });
});
