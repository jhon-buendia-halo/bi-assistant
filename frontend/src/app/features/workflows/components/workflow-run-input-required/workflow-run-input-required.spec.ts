import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkflowWaitingFor } from '../../models/workflow.model';
import { WorkflowRunInputRequired } from './workflow-run-input-required';

const WAITING: WorkflowWaitingFor = {
  stepId: 'clarify',
  title: 'Clarify',
  question: 'Which World Cup do you mean?',
  options: ['2018', '2022'],
  expiresAt: '2026-11-11T10:30:00.000Z',
};

describe('WorkflowRunInputRequired (ui.md 4.4b waiting card)', () => {
  let fixture: ComponentFixture<WorkflowRunInputRequired>;
  let answered: string[];
  let rerun: string[];
  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(id: string) =>
    el().querySelector<T>(`[data-testid="${id}"]`);

  function mount(waiting: WorkflowWaitingFor): void {
    fixture = TestBed.createComponent(WorkflowRunInputRequired);
    answered = [];
    rerun = [];
    fixture.componentInstance.answered.subscribe((a) => answered.push(a));
    fixture.componentInstance.rerun.subscribe((a) => rerun.push(a));
    fixture.componentRef.setInput('waiting', waiting);
    document.body.appendChild(el());
    fixture.detectChanges();
  }

  afterEach(() => el().remove());

  function type(text: string): void {
    const area = q<HTMLTextAreaElement>('workflow-run-input-answer')!;
    area.value = text;
    area.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('shows the title, the step, the question and one button per option', () => {
    mount(WAITING);
    expect(el().querySelector('h2')?.textContent?.trim()).toBe(
      'Waiting for your answer',
    );
    expect(q('workflow-run-input-step')?.textContent?.trim()).toBe('Clarify');
    expect(q('workflow-run-input-question')?.textContent?.trim()).toBe(
      'Which World Cup do you mean?',
    );
    expect(q('workflow-run-input-option-0')?.textContent?.trim()).toBe('2018');
    expect(q('workflow-run-input-option-1')?.textContent?.trim()).toBe('2022');
    expect(q('workflow-run-input-option-2')).toBeNull();
  });

  it('moves focus to the card when it appears', () => {
    mount(WAITING);
    expect(document.activeElement).toBe(q('workflow-run-input-required'));
  });

  it('sends an option when it is chosen', () => {
    mount(WAITING);
    q<HTMLButtonElement>('workflow-run-input-option-1')!.click();
    expect(answered).toEqual(['2022']);
  });

  it('keeps Continue disabled while the free text is blank, then sends it trimmed', () => {
    mount(WAITING);
    const cont = q<HTMLButtonElement>('workflow-run-input-continue')!;
    expect(cont.disabled).toBeTrue();
    type('   ');
    expect(cont.disabled).toBeTrue();
    type('  the 2014 one ');
    expect(cont.disabled).toBeFalse();
    cont.click();
    expect(answered).toEqual(['the 2014 one']);
  });

  it('works without options, with a free text only', () => {
    mount({ ...WAITING, options: [] });
    expect(q('workflow-run-input-option-0')).toBeNull();
    type('2010');
    q<HTMLButtonElement>('workflow-run-input-continue')!.click();
    expect(answered).toEqual(['2010']);
  });

  it('turns the controls off while the answer is being sent', () => {
    mount(WAITING);
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    expect(
      q<HTMLButtonElement>('workflow-run-input-option-0')!.disabled,
    ).toBeTrue();
    expect(
      q<HTMLTextAreaElement>('workflow-run-input-answer')!.disabled,
    ).toBeTrue();
  });

  it("shows the server's refusal as an alert", () => {
    mount(WAITING);
    fixture.componentRef.setInput('error', 'Answer is required');
    fixture.detectChanges();
    expect(q('workflow-run-input-error')?.getAttribute('role')).toBe('alert');
    expect(q('workflow-run-input-error')?.textContent).toContain(
      'Answer is required',
    );
  });

  it('expired: says it can no longer continue and offers Run again with my answer', () => {
    mount({ ...WAITING, expired: true });
    expect(q('workflow-run-input-expired')?.textContent).toContain(
      'This run can no longer continue.',
    );
    expect(q('workflow-run-input-continue')).toBeNull();
    const again = q<HTMLButtonElement>('workflow-run-input-rerun')!;
    expect(again.textContent?.trim()).toBe('Run again with my answer');
    expect(again.disabled).toBeTrue();
    q<HTMLButtonElement>('workflow-run-input-option-0')!.click();
    fixture.detectChanges();
    expect(answered).toEqual([]);
    expect(
      q<HTMLTextAreaElement>('workflow-run-input-answer')!.value,
    ).toBe('2018');
    expect(again.disabled).toBeFalse();
    again.click();
    expect(rerun).toEqual(['2018']);
  });
});
