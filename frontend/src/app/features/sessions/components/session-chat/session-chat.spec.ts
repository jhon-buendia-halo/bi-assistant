import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ChatMessage, Session } from '../../models/session.model';
import { SessionsApiService } from '../../services/sessions-api.service';
import { SessionChat } from './session-chat';

function sessionWith(message: ChatMessage): Session {
  return {
    id: 'session-1',
    name: 'Session 1',
    datasets: [],
    messages: [
      { role: 'user', content: 'Ask', at: '2026-01-01T00:00:00.000Z' },
      message,
    ],
  };
}

describe('SessionChat past chat (past-chats R66)', () => {
  let fixture: ComponentFixture<SessionChat>;

  async function render(message: ChatMessage): Promise<HTMLElement> {
    await TestBed.configureTestingModule({
      imports: [SessionChat],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(SessionChat);
    fixture.componentRef.setInput('session', sessionWith(message));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const answer: ChatMessage = {
    role: 'assistant',
    content: 'Answer',
    at: '2026-01-01T00:00:01.000Z',
    verified: true,
    data: [
      {
        tool: 'run_readonly_sql',
        input: 'select 1',
        rowCount: 500,
      },
    ],
  };

  // How one answer renders (badges, provenance, reasoning, clarification
  // card) is covered by answer-view.spec.ts; these specs cover the chat.

  it('reads the transcript through the answer view, with no composer, rating, visual generation or welcome', async () => {
    const el = await render(answer);
    expect(el.querySelectorAll('app-answer-view').length).toBe(1);
    expect(
      el
        .querySelector('[title="Matches an approved query"]')
        ?.textContent?.trim(),
    ).toBe('Verified');
    expect(el.querySelector('textarea')).toBeNull();
    expect(el.querySelector('[aria-label="Send message"]')).toBeNull();
    expect(el.querySelector('[aria-label="Careful mode"]')).toBeNull();
    expect(el.querySelector('[aria-label="Deep analysis"]')).toBeNull();
    expect(
      el.querySelector('[aria-label="Save as verified query"]'),
    ).toBeNull();
    expect(el.querySelector('[aria-label="Mark answer as wrong"]')).toBeNull();
    expect(el.textContent).not.toContain('Generate interactive visuals');
    expect(el.querySelector('[data-testid="session-welcome"]')).toBeNull();
  });

  it('lists the questions in the history navigator and copies one', async () => {
    const el = await render(answer);
    expect(el.querySelectorAll('.h-0\\.5').length).toBe(1);
    const clipboard = spyOn(navigator.clipboard, 'writeText').and.resolveTo();
    el.querySelector<HTMLButtonElement>('[title="Copy message"]')!.click();
    expect(clipboard).toHaveBeenCalledWith('Ask');
  });

  it('asks the host to view a visual the chat created', async () => {
    const visual = {
      visualId: 'v1',
      version: 1,
      title: 'Claims',
      action: 'created' as const,
    };
    const card = await render({
      role: 'assistant',
      content: 'Created interactive visual "Claims".',
      at: '2026-01-01T00:00:01.000Z',
      visual,
    });
    const viewed: unknown[] = [];
    fixture.componentInstance.viewVisual.subscribe((v) => viewed.push(v));
    Array.from(card.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'View')!
      .click();
    expect(viewed).toEqual([visual]);
  });
});

describe('SessionChat downloads', () => {
  let fixture: ComponentFixture<SessionChat>;

  const reportMessage: ChatMessage = {
    role: 'assistant',
    content: 'Denials rose to **12.4%**, driven by payer A.',
    at: '2026-01-01T00:00:02.000Z',
    report: {
      jobId: 'job-1',
      title: 'Denial drivers deep dive',
      path: 'reports/job-1.md',
      angles: 4,
    },
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionChat],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  /** Mount the chat over a transcript and return its root element. */
  function mount(messages: ChatMessage[] = []): HTMLElement {
    fixture = TestBed.createComponent(SessionChat);
    fixture.componentRef.setInput('session', {
      id: 'session-1',
      name: 'Session 1',
      datasets: [],
      messages,
    } satisfies Session);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('downloads the report markdown', () => {
    const el = mount([reportMessage]);
    const api = TestBed.inject(SessionsApiService);
    const download = spyOn(api, 'downloadDeepAnalysis').and.returnValue(
      of(new Blob(['# report'], { type: 'text/markdown' })),
    );

    el.querySelector<HTMLButtonElement>(
      '[aria-label="Download report"]',
    )!.click();

    expect(download).toHaveBeenCalledWith('session-1', 'job-1');
  });

  it('renders the RFP package card and downloads the zip and one file', () => {
    const el = mount([
      {
        role: 'assistant',
        content: 'Package ready.',
        at: '2026-01-01T00:00:02.000Z',
        rfpPackage: {
          rfpId: 'rfp-1',
          title: 'Acme RFP',
          files: [
            { name: 'rfp.md', bytes: 10 },
            { name: 'rfp.pdf', bytes: 20 },
          ],
          exportedAt: '2026-01-01T00:00:02.000Z',
        },
      },
    ]);
    const card = el.querySelector('[data-testid="rfp-package-card"]')!;
    expect(card.textContent).toContain('Acme RFP');
    expect(card.textContent).toContain('RFP package · 2 files');
    expect(card.textContent).toContain('Download package (.zip)');
    expect(card.textContent).toContain('Download RFP (PDF)');
    expect(
      card.querySelector('[data-testid="rfp-package-download"]')!.classList,
    ).toContain('btn-secondary');

    const api = TestBed.inject(SessionsApiService);
    const download = spyOn(api, 'downloadRfpPackage').and.returnValue(
      of(new Blob(['x'])),
    );
    card
      .querySelector<HTMLButtonElement>('[data-testid="rfp-package-download"]')!
      .click();
    expect(download).toHaveBeenCalledWith(
      'session-1',
      'rfp-1',
      undefined,
      undefined,
    );
    card
      .querySelector<HTMLButtonElement>(
        '[data-testid="rfp-package-download-pdf"]',
      )!
      .click();
    expect(download).toHaveBeenCalledWith(
      'session-1',
      'rfp-1',
      'rfp.pdf',
      undefined,
    );
    card
      .querySelectorAll<HTMLButtonElement>(
        '[data-testid="rfp-package-file"]',
      )[1]
      .click();
    expect(download).toHaveBeenCalledWith(
      'session-1',
      'rfp-1',
      'rfp.pdf',
      undefined,
    );
    expect(
      card.querySelector('[data-testid="rfp-package-draft-chip"]'),
    ).toBeNull();
  });

  it('renders a draft RFP package card with the Draft chip and downloads the draft (BA-229)', () => {
    const el = mount([
      {
        role: 'assistant',
        content: 'Draft ready.',
        at: '2026-01-01T00:00:02.000Z',
        rfpPackage: {
          rfpId: 'rfp-1',
          title: 'DRAFT — Acme RFP',
          files: [
            { name: 'rfp.md', bytes: 10 },
            { name: 'rfp.pdf', bytes: 20 },
          ],
          exportedAt: '2026-01-01T00:00:02.000Z',
          draft: true,
        },
      },
    ]);
    const card = el.querySelector('[data-testid="rfp-package-card"]')!;
    expect(
      card.querySelector('[data-testid="rfp-package-label"]')!.textContent,
    ).toContain('RFP package (draft) · 2 files');
    const chip = card.querySelector('[data-testid="rfp-package-draft-chip"]')!;
    expect(chip.textContent?.trim()).toBe('Draft');
    expect(chip.classList).toContain('chip-warning');
    expect(card.textContent).toContain('Download draft (.zip)');
    expect(card.textContent).not.toContain('Download package (.zip)');
    expect(card.textContent).toContain('Download draft (PDF)');
    expect(
      card.querySelector('[data-testid="rfp-package-download-pdf"]')!.classList,
    ).toContain('btn-primary');

    const api = TestBed.inject(SessionsApiService);
    const download = spyOn(api, 'downloadRfpPackage').and.returnValue(
      of(new Blob(['x'])),
    );
    card
      .querySelector<HTMLButtonElement>('[data-testid="rfp-package-download"]')!
      .click();
    expect(download).toHaveBeenCalledWith(
      'session-1',
      'rfp-1',
      undefined,
      true,
    );
    card
      .querySelectorAll<HTMLButtonElement>(
        '[data-testid="rfp-package-file"]',
      )[1]
      .click();
    expect(download).toHaveBeenCalledWith(
      'session-1',
      'rfp-1',
      'rfp.pdf',
      true,
    );
  });
});
