import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../core/config/api.config';
import { InteractiveVisualization } from '../../sessions/models/session.model';
import { WorkflowRun } from '../../workflows/models/workflow.model';
import { RunVisualsState } from './run-visuals-state';

const RUN: WorkflowRun = {
  id: 'r1',
  workflowId: 'agent:assistant',
  workflowName: 'Assistant',
  input: {},
  status: 'success',
  steps: [],
  question: 'Goals by team?',
  answer: {
    role: 'assistant',
    content: 'Brazil scored the most.',
    at: '2026-01-01T00:00:01Z',
  },
  datasets: [],
  startedAt: '2026-01-01T00:00:00Z',
};

function visual(version: number): InteractiveVisualization {
  return {
    id: 'vis-1',
    title: 'Goals by team',
    description: '',
    path: 'visuals/vis-1',
    sourceMessageAt: RUN.answer!.at,
    createdAt: '2026-01-01T00:00:02Z',
    currentVersion: version,
    document: '<html></html>',
    version,
  };
}

describe('RunVisualsState (visuals R2, R12-R24 on a run; api.md 130-134)', () => {
  let state: RunVisualsState;
  let http: HttpTestingController;
  const base = `${API_BASE_URL}/workflow-runs/r1/visualizations`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    state = TestBed.inject(RunVisualsState);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('generates from the answer, opens the visual and hands the stored run back', () => {
    const applied: WorkflowRun[] = [];
    const stored = { ...RUN, events: [RUN.answer!] };
    state.generate(RUN, (run) => applied.push(run));
    expect(state.generating()).toBe('r1');

    const req = http.expectOne(base);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ sourceMessageAt: RUN.answer!.at });
    req.flush({
      ok: true,
      message: 'Interactive visual generated',
      run: stored,
      visualization: visual(1),
    });

    expect(state.generating()).toBeNull();
    expect(state.shown()?.runId).toBe('r1');
    expect(state.shown()?.visualization.version).toBe(1);
    expect(applied).toEqual([stored]);
  });

  it('tailors, reverts and refreshes the open visual over the run routes', () => {
    state.shown.set({ runId: 'r1', visualization: visual(2) });
    const applied: WorkflowRun[] = [];

    state.revert(1, (run) => applied.push(run));
    const revert = http.expectOne(`${base}/vis-1/revert`);
    expect(revert.request.body).toEqual({ version: 1 });
    revert.flush({
      ok: true,
      message: 'Reverted to version 1',
      run: RUN,
      visualization: visual(1),
    });
    expect(state.shown()?.visualization.version).toBe(1);
    expect(applied.length).toBe(1);

    state.selectVersion(2);
    const view = http.expectOne(`${base}/vis-1?version=2`);
    expect(view.request.method).toBe('GET');
    view.flush(visual(2));
    expect(state.shown()?.visualization.version).toBe(2);
    expect(state.loading()).toBeFalse();
  });

  it("the answer card's View opens that visual at the card's version", () => {
    state.view(RUN, {
      visualId: 'vis-1',
      version: 2,
      title: 'Goals by team',
      action: 'updated',
    });
    expect(state.loading()).toBeTrue();
    http.expectOne(`${base}/vis-1?version=2`).flush(visual(2));
    expect(state.shown()?.visualization.id).toBe('vis-1');
  });

  it('shows why a visual could not be opened', () => {
    state.view(RUN, {
      visualId: 'gone',
      version: 1,
      title: 'x',
      action: 'created',
    });
    http
      .expectOne(`${base}/gone?version=1`)
      .flush(
        { message: 'Visualization gone not found in session run-r1' },
        { status: 404, statusText: 'Not Found' },
      );
    expect(state.error()).toBe('Visualization gone not found in session run-r1');
    expect(state.shown()).toBeNull();
  });
});
