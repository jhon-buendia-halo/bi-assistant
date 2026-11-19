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

  describe('approval gate (workflows R44)', () => {
    const GATE: WorkflowWaitingFor = {
      ...WAITING,
      title: 'Plan',
      question: 'Olivia’s plan is ready. Approve it or write what to change.',
      options: ['Approve'],
      review: '## The plan\n\n- **Count** the goals',
    };

    it('shows the approval heading and the review as Markdown, without option buttons', () => {
      mount(GATE);
      expect(el().querySelector('h2')?.textContent?.trim()).toBe(
        'Waiting for your approval',
      );
      expect(q('workflow-run-input-step')?.textContent?.trim()).toBe('Plan');
      expect(q('workflow-run-input-question')?.textContent).toContain(
        'plan is ready',
      );
      const review = q('workflow-run-input-review')!;
      expect(review.querySelector('h2')?.textContent).toBe('The plan');
      expect(review.querySelector('strong')?.textContent).toBe('Count');
      expect(q('workflow-run-input-option-0')).toBeNull();
    });

    it('Approve sends the answer Approve', () => {
      mount(GATE);
      const approve = q<HTMLButtonElement>('workflow-run-input-approve')!;
      expect(approve.textContent?.trim()).toBe('Approve');
      approve.click();
      expect(answered).toEqual(['Approve']);
    });

    it('Ask for changes stays disabled while blank, then sends the typed text', () => {
      mount(GATE);
      const ask = q<HTMLButtonElement>('workflow-run-input-continue')!;
      expect(ask.textContent?.trim()).toBe('Ask for changes');
      expect(el().textContent).toContain('Or say what to change');
      expect(ask.disabled).toBeTrue();
      type('  shorter, please ');
      expect(ask.disabled).toBeFalse();
      ask.click();
      expect(answered).toEqual(['shorter, please']);
    });

    it('turns Approve off while sending', () => {
      mount(GATE);
      fixture.componentRef.setInput('busy', true);
      fixture.detectChanges();
      expect(
        q<HTMLButtonElement>('workflow-run-input-approve')!.disabled,
      ).toBeTrue();
    });

    it('a plain question has no review, no Approve and the old labels', () => {
      mount(WAITING);
      expect(q('workflow-run-input-review')).toBeNull();
      expect(q('workflow-run-input-approve')).toBeNull();
      expect(q('workflow-run-input-continue')?.textContent?.trim()).toBe(
        'Continue',
      );
    });

    it('expired gate: no Approve, Run again with my answer', () => {
      mount({ ...GATE, expired: true });
      expect(q('workflow-run-input-approve')).toBeNull();
      expect(q('workflow-run-input-rerun')).not.toBeNull();
    });
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
    expect(q<HTMLTextAreaElement>('workflow-run-input-answer')!.value).toBe(
      '2018',
    );
    expect(again.disabled).toBeFalse();
    again.click();
    expect(rerun).toEqual(['2018']);
  });

  describe('visual gate (Build visual)', () => {
    const GATE: WorkflowWaitingFor = {
      ...WAITING,
      options: [],
      review: '**Ryan** built a visual: Goals by team',
      visualId: 'vis-1',
    };
    let withImages: { answer: string; images: string[] }[];
    let opened: string[];

    function mountGate(waiting: WorkflowWaitingFor = GATE): void {
      mount(waiting);
      withImages = [];
      opened = [];
      fixture.componentInstance.answeredWithImages.subscribe((a) =>
        withImages.push(a),
      );
      fixture.componentInstance.openVisual.subscribe((id) => opened.push(id));
    }

    async function attach(): Promise<void> {
      const input = el().querySelector<HTMLInputElement>(
        '[data-testid="workflow-input-images-file"]',
      )!;
      const transfer = new DataTransfer();
      transfer.items.add(new File(['x'], 'a.png', { type: 'image/png' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      fixture.detectChanges();
    }

    it('shows Open visual, the image control and the visual wording', () => {
      mountGate();
      expect(q('workflow-run-input-open-visual')).not.toBeNull();
      expect(q('workflow-run-input-images')).not.toBeNull();
      expect(el().textContent).toContain(
        'Or say what to change (a filter, another chart…)',
      );
    });

    it('Open visual emits the visual id', () => {
      mountGate();
      q('workflow-run-input-open-visual')!.click();
      expect(opened).toEqual(['vis-1']);
    });

    it('Ask for changes is enabled with only an image and sends answer "" with it', async () => {
      mountGate();
      expect(
        q<HTMLButtonElement>('workflow-run-input-continue')!.disabled,
      ).toBeTrue();
      await attach();
      expect(
        el().querySelector('[data-testid="workflow-input-images-thumb-0"]'),
      ).not.toBeNull();
      const button = q<HTMLButtonElement>('workflow-run-input-continue')!;
      expect(button.disabled).toBeFalse();
      button.click();
      fixture.detectChanges();
      expect(withImages.length).toBe(1);
      expect(withImages[0].answer).toBe('');
      expect(withImages[0].images.length).toBe(1);
      expect(withImages[0].images[0]).toMatch(/^data:image\/png/);
      expect(
        el().querySelector('[data-testid="workflow-input-images-thumb-0"]'),
      ).toBeNull();
    });

    it('sends the trimmed text with no images', () => {
      mountGate();
      type('  add a filter  ');
      q('workflow-run-input-continue')!.click();
      expect(withImages).toEqual([{ answer: 'add a filter', images: [] }]);
    });

    it('Approve still answers Approve', () => {
      mountGate();
      q('workflow-run-input-approve')!.click();
      expect(answered).toEqual(['Approve']);
    });

    it('a gate without a visual shows neither Open visual nor the images', () => {
      mountGate({ ...GATE, visualId: undefined });
      expect(q('workflow-run-input-open-visual')).toBeNull();
      expect(q('workflow-run-input-images')).toBeNull();
      expect(el().textContent).toContain('Or say what to change');
      expect(el().textContent).not.toContain('a filter, another chart');
    });
  });
});
