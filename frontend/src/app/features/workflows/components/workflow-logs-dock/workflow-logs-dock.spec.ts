import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkflowDetail } from '../../models/workflow.model';
import { WorkflowDesigner } from '../../services/workflow-designer.service';
import {
  DOCK_KEY_STEP,
  LOGS_DOCK,
} from '../workflow-run-dock/workflow-run-dock.util';
import { WorkflowLogsDock } from './workflow-logs-dock';

const ROOM = 800;
const DEFAULT_HEIGHT = Math.round(ROOM * LOGS_DOCK.defaultRatio);

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

/** A column 800 px high, as the workflow page gives the canvas and the Logs. */
@Component({
  selector: 'app-logs-host',
  imports: [WorkflowLogsDock],
  template: `<div style="height: 800px; display: flex; flex-direction: column">
    <div style="flex: 1"></div>
    <app-workflow-logs-dock />
  </div>`,
})
class LogsHost {}

describe('WorkflowLogsDock, the Logs under the canvas (ui.md 4.4b)', () => {
  let fixture: ComponentFixture<LogsHost>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(async () => {
    localStorage.removeItem(LOGS_DOCK.storageKey);
    await TestBed.configureTestingModule({
      imports: [LogsHost],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    const designer = TestBed.inject(WorkflowDesigner);
    designer.load(WORKFLOW.id);
    http
      .expectOne((r) => r.url.endsWith(`/workflows/${WORKFLOW.id}`))
      .flush(WORKFLOW);
    fixture = TestBed.createComponent(LogsHost);
    fixture.detectChanges();
    // The room is measured after the first render.
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem(LOGS_DOCK.storageKey);
  });

  const q = (testId: string) =>
    el.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  const handle = () => q('workflow-logs-dock-resize')!;
  const now = () => Number(handle().getAttribute('aria-valuenow'));
  function press(key: string): void {
    handle().dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
  }

  function unfold(): void {
    q('workflow-logs-toggle')!.click();
    fixture.detectChanges();
  }

  it('starts folded: only its header, with how far the run got', () => {
    const toggle = q('workflow-logs-toggle')!;
    expect(toggle.textContent?.trim()).toBe('Logs');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('title')).toBe('Unfold Logs');
    expect(q('workflow-state')).toBeNull();
    expect(q('workflow-logs-dock-resize')).toBeNull();
    expect(q('workflow-logs-progress')!.textContent?.trim()).toBe(
      '0 of 3 nodes ran',
    );
    expect(q('workflow-logs-dock')!.style.height).toBe('');
  });

  it('unfolds to the Logs at the default share and folds back', () => {
    const toggle = q('workflow-logs-toggle')!;
    unfold();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('title')).toBe('Fold Logs');
    expect(q('workflow-state')).not.toBeNull();
    expect(q('workflow-logs-dock')!.style.height).toBe(`${DEFAULT_HEIGHT}px`);
    toggle.click();
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(q('workflow-state')).toBeNull();
  });

  it('resizes from its top edge: a horizontal separator with its bounds', () => {
    unfold();
    expect(handle().getAttribute('aria-orientation')).toBe('horizontal');
    expect(handle().getAttribute('aria-label')).toBe('Resize Logs panel');
    expect(handle().getAttribute('aria-valuemin')).toBe(String(LOGS_DOCK.min));
    expect(handle().getAttribute('aria-valuemax')).toBe(
      String(ROOM - LOGS_DOCK.minOther),
    );
    expect(now()).toBe(DEFAULT_HEIGHT);
  });

  it('Arrow Up grows, Arrow Down shrinks, Home and End go to the bounds, and the share is kept', () => {
    unfold();
    press('ArrowUp');
    expect(now()).toBe(DEFAULT_HEIGHT + DOCK_KEY_STEP);
    expect(Number(localStorage.getItem(LOGS_DOCK.storageKey))).toBeCloseTo(
      (DEFAULT_HEIGHT + DOCK_KEY_STEP) / ROOM,
      3,
    );
    press('ArrowDown');
    press('ArrowDown');
    expect(now()).toBe(DEFAULT_HEIGHT - DOCK_KEY_STEP);
    press('Home');
    expect(now()).toBe(ROOM - LOGS_DOCK.minOther);
    press('End');
    expect(now()).toBe(LOGS_DOCK.min);
    press('a');
    expect(now()).toBe(LOGS_DOCK.min);
  });

  it('a double click resets it to the default share', () => {
    unfold();
    press('Home');
    handle().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    fixture.detectChanges();
    expect(now()).toBe(DEFAULT_HEIGHT);
    expect(Number(localStorage.getItem(LOGS_DOCK.storageKey))).toBe(
      LOGS_DOCK.defaultRatio,
    );
  });
});
