import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { readinessReportRef } from '../../models/readiness.model';
import {
  sampleReadinessPanelItem,
  sampleReadinessReport,
} from '../../models/readiness.testing';
import {
  ChatMessage,
  PanelItemEvent,
  ReadinessReportRef,
  Session,
} from '../../models/session.model';
import { SessionsApiService } from '../../services/sessions-api.service';
import { ReadinessCard } from './readiness-card';
import { SessionChat } from './session-chat';

const ref: ReadinessReportRef = {
  reportId: 'r1',
  datasourceName: 'World Cup',
  overallScore: 82,
  maturity: 'Managed',
  generatedAt: '2026-11-03T10:00:00.000Z',
};

describe('ReadinessCard', () => {
  it('shows the datasource, score and band, and asks to open the scorecard', () => {
    const fixture = TestBed.createComponent(ReadinessCard);
    fixture.componentRef.setInput('report', ref);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const opened = jasmine.createSpy('openScorecard');
    fixture.componentInstance.openScorecard.subscribe(opened);

    expect(el.querySelector('[data-testid="readiness-card"]')).toBeTruthy();
    expect(el.textContent).toContain('World Cup');
    expect(
      el.querySelector('[data-testid="readiness-card-score"]')?.textContent,
    ).toBe('82/100 · Managed');
    expect(el.querySelector('time')?.getAttribute('datetime')).toBe(
      ref.generatedAt,
    );

    const button = el.querySelector<HTMLButtonElement>(
      '[data-testid="readiness-open-scorecard"]',
    )!;
    expect(button.textContent?.trim()).toBe('Open scorecard');
    button.click();
    expect(opened).toHaveBeenCalledTimes(1);
  });
});

describe('SessionChat readiness', () => {
  let fixture: ComponentFixture<SessionChat>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SessionChat],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  function mount(session: Partial<Session> = {}): HTMLElement {
    fixture = TestBed.createComponent(SessionChat);
    fixture.componentRef.setInput('session', {
      id: 'session-1',
      name: 'Data Readiness',
      datasets: ['World Cup'],
      agentKey: 'data-readiness',
      messages: [],
      ...session,
    } satisfies Session);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const answer: ChatMessage = {
    role: 'assistant',
    content: 'The World Cup data scores 82.',
    at: '2026-11-03T10:00:02.000Z',
    readinessReport: ref,
  };

  it('renders the persisted readiness card under the answer', () => {
    const el = mount({
      messages: [
        { role: 'user', content: 'Assess', at: '2026-11-03T10:00:00.000Z' },
        answer,
      ],
    });
    expect(el.textContent).toContain('The World Cup data scores 82.');
    expect(
      el.querySelector('[data-testid="readiness-card-score"]')?.textContent,
    ).toBe('82/100 · Managed');
  });

  it('opens the saved panel item from Open scorecard', () => {
    const saved = sampleReadinessPanelItem('r1');
    const el = mount({
      messages: [answer],
      panelItems: [saved],
    });
    const emitted: PanelItemEvent[] = [];
    fixture.componentInstance.panelItem.subscribe((e) => emitted.push(e));

    el.querySelector<HTMLButtonElement>(
      '[data-testid="readiness-open-scorecard"]',
    )!.click();

    expect(emitted).toEqual([{ item: saved }]);
  });

  it('builds the readiness panel item when the session has none saved', () => {
    const el = mount({ messages: [answer] });
    const emitted: PanelItemEvent[] = [];
    fixture.componentInstance.panelItem.subscribe((e) => emitted.push(e));

    el.querySelector<HTMLButtonElement>(
      '[data-testid="readiness-open-scorecard"]',
    )!.click();

    expect(emitted).toEqual([
      {
        item: {
          id: 'readiness:r1',
          kind: 'readiness',
          title: 'Data readiness — World Cup',
          shownAt: ref.generatedAt,
          reportId: 'r1',
        },
      },
    ]);
  });

  it('shows the scorecard and the card live on a readiness-report event', () => {
    const el = mount();
    const api = TestBed.inject(SessionsApiService);
    const report = sampleReadinessReport();
    const panelItem = sampleReadinessPanelItem('r1');
    spyOn(api, 'streamMessage').and.callFake((_id, _content, handlers) => {
      handlers.onReadinessReport?.({ report, panelItem });
      handlers.onText?.('The World Cup data scores 82.');
      return Promise.resolve();
    });
    const emitted: PanelItemEvent[] = [];
    fixture.componentInstance.panelItem.subscribe((e) => emitted.push(e));

    fixture.componentInstance.draft.set('Assess the readiness of this dataset');
    fixture.componentInstance.send();
    fixture.detectChanges();

    expect(emitted).toEqual([{ item: panelItem }]);
    expect(fixture.componentInstance.streamingReadiness()).toEqual(ref);
    expect(
      el.querySelector('[data-testid="readiness-card-score"]')?.textContent,
    ).toBe('82/100 · Managed');

    // Stopping keeps the card on the rescued answer.
    fixture.componentInstance.stop();
    fixture.detectChanges();
    const last = fixture.componentInstance.messages().at(-1)!;
    expect(last.readinessReport).toEqual(ref);
    expect(fixture.componentInstance.streamingReadiness()).toBeNull();
    expect(
      el.querySelectorAll('[data-testid="readiness-card"]').length,
    ).toBe(1);
  });

  it('reduces a report to the reference the answer carries', () => {
    expect(readinessReportRef(sampleReadinessReport())).toEqual(ref);
  });
});
