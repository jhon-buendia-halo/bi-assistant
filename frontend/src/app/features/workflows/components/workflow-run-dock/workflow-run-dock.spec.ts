import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkflowDetail, WorkflowRun } from '../../models/workflow.model';
import { WorkflowDesigner } from '../../services/workflow-designer.service';
import { WorkflowRunDock } from './workflow-run-dock';
import {
  DOCK_DEFAULT_RATIO,
  DOCK_KEY_STEP,
  DOCK_MIN_CANVAS,
  DOCK_MIN_WIDTH,
} from './workflow-run-dock.util';

const RATIO_KEY = 'qti.workflow-run-dock.width-ratio';
const ROOM = 1200;
const DEFAULT_WIDTH = Math.round(ROOM * DOCK_DEFAULT_RATIO);

const WORKFLOW: WorkflowDetail = {
  id: 'qti-v2-turn',
  name: 'Questions to Insights v2',
  description: 'Answers questions over the datasets you pick.',
  kind: 'code',
  owner: 'Official',
  agents: [],
  stepCount: 1,
  trigger: 'run',
  input: [
    { name: 'question', label: 'Question', type: 'textarea', required: true },
  ],
  datasets: [],
  missingDatasets: [],
  starterQuestions: [],
  steps: [
    {
      id: 'answer',
      title: 'Answer',
      kind: 'code',
      summary: 'Answers.',
      input: ['question'],
      output: ['text'],
      exits: [],
    },
  ],
};

function storedRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-42',
    workflowId: 'qti-v2-turn',
    workflowName: 'Questions to Insights v2',
    input: { question: 'Which team scored the most goals?' },
    status: 'success',
    steps: [{ id: 'answer', title: 'Answer', status: 'success' }],
    question: 'Which team scored the most goals?',
    datasets: [],
    startedAt: '2026-11-11T10:00:00.000Z',
    finishedAt: '2026-11-11T10:00:04.000Z',
    ...overrides,
  };
}

/** A page whose room is a fixed 1200 px wide, as the workflow page gives the dock. */
@Component({
  selector: 'app-dock-host',
  imports: [WorkflowRunDock],
  template: `<div
    data-testid="room"
    style="width: 1200px; height: 800px; display: flex; flex-direction: row"
  >
    <app-workflow-run-dock />
  </div>`,
})
class DockHost {}

describe('WorkflowRunDock, the Run panel on the right of the canvas (ui.md 4.4b)', () => {
  let fixture: ComponentFixture<DockHost>;
  let designer: WorkflowDesigner;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(async () => {
    localStorage.removeItem(RATIO_KEY);
    await TestBed.configureTestingModule({
      imports: [DockHost],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    designer = TestBed.inject(WorkflowDesigner);
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem(RATIO_KEY);
  });

  function open(run?: WorkflowRun): void {
    if (run) designer.showRunOnLoad(run);
    designer.load(WORKFLOW.id);
    http
      .expectOne((r) => r.url.endsWith(`/workflows/${WORKFLOW.id}`))
      .flush(WORKFLOW);
    fixture = TestBed.createComponent(DockHost);
    fixture.detectChanges();
    // The room is measured after the first render.
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const q = (testId: string) =>
    el.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  const text = (testId: string) =>
    q(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const handle = () => q('workflow-run-dock-resize')!;
  const now = () => Number(handle().getAttribute('aria-valuenow'));

  function press(key: string): void {
    handle().dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
  }

  it('is a section labelled Run whose header toggle reads Run and folds the body', () => {
    open();
    const dock = q('workflow-run-dock')!;
    expect(dock.querySelector('section')?.getAttribute('aria-label')).toBe(
      'Run',
    );
    const toggle = q('workflow-state-toggle')!;
    expect(toggle.closest('h2')).not.toBeNull();
    expect(text('workflow-state-toggle')).toBe('Run');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(q('workflow-run-chat')).not.toBeNull();
    expect(q('workflow-state')).not.toBeNull();
    expect(handle()).not.toBeNull();

    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(q('workflow-run-chat')).toBeNull();
    expect(q('workflow-state')).toBeNull();
    expect(q('workflow-run-dock-resize')).toBeNull();
    // Folded: a narrow strip with the toggle, the pill and Maximize.
    expect(q('workflow-state-progress')).toBeNull();
    expect(q('workflow-run-dock-maximize')).not.toBeNull();
    expect(q('workflow-run-dock')!.style.width).toBe('');

    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(q('workflow-run-chat')).not.toBeNull();
  });

  it('holds the Chat above the Logs in its body', () => {
    open();
    const dock = q('workflow-run-dock')!;
    expect(dock.querySelector('app-workflow-run-chat')).not.toBeNull();
    expect(dock.querySelector('app-workflow-state-panel')).not.toBeNull();
    const chat = dock.querySelector('app-workflow-run-chat')!;
    const logs = dock.querySelector('app-workflow-state-panel')!;
    expect(chat.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      logs.getBoundingClientRect().top + 1,
    );
  });

  it('says there is no run yet, with no pill', () => {
    open();
    expect(q('workflow-state-status')).toBeNull();
    expect(text('workflow-state-progress')).toBe('0 of 3 nodes ran');
    expect(text('workflow-state-run-id')).toBe(
      "No run yet. Execute the workflow to see each node's data.",
    );
    expect(text('workflow-run-activity')).toBe('');
  });

  it('shows the run shown: the pill, the progress, the duration and the run id', () => {
    open(storedRun());
    expect(text('workflow-state-status')).toBe('success');
    expect(q('workflow-state-status')!.classList).toContain('chip-success');
    expect(text('workflow-state-progress')).toBe('3 of 3 nodes ran');
    expect(text('workflow-state-duration')).toBe('4.0 s');
    expect(text('workflow-state-run-id')).toBe('run-42');
  });

  it('reads a failed run as a danger pill and a refused Execute as the invalid chip', () => {
    open(storedRun({ status: 'failed' }));
    expect(text('workflow-state-status')).toBe('failed');
    expect(q('workflow-state-status')!.classList).toContain('chip-danger');
  });

  it('shows the activity line in the header while the run waits for the user', () => {
    open(
      storedRun({
        status: 'suspended',
        steps: [{ id: 'answer', title: 'Answer', status: 'suspended' }],
      }),
    );
    expect(text('workflow-state-status')).toBe('Waiting for you');
    expect(q('workflow-state-status')!.classList).toContain('chip-warning');
    expect(text('workflow-run-activity')).toBe('Waiting for your answer');
    expect(
      q('workflow-run-dock')!.contains(q('workflow-run-activity')),
    ).toBeTrue();
  });

  it('Maximize toggles aria-pressed and its label, and grows the panel to the maximum', () => {
    open();
    const button = q('workflow-run-dock-maximize')!;
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Maximize Run panel');
    expect(now()).toBe(DEFAULT_WIDTH);

    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('aria-label')).toBe('Restore Run panel');
    expect(now()).toBe(ROOM - DOCK_MIN_CANVAS);

    button.click();
    fixture.detectChanges();
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.getAttribute('aria-label')).toBe('Maximize Run panel');
    expect(now()).toBe(DEFAULT_WIDTH);
  });

  it('Maximize unfolds a folded panel, maximized', () => {
    open();
    q('workflow-state-toggle')!.click();
    fixture.detectChanges();
    q('workflow-run-dock-maximize')!.click();
    fixture.detectChanges();
    expect(designer.stateOpen()).toBeTrue();
    expect(q('workflow-run-chat')).not.toBeNull();
    expect(q('workflow-run-dock-maximize')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(now()).toBe(ROOM - DOCK_MIN_CANVAS);
  });

  describe('the resize handle on its left edge', () => {
    it('is a vertical separator with its bounds and current width', () => {
      open();
      const separator = handle();
      expect(separator.getAttribute('role')).toBe('separator');
      expect(separator.getAttribute('aria-orientation')).toBe('vertical');
      expect(separator.getAttribute('aria-label')).toBe('Resize Run panel');
      expect(separator.getAttribute('aria-valuemin')).toBe(
        String(DOCK_MIN_WIDTH),
      );
      expect(separator.getAttribute('aria-valuemax')).toBe(
        String(ROOM - DOCK_MIN_CANVAS),
      );
      expect(now()).toBe(DEFAULT_WIDTH);
      expect(q('workflow-run-dock')!.style.width).toBe(`${DEFAULT_WIDTH}px`);
    });

    it('Arrow Left grows and Arrow Right shrinks it by a step, and keeps the share', () => {
      open();
      press('ArrowLeft');
      expect(now()).toBe(DEFAULT_WIDTH + DOCK_KEY_STEP);
      press('ArrowRight');
      press('ArrowRight');
      expect(now()).toBe(DEFAULT_WIDTH - DOCK_KEY_STEP);
      expect(Number(localStorage.getItem(RATIO_KEY))).toBeCloseTo(
        (DEFAULT_WIDTH - DOCK_KEY_STEP) / ROOM,
        3,
      );
    });

    it('Home goes to the maximum and End to the minimum', () => {
      open();
      press('Home');
      expect(now()).toBe(ROOM - DOCK_MIN_CANVAS);
      press('End');
      expect(now()).toBe(DOCK_MIN_WIDTH);
      // Never below the minimum.
      press('ArrowRight');
      expect(now()).toBe(DOCK_MIN_WIDTH);
    });

    it('ignores other keys', () => {
      open();
      press('a');
      expect(now()).toBe(DEFAULT_WIDTH);
      expect(localStorage.getItem(RATIO_KEY)).toBeNull();
    });

    it('a double click resets it to the default share', () => {
      open();
      press('ArrowLeft');
      press('ArrowLeft');
      handle().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      fixture.detectChanges();
      expect(now()).toBe(DEFAULT_WIDTH);
      expect(Number(localStorage.getItem(RATIO_KEY))).toBe(DOCK_DEFAULT_RATIO);
    });

    it('starts from the kept share', () => {
      localStorage.setItem(RATIO_KEY, '0.4');
      open();
      expect(now()).toBe(ROOM * 0.4);
    });
  });
});
