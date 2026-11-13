import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProgressStep } from '../../services/workflow-run-progress';
import { WorkflowRunProgress } from './workflow-run-progress';

const STEPS: ProgressStep[] = [
  { id: 'plan', title: 'Plan', state: 'done', attempts: 1 },
  {
    id: 'analyse',
    title: 'Analyse',
    state: 'current',
    attempts: 1,
    startedAt: new Date(Date.now() - 5_000).toISOString(),
  },
  { id: 'validate', title: 'Validate', state: 'pending', attempts: 1 },
];

describe('WorkflowRunProgress (ui.md 4.4b)', () => {
  let fixture: ComponentFixture<WorkflowRunProgress>;
  const el = () => fixture.nativeElement as HTMLElement;

  function mount(steps: ProgressStep[]): void {
    fixture = TestBed.createComponent(WorkflowRunProgress);
    fixture.componentRef.setInput('steps', steps);
    fixture.detectChanges();
  }

  it('marks only the current step aria-current and shows its elapsed seconds', () => {
    mount(STEPS);
    const current = el().querySelectorAll('[aria-current="step"]');
    expect(current.length).toBe(1);
    expect(current[0].getAttribute('data-testid')).toBe(
      'workflow-run-progress-analyse',
    );
    expect(current[0].textContent).toMatch(/\d+ s/);
    expect(
      el()
        .querySelector('[data-testid="workflow-run-progress-plan"]')
        ?.getAttribute('data-state'),
    ).toBe('done');
    expect(
      el()
        .querySelector('[data-testid="workflow-run-progress-validate"]')
        ?.getAttribute('data-state'),
    ).toBe('pending');
  });

  it('shows a waiting step amber, labelled Waiting for you, and no current step', () => {
    mount([
      { id: 'plan', title: 'Plan', state: 'done', attempts: 1 },
      { id: 'clarify', title: 'Clarify', state: 'waiting', attempts: 1 },
    ]);
    const waiting = el().querySelector(
      '[data-testid="workflow-run-progress-clarify"]',
    )!;
    expect(waiting.textContent).toContain('Waiting for you');
    expect(waiting.querySelector('.chip-warning')).not.toBeNull();
    expect(el().querySelector('[aria-current="step"]')).toBeNull();
  });

  it('shows failed and skipped steps with their state and the retry count', () => {
    mount([
      { id: 'a', title: 'A', state: 'failed', attempts: 2 },
      { id: 'b', title: 'B', state: 'skipped', attempts: 1 },
    ]);
    const a = el().querySelector('[data-testid="workflow-run-progress-a"]');
    expect(a?.textContent).toContain('Failed');
    expect(a?.textContent).toContain('×2');
    expect(
      el().querySelector('[data-testid="workflow-run-progress-b"]')?.textContent,
    ).toContain('Skipped');
  });
});
