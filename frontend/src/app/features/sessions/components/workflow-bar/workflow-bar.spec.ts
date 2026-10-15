import { TestBed } from '@angular/core/testing';
import { WorkflowView } from '../../models/session.model';
import { WORKFLOW_BAR_COLLAPSED_KEY, WorkflowBar } from './workflow-bar';

const base: WorkflowView = {
  phases: [
    { number: 1, title: 'Client', skill: 'rfp-client' },
    { number: 2, title: 'Scope' },
    { number: 3, title: 'Pricing' },
    { number: 4, title: 'Review' },
    { number: 5, title: 'Export' },
  ],
  current: 3,
  done: [1],
  source: 'prompt',
  skipped: [2],
};

function create(workflow: Partial<WorkflowView> = {}) {
  const fixture = TestBed.createComponent(WorkflowBar);
  fixture.componentRef.setInput('workflow', { ...base, ...workflow });
  fixture.detectChanges();
  return fixture;
}

function steps(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>('[role="listitem"]')];
}

describe('WorkflowBar', () => {
  beforeEach(() => localStorage.removeItem(WORKFLOW_BAR_COLLAPSED_KEY));
  afterEach(() => localStorage.removeItem(WORKFLOW_BAR_COLLAPSED_KEY));

  it('shows "No workflow yet" with no steps and no fold button when there is no workflow', () => {
    const fixture = TestBed.createComponent(WorkflowBar);
    fixture.componentRef.setInput('workflow', undefined);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(
      el.querySelector('[data-testid="workflow-bar-empty"]')?.textContent,
    ).toContain('No workflow yet');
    expect(steps(el)).toEqual([]);
    expect(el.querySelector('button[aria-label="Hide workflow"]')).toBeNull();
  });

  it('renders the five statuses with a labelled list and aria-current', () => {
    const fixture = create({ done: [1], skipped: [2], current: 3 });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[role="list"]')?.getAttribute('aria-label')).toBe(
      'Workflow',
    );
    expect(steps(el).map((s) => s.getAttribute('data-status'))).toEqual([
      'done',
      'skipped',
      'current',
      'upcoming',
      'upcoming',
    ]);
    expect(steps(el).map((s) => s.getAttribute('aria-current'))).toEqual([
      null,
      null,
      'step',
      null,
      null,
    ]);
    expect(steps(el)[1].querySelector('.line-through')).not.toBeNull();

    const waiting = create({ waiting: true });
    const w = steps(waiting.nativeElement)[2];
    expect(w.getAttribute('data-status')).toBe('waiting');
    expect(w.getAttribute('aria-current')).toBe('step');
    expect(w.querySelector('button')?.getAttribute('title')).toBe(
      'Waiting for you',
    );
  });

  it('counts n/m done without the skipped steps', () => {
    const el: HTMLElement = create().nativeElement;
    expect(el.textContent).toContain('1/4 done');
  });

  it('shows the next-step row only when there is an action or a note, with no Note link', () => {
    expect(
      create().nativeElement.querySelector(
        '[aria-label="What the agent needs now"]',
      ),
    ).toBeNull();
    const fixture = create({ note: 'Pick the **carriers**\nmore text' });
    const row = fixture.nativeElement.querySelector(
      '[aria-label="What the agent needs now"]',
    ) as HTMLElement;
    // No action: the row reads the note's first line as plain text.
    expect(row.querySelector('p')?.textContent).toContain('Your next step:');
    expect(row.querySelector('p')?.textContent).toContain('Pick the carriers');
    expect(row.querySelector('p')?.textContent).not.toContain('more text');
    expect(row.querySelector('strong')).toBeNull();
    expect(row.querySelector('.line-clamp-2')).toBeNull();
    expect(row.textContent).not.toContain('Show more');
    expect(row.querySelector('[data-testid="workflow-bar-note"]')).toBeNull();
  });

  it('keeps the next-step row to one truncated line with the full text as tooltip', () => {
    const long = 'Decide which lines go out. '.repeat(10).trim();
    const fixture = create({
      phases: [{ number: 1, title: 'Pricing', action: long }],
      current: 1,
      done: [],
      skipped: [],
      note: 'A note',
    });
    const el: HTMLElement = fixture.nativeElement;
    const p = el.querySelector(
      '[data-testid="workflow-bar-action"]',
    ) as HTMLElement;
    expect(p.classList).toContain('truncate');
    expect(p.title).toBe('Your next step: ' + long);
  });

  it('reads "All steps done" instead of a next step once every step is done or skipped', () => {
    const fixture = create({
      phases: [
        { number: 1, title: 'Scope', action: 'Pick the scope.' },
        { number: 2, title: 'Report', action: 'Write it.' },
      ],
      current: 2,
      done: [1, 2],
      skipped: [],
      note: 'RFP v2 is final.',
    });
    const el: HTMLElement = fixture.nativeElement;
    expect(
      el.querySelector('[data-testid="workflow-bar-done"]')?.textContent,
    ).toContain('All steps done');
    expect(el.querySelector('[data-testid="workflow-bar-action"]')).toBeNull();
    expect(el.textContent).not.toContain('Your next step:');
  });

  it('opens Details under a sticky header that counts the steps done', () => {
    const fixture = create();
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>(
      '[data-testid="workflow-details-toggle"]',
    )!.click();
    fixture.detectChanges();
    const header = el.querySelector<HTMLElement>(
      '[data-testid="workflow-details-header"]',
    )!;
    expect(header.textContent).toContain('/');
    expect(header.textContent).toContain('done');
    expect(header.classList).toContain('sticky');
  });

  describe('Details', () => {
    const detailed: Partial<WorkflowView> = {
      phases: [
        {
          number: 1,
          title: 'Client',
          action: 'Done action',
          skill: 'rfp-client',
        },
        { number: 2, title: 'Scope', action: 'Skipped action' },
        { number: 3, title: 'Pricing', action: 'Decide which lines go out.' },
        { number: 4, title: 'Review', action: 'Choose the carriers.' },
        { number: 5, title: 'Export' },
      ],
      note: 'Pick **one**',
    };
    const toggle = (el: HTMLElement) =>
      el.querySelector<HTMLButtonElement>(
        '[data-testid="workflow-details-toggle"]',
      )!;
    const panel = (el: HTMLElement) =>
      el.querySelector<HTMLElement>('[data-testid="workflow-details"]');

    it('has a Details button only when there is a workflow', () => {
      const none = TestBed.createComponent(WorkflowBar);
      none.componentRef.setInput('workflow', undefined);
      none.detectChanges();
      expect(toggle(none.nativeElement)).toBeNull();
      const el: HTMLElement = create(detailed).nativeElement;
      const t = toggle(el);
      expect(t.textContent).toContain('Details');
      expect(t.getAttribute('aria-expanded')).toBe('false');
      expect(t.getAttribute('aria-controls')).toBe('workflow-details');
      expect(panel(el)).toBeNull();
    });

    it('opens and closes by the toggle', () => {
      const fixture = create(detailed);
      const el: HTMLElement = fixture.nativeElement;
      toggle(el).click();
      fixture.detectChanges();
      expect(toggle(el).getAttribute('aria-expanded')).toBe('true');
      const p = panel(el)!;
      expect(p.getAttribute('role')).toBe('region');
      expect(p.getAttribute('aria-label')).toBe('Workflow details');
      expect(p.id).toBe('workflow-details');
      toggle(el).click();
      fixture.detectChanges();
      expect(panel(el)).toBeNull();
    });

    it('closes on Escape and on a click outside, not on a click inside', () => {
      const fixture = create(detailed);
      const el: HTMLElement = fixture.nativeElement;
      document.body.appendChild(el);
      toggle(el).click();
      fixture.detectChanges();
      panel(el)!.click();
      fixture.detectChanges();
      expect(panel(el)).not.toBeNull();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      expect(panel(el)).toBeNull();

      toggle(el).click();
      fixture.detectChanges();
      document.body.click();
      fixture.detectChanges();
      expect(panel(el)).toBeNull();
      el.remove();
    });

    it('lists every step with its status, action, skill and the note under the current one', () => {
      const fixture = create(detailed);
      const el: HTMLElement = fixture.nativeElement;
      toggle(el).click();
      fixture.detectChanges();
      const rows = [
        ...el.querySelectorAll<HTMLElement>(
          '[data-testid="workflow-details-step"]',
        ),
      ];
      expect(rows.map((r) => r.getAttribute('data-status'))).toEqual([
        'done',
        'skipped',
        'current',
        'upcoming',
        'upcoming',
      ]);
      expect(rows[0].querySelector('.chip-success')?.textContent).toBe('Done');
      expect(rows[0].textContent).not.toContain('To do');
      expect(rows[0].textContent).toContain('rfp-client');
      expect(rows[1].querySelector('.chip-neutral')?.textContent).toBe(
        'Skipped',
      );
      expect(rows[1].querySelector('.line-through')).not.toBeNull();
      expect(rows[1].textContent).not.toContain('To do');
      expect(rows[2].querySelector('.chip-info')?.textContent).toBe('Current');
      expect(rows[2].textContent).toContain(
        'To do: Decide which lines go out.',
      );
      expect(rows[2].getAttribute('data-current')).toBe('true');
      expect(
        rows[2].querySelector('[data-testid="workflow-details-note"] strong')
          ?.textContent,
      ).toBe('one');
      expect(rows[3].textContent).toContain('To do: Choose the carriers.');
      expect(rows[3].querySelector('.chip')).toBeNull();
      expect(rows[4].textContent).not.toContain('To do');
      expect(
        el.querySelectorAll('[data-testid="workflow-details-note"]').length,
      ).toBe(1);
    });

    it('shows Waiting for you on a waiting step', () => {
      const fixture = create({ ...detailed, waiting: true });
      const el: HTMLElement = fixture.nativeElement;
      toggle(el).click();
      fixture.detectChanges();
      expect(el.querySelector('.chip-warning')?.textContent).toBe(
        'Waiting for you',
      );
    });

    it('opens on the current step, its note included, just under the header', async () => {
      const fixture = create(detailed);
      const el: HTMLElement = fixture.nativeElement;
      toggle(el).click();
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve));
      const box = panel(el)!;
      const current = box.querySelector<HTMLElement>('[data-current="true"]')!;
      const header = box.querySelector<HTMLElement>(
        '[data-testid="workflow-details-header"]',
      )!;
      expect(box.scrollTop).toBe(
        Math.max(0, current.offsetTop - header.offsetHeight - 8),
      );
      expect(current.textContent).toContain('Current');
    });
  });

  describe('compact steps when the row overflows', () => {
    const titles = (el: HTMLElement) =>
      steps(el).map((s) => !s.querySelector('span.hidden') && true);

    function overflowing(...answers: boolean[]) {
      const fixture = create();
      const bar = fixture.componentInstance as unknown as {
        overflows: () => boolean;
        measure: () => void;
      };
      const queue = [...answers];
      bar.overflows = () => queue.shift() ?? false;
      bar.measure();
      fixture.detectChanges();
      return fixture;
    }

    it('shows every title while the row fits', () => {
      const fixture = overflowing(false);
      const el: HTMLElement = fixture.nativeElement;
      expect(fixture.componentInstance.compact()).toBe(false);
      expect(el.querySelectorAll('span.hidden').length).toBe(0);
      expect(
        el.querySelector('[role="list"]')?.getAttribute('data-fade'),
      ).toBeNull();
    });

    it('renders done and skipped steps icon-only, keeping the others titled and their label', () => {
      const fixture = overflowing(true, false);
      const el: HTMLElement = fixture.nativeElement;
      expect(fixture.componentInstance.compact()).toBe(true);
      expect(fixture.componentInstance.fade()).toBe(false);
      const [done, skipped, current, upcoming] = steps(el);
      expect(done.querySelector('span.hidden')).not.toBeNull();
      expect(skipped.querySelector('span.hidden')).not.toBeNull();
      expect(current.querySelector('span.hidden')).toBeNull();
      expect(upcoming.querySelector('span.hidden')).toBeNull();
      const btn = done.querySelector('button')!;
      expect(btn.getAttribute('title')).toBe('Client');
      expect(btn.getAttribute('aria-label')).toBe('Step 1: Client, Done');
      expect(titles(el)).toEqual([false, false, true, true, true]);
    });

    it('fades the right edge when it still overflows', () => {
      const fixture = overflowing(true, true);
      const list = (
        fixture.nativeElement as HTMLElement
      ).querySelector<HTMLElement>('[role="list"]')!;
      expect(fixture.componentInstance.fade()).toBe(true);
      expect(list.getAttribute('data-fade')).toBe('true');
      expect(list.style.maskImage || list.style.webkitMaskImage).toContain(
        'linear-gradient',
      );
    });

    it('goes back to full titles when the room grows', () => {
      const fixture = overflowing(true, true);
      const bar = fixture.componentInstance as unknown as {
        overflows: () => boolean;
        measure: () => void;
      };
      bar.overflows = () => false;
      bar.measure();
      expect(fixture.componentInstance.compact()).toBe(false);
      expect(fixture.componentInstance.fade()).toBe(false);
    });
  });

  it('folds to one line and remembers it in localStorage', () => {
    const fixture = create();
    const el: HTMLElement = fixture.nativeElement;
    const toggle = el.querySelector<HTMLButtonElement>(
      'button[title="Hide workflow"]',
    )!;
    toggle.click();
    fixture.detectChanges();
    expect(localStorage.getItem(WORKFLOW_BAR_COLLAPSED_KEY)).toBe('1');
    expect(el.querySelector('[role="list"]')).toBeNull();
    expect(el.textContent).toContain('Workflow ·');
    expect(el.textContent).toContain('Pricing');
    expect(el.textContent).toContain('1/4');
    expect(el.querySelector('button[title="Show workflow"]')).not.toBeNull();

    // A new bar starts folded.
    const again = create();
    expect(again.nativeElement.querySelector('[role="list"]')).toBeNull();
    again.nativeElement.querySelector('button[title="Show workflow"]').click();
    again.detectChanges();
    expect(localStorage.getItem(WORKFLOW_BAR_COLLAPSED_KEY)).toBe('0');
  });

  it('opens a step popover with status and skill, closes on Escape and backdrop', () => {
    const fixture = create();
    const el: HTMLElement = fixture.nativeElement;
    steps(el)[0].querySelector('button')!.click();
    fixture.detectChanges();
    const pop = el.querySelector('[aria-label="Step details"]')!;
    expect(pop.textContent).toContain('Step 1');
    expect(pop.textContent).toContain('Client');
    expect(pop.querySelector('.chip-success')?.textContent).toBe('Done');
    expect(pop.textContent).toContain('rfp-client');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(el.querySelector('[aria-label="Step details"]')).toBeNull();

    steps(el)[1].querySelector('button')!.click();
    fixture.detectChanges();
    expect(
      el.querySelector('[aria-label="Step details"] .chip-neutral')
        ?.textContent,
    ).toBe('Skipped');
    el.querySelector<HTMLElement>('[aria-label="Close step details"]')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[aria-label="Step details"]')).toBeNull();
  });

  it('shows the first open step as "Your next step:" before the agent marks one', () => {
    const fixture = create({
      phases: [
        { number: 1, title: 'Client', action: 'Pick the client.' },
        { number: 2, title: 'Scope', action: 'Decide the scope.' },
      ],
      current: null,
      done: [],
      skipped: [],
    });
    const action = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="workflow-bar-action"]',
    )!;
    expect(action.textContent).toContain('Your next step:');
    expect(action.textContent).toContain('Pick the client.');
  });

  it('shows "Your next step:" with the current action, and To do tooltips on open steps', () => {
    const fixture = create({
      phases: [
        { number: 1, title: 'Client', action: 'Done action' },
        { number: 2, title: 'Scope', action: 'Skipped action' },
        { number: 3, title: 'Pricing', action: 'Decide which lines go out.' },
        { number: 4, title: 'Review', action: 'Choose the carriers.' },
        { number: 5, title: 'Export' },
      ],
      note: 'Pick **one**',
    });
    const el: HTMLElement = fixture.nativeElement;
    const action = el.querySelector('[data-testid="workflow-bar-action"]')!;
    expect(action.textContent).toContain('Your next step:');
    expect(action.textContent).toContain('Decide which lines go out.');
    expect(action.textContent).not.toContain('Pick');
    const buttons = steps(el).map((s) => s.querySelector('button')!);
    expect(buttons[3].title).toBe('To do: Choose the carriers.');
    expect(buttons[4].title).toBe('Export');
    expect(buttons[0].title).toBe('Client');
    expect(buttons[1].title).toBe('Scope');
    buttons[3].click();
    fixture.detectChanges();
    const pop = el.querySelector('[aria-label="Step details"]')!;
    expect(pop.textContent).toContain('To do');
    expect(pop.textContent).toContain('Choose the carriers.');
    buttons[0].click();
    fixture.detectChanges();
    expect(
      el.querySelector('[aria-label="Step details"]')?.textContent,
    ).not.toContain('Done action');
  });
});
