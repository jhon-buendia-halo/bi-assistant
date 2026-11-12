import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ToastService } from '../../../../core/toast/toast.service';
import {
  ChatMessage,
  MessageFeedback,
  ReadinessReportRef,
  VisualEvent,
} from '../../models/session.model';
import { AnswerView } from './answer-view';

/**
 * The answer view renders one assistant answer (1.23.13). These specs moved
 * here from `session-chat.spec.ts` with the markup they cover; the chat's
 * spec keeps the wiring (downloads, rating and options reaching the API).
 */
describe('AnswerView', () => {
  let fixture: ComponentFixture<AnswerView>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnswerView],
    }).compileComponents();
  });

  function render(
    message: ChatMessage,
    inputs: Record<string, unknown> = {},
  ): HTMLElement {
    fixture = TestBed.createComponent(AnswerView);
    fixture.componentRef.setInput('message', message);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function button(el: HTMLElement, selector: string): HTMLButtonElement {
    const found = el.querySelector<HTMLButtonElement>(selector);
    if (!found) throw new Error(`No button ${selector}`);
    return found;
  }

  function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
    const found = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === text,
    );
    if (!found) throw new Error(`No button "${text}"`);
    return found;
  }

  const answer: ChatMessage = {
    role: 'assistant',
    content: 'Answer',
    at: '2026-01-01T00:00:01.000Z',
    data: [
      {
        tool: 'run_readonly_sql',
        input: 'select 1',
        rowCount: 500,
      },
    ],
  };

  describe('an answer', () => {
    it('renders the Markdown body next to the sparks mark', () => {
      const el = render({ ...answer, content: 'Denials rose to **12.4%**.' });
      expect(el.querySelector('.prose-dark')?.innerHTML).toContain(
        '<strong>12.4%</strong>',
      );
      expect(
        el.querySelector('img[src="brand/agentic-hub/sparks.svg"]'),
      ).toBeTruthy();
    });

    it('renders the server-built interpretation caption verbatim', () => {
      const line =
        'Computed from 1 query over main.health.claims — 500 rows analyzed.';
      const el = render({ ...answer, interpretation: line });
      const caption = el.querySelector(`[title="${line}"]`);
      expect(caption?.textContent?.trim()).toBe(line);
    });

    it('shows the Verified chip only on verified answers', () => {
      const plain = render(answer);
      expect(
        plain.querySelector('[title="Matches an approved query"]'),
      ).toBeNull();

      const verified = render({ ...answer, verified: true });
      expect(
        verified
          .querySelector('[title="Matches an approved query"]')
          ?.textContent?.trim(),
      ).toBe('Verified');
    });

    it('marks truncated records and offers a copy-SQL button', () => {
      const el = render({
        ...answer,
        data: [{ ...answer.data![0], truncated: true }],
      });
      expect(
        el
          .querySelector(
            '[title="Row cap reached — counts may be incomplete"]',
          )
          ?.textContent?.trim(),
      ).toBe('(truncated)');
      expect(el.querySelector('[aria-label="Copy SQL"]')).toBeTruthy();
      expect(el.textContent).toContain('Data used (1 query)');
      expect(el.textContent).toContain('run_readonly_sql — 500 rows');
    });

    it('renders the cross-check verdict next to the Verified badge', () => {
      const agreed = render({
        ...answer,
        verified: true,
        crossCheck: {
          status: 'agree',
          note: 'independent re-derivation returned the same results',
        },
      });
      const chip = agreed.querySelector(
        '[title="independent re-derivation returned the same results"]',
      );
      expect(chip?.textContent?.trim()).toBe('Cross-checked');
      expect(chip?.className).toContain('text-on-success-soft');
      expect(
        agreed.querySelector('[title="Matches an approved query"]'),
      ).toBeTruthy();

      const differs = render({
        ...answer,
        crossCheck: {
          status: 'disagree',
          note: 'results differ — treat with care',
        },
      });
      const amber = differs.querySelector(
        '[title="results differ — treat with care"]',
      );
      expect(amber?.textContent?.trim()).toBe('Cross-check differs');
      expect(amber?.className).toContain('text-on-warning-soft');

      const failed = render({ ...answer, crossCheck: { status: 'error' } });
      const muted = failed.querySelector('[title="Cross-check failed"]');
      expect(muted?.textContent?.trim()).toBe('Cross-check failed');
      expect(muted?.className).toContain('text-fg-muted');
    });

    it('shows no cross-check chip on an ordinary answer', () => {
      const el = render(answer);
      expect(el.textContent).not.toContain('Cross-check');
    });

    it('narrates how the answer was worked out, step by step', () => {
      const el = render({
        ...answer,
        reasoning: [
          {
            step: 1,
            rationale:
              'There is no direct cost-per-member column, so I first checked how claims are keyed to members.',
            tool: 'describe_table',
            rowCount: 12,
          },
          {
            step: 2,
            rationale:
              'Then I summed paid amounts per member for the plan year.',
            tool: 'run_readonly_sql',
            rowCount: 1240,
          },
          {
            step: 3,
            rationale:
              'I tried splitting by plan tier, but that column is absent.',
            tool: 'run_readonly_sql',
            error: 'column plan_tier not found',
          },
        ],
      });

      expect(el.textContent).toContain('How I worked this out (3 steps)');
      expect(el.textContent).toContain(
        'There is no direct cost-per-member column, so I first checked how claims are keyed to members.',
      );
      expect(el.textContent).toContain('12 rows');
      expect(el.textContent).toContain('1,240 rows');
      expect(el.textContent).toContain('failed — column plan_tier not found');
    });

    it('shows no reasoning block when the answer carries none', () => {
      const el = render(answer);
      expect(el.textContent).not.toContain('How I worked this out');
    });

    it('lists the ontology the answer was produced under', () => {
      const el = render({
        ...answer,
        knowledge: [
          {
            id: 'k1',
            kind: 'term',
            title: 'Active member',
            body: 'A member with a claim in the last 12 months.',
          },
        ],
      });
      expect(el.textContent).toContain('Ontology in context (1)');
      expect(el.textContent).toContain('Active member');
      expect(el.textContent).toContain('all datasets');
    });

    it('explains each query in the data provenance list', () => {
      const el = render({
        ...answer,
        entities: ['main.health.claims'],
        data: [
          {
            ...answer.data![0],
            rationale: 'Counting the claims keyed to a member first.',
            warnings: ['The join may double count.'],
          },
        ],
      });
      expect(el.textContent).toContain('Data entities');
      expect(el.textContent).toContain('main.health.claims');
      expect(el.textContent).toContain(
        'Counting the claims keyed to a member first.',
      );
      expect(el.textContent).toContain('The join may double count.');
    });

    it('copies the answer and the SQL to the clipboard', fakeAsync(() => {
      const toast = TestBed.inject(ToastService);
      const success = spyOn(toast, 'success');
      const write = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
      const el = render(answer);

      button(el, '[title="Copy message"]').click();
      tick();
      expect(write).toHaveBeenCalledWith('Answer');
      expect(success).toHaveBeenCalledWith('Copied to clipboard');

      button(el, '[aria-label="Copy SQL"]').click();
      tick();
      expect(write).toHaveBeenCalledWith('select 1');
      expect(success).toHaveBeenCalledWith('SQL copied to clipboard');
    }));
  });

  describe('the rating', () => {
    it('is hidden unless the host turns it on', () => {
      const el = render(answer);
      expect(el.querySelector('[aria-label="Save as verified query"]')).toBeNull();
    });

    it('is hidden on an answer without data', () => {
      const el = render(
        { ...answer, data: undefined },
        { showRating: true },
      );
      expect(el.querySelector('[aria-label="Save as verified query"]')).toBeNull();
    });

    it('emits the rating and reflects the stored feedback', () => {
      const el = render({ ...answer, feedback: 'up' }, { showRating: true });
      const ratings: MessageFeedback[] = [];
      fixture.componentInstance.rate.subscribe((r) => ratings.push(r));

      const up = button(el, '[aria-label="Save as verified query"]');
      const down = button(el, '[aria-label="Mark answer as wrong"]');
      expect(up.getAttribute('aria-pressed')).toBe('true');
      expect(up.title).toBe('Saved as verified query');
      expect(down.getAttribute('aria-pressed')).toBe('false');

      down.click();
      up.click();
      expect(ratings).toEqual(['down', 'up']);
    });

    it('is disabled while the host persists a rating', () => {
      const el = render(answer, { showRating: true, ratingPending: true });
      expect(
        button(el, '[aria-label="Save as verified query"]').disabled,
      ).toBeTrue();
      expect(
        button(el, '[aria-label="Mark answer as wrong"]').disabled,
      ).toBeTrue();
    });
  });

  describe('Generate interactive visuals', () => {
    it('is offered only when the host asks for it and the answer has text', () => {
      expect(render(answer).textContent).not.toContain(
        'Generate interactive visuals',
      );
      expect(
        render({ ...answer, content: '  ' }, { showGenerateVisual: true })
          .textContent,
      ).not.toContain('Generate interactive visuals');

      const el = render(answer, { showGenerateVisual: true });
      let emitted = 0;
      fixture.componentInstance.generateVisual.subscribe(() => emitted++);
      buttonByText(el, 'Generate interactive visuals').click();
      expect(emitted).toBe(1);
    });

    it('shows the spinner copy and is disabled while generating or busy', () => {
      const generating = render(answer, {
        showGenerateVisual: true,
        visualGenerating: true,
      });
      expect(
        buttonByText(generating, 'Generating interactive visuals…').disabled,
      ).toBeTrue();

      const busy = render(answer, { showGenerateVisual: true, busy: true });
      expect(
        buttonByText(busy, 'Generate interactive visuals').disabled,
      ).toBeTrue();
    });
  });

  describe('the clarification card', () => {
    const clarification: ChatMessage = {
      role: 'assistant',
      content: '',
      at: '2026-01-01T00:00:01.000Z',
      clarification: {
        question: 'Which plan year?',
        options: [
          { label: '2025', description: 'The last full year' },
          { label: '2026' },
        ],
      },
      entities: ['main.health.claims'],
      data: [{ ...answer.data![0], truncated: true }],
    };

    function picks(): string[] {
      const picked: string[] = [];
      fixture.componentInstance.optionPicked.subscribe((p) => picked.push(p));
      return picked;
    }

    it('shows the work collected before the question', () => {
      const el = render(clarification);
      expect(el.textContent).toContain('Which plan year?');
      expect(el.textContent).toContain('The last full year');
      expect(el.textContent).toContain('Data entities');
      expect(el.textContent).toContain('main.health.claims');
      expect(el.textContent).toContain('Data used (1 query)');
      expect(
        el.querySelector(
          '[title="Row cap reached — counts may be incomplete"]',
        ),
      ).toBeTruthy();
      expect(el.querySelector('[aria-label="Copy SQL"]')).toBeTruthy();
    });

    it('disables an older card and hides its footer', () => {
      const el = render(clarification);
      const option = Array.from(el.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('2025'),
      )!;
      expect(option.disabled).toBeTrue();
      expect(el.textContent).not.toContain('Something else');
      expect(el.textContent).not.toContain('Skip');
    });

    it('emits the picked option on the latest card', () => {
      const el = render(clarification, { latest: true });
      const picked = picks();
      Array.from(el.querySelectorAll('button'))
        .find((b) => b.textContent?.includes('2026'))!
        .click();
      expect(picked).toEqual(['2026']);
    });

    it('emits the skip answer', () => {
      const el = render(clarification, { latest: true });
      const picked = picks();
      buttonByText(el, 'Skip').click();
      expect(picked).toEqual(['Skip — proceed with your best judgment.']);
    });

    it('sends a custom answer typed into the card and closes the input', () => {
      const el = render(clarification, { latest: true });
      const picked = picks();
      const toggle = buttonByText(el, 'Something else');
      toggle.click();
      fixture.detectChanges();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(toggle.textContent?.trim()).toBe('Cancel custom answer');

      const field = el.querySelector<HTMLInputElement>(
        '[aria-label="Custom answer"]',
      )!;
      const send = button(el, '[aria-label="Send custom answer"]');
      expect(send.disabled).toBeTrue();
      field.value = '2024 and 2025';
      field.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      fixture.detectChanges();

      expect(picked).toEqual(['2024 and 2025']);
      expect(el.querySelector('[aria-label="Custom answer"]')).toBeNull();
    });

    it('emits nothing while the host is busy', () => {
      const el = render(clarification, { latest: true, busy: true });
      const picked = picks();
      fixture.componentInstance.pick('2025');
      expect(picked).toEqual([]);
      expect(buttonByText(el, 'Skip').disabled).toBeTrue();
    });
  });

  describe('the cards', () => {
    it('renders an old message that carries a deep-analysis report as a plain answer', () => {
      const el = render({
        role: 'assistant',
        content: 'Denials rose to **12.4%**, driven by payer A.',
        at: '2026-01-01T00:00:02.000Z',
        report: {
          jobId: 'job-1',
          title: 'Denial drivers deep dive',
          path: 'reports/job-1.md',
          angles: 4,
        },
      } as ChatMessage);
      expect(el.querySelector('.prose-dark')?.innerHTML).toContain(
        '<strong>12.4%</strong>',
      );
      expect(el.textContent).not.toContain('angles investigated');
      expect(el.querySelector('[aria-label="Download report"]')).toBeNull();
    });

    it('renders an old message that carries an RFP package as plain text', () => {
      const el = render({
        role: 'assistant',
        content: 'The package is ready.',
        at: 'x',
        rfpPackage: { rfpId: 'rfp-1', title: 'Acme', files: [] },
      } as ChatMessage);
      expect(el.textContent).toContain('The package is ready.');
      expect(el.querySelector('[data-testid="rfp-package-card"]')).toBeNull();
    });

    it('renders a visual event card and emits View', () => {
      const visual: VisualEvent = {
        visualId: 'v1',
        version: 2,
        title: 'Claims by month',
        action: 'updated',
      };
      const el = render({
        role: 'assistant',
        content: 'Updated interactive visual "Claims by month".',
        at: 'x',
        visual,
      });
      const views: VisualEvent[] = [];
      fixture.componentInstance.viewVisual.subscribe((v) => views.push(v));
      expect(el.textContent).toContain('Updated');
      expect(el.textContent).toContain('Claims by month');
      expect(el.textContent).toContain('Version 2');
      // The generic event sentence is not repeated as commentary.
      expect(el.querySelector('.prose-dark')).toBeNull();
      buttonByText(el, 'View').click();
      expect(views).toEqual([visual]);
    });

    it('shows the commentary of a visual event when it says more', () => {
      const el = render({
        role: 'assistant',
        content: 'The peak is in **March**.',
        at: 'x',
        visual: { visualId: 'v1', version: 1, title: 'T', action: 'created' },
      });
      expect(el.querySelector('.prose-dark')?.innerHTML).toContain(
        '<strong>March</strong>',
      );
    });

    it('renders the readiness card and emits Open scorecard', () => {
      const readiness: ReadinessReportRef = {
        reportId: 'r1',
        datasourceName: 'Claims warehouse',
        overallScore: 72,
        maturity: 'Managed',
        generatedAt: '2026-01-01T00:00:02.000Z',
      };
      const el = render({
        role: 'assistant',
        content: 'Assessed.',
        at: 'x',
        readinessReport: readiness,
      });
      const opened: ReadinessReportRef[] = [];
      fixture.componentInstance.openScorecard.subscribe((r) => opened.push(r));
      expect(el.querySelector('[data-testid="readiness-card"]')).toBeTruthy();
      button(el, '[data-testid="readiness-open-scorecard"]').click();
      expect(opened).toEqual([readiness]);
    });
  });
});
