import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../../core/config/api.config';
import { PanelItem, Session } from '../../models/session.model';
import {
  SessionPanel,
  panelDownloadName,
  panelDownloadTitle,
} from './session-panel';

const doc: PanelItem = {
  id: 'd1',
  kind: 'document',
  title: 'Renewal Plan',
  shownAt: '2026-10-14T10:00:00Z',
  markdown: '# Hello',
};
const visual: PanelItem = {
  id: 'visual:v1',
  kind: 'visual',
  title: 'Claims chart',
  shownAt: '2026-10-14T11:00:00Z',
  visualId: 'v1',
};
const session = (over: Partial<Session> = {}): Session => ({
  id: 's1',
  name: 'S',
  datasets: [],
  messages: [],
  ...over,
});

describe('SessionPanel', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  function create(s: Session, item: PanelItem | null) {
    const fixture = TestBed.createComponent(SessionPanel);
    fixture.componentRef.setInput('session', s);
    fixture.componentRef.setInput('item', item);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the empty state when nothing was shown', () => {
    const el: HTMLElement = create(session(), null).nativeElement;
    expect(el.textContent).toContain('Nothing to show yet');
    expect(el.textContent).toContain(
      'The agent can show files, documents, query results and visuals here.',
    );
    expect(el.querySelector('[title="Shown in this session"]')).toBeNull();
  });

  it('has no tracker: a workflow alone leaves the panel empty and out of the menu', () => {
    const fixture = create(
      session({
        workflow: {
          phases: [{ number: 1, title: 'Start' }],
          current: 1,
          done: [],
          source: 'prompt',
          skipped: [],
        },
      }),
      null,
    );
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('app-workflow-tracker')).toBeNull();
    expect(el.textContent).toContain('Nothing to show yet');
    expect(el.textContent).not.toContain('Workflow');
    expect(el.querySelector('[title="Shown in this session"]')).toBeNull();
  });

  it('renders a document with its title and a Download PDF button', () => {
    const el: HTMLElement = create(
      session({ panelItems: [doc] }),
      doc,
    ).nativeElement;
    expect(el.textContent).toContain('Renewal Plan');
    expect(el.querySelector('app-panel-document-view h1')?.textContent).toBe(
      'Hello',
    );
    expect(el.querySelector('[title="Download PDF"]')).not.toBeNull();
    expect(
      el.querySelector('[data-testid="panel-download-menu"]'),
    ).not.toBeNull();
  });

  it('lists the history newest first, with no Workflow entry', () => {
    const fixture = create(
      session({
        panelItems: [doc, visual],
        workflow: {
          phases: [{ number: 1, title: 'A' }],
          current: 1,
          done: [],
          source: 'prompt',
          skipped: [],
        },
      }),
      doc,
    );
    const el: HTMLElement = fixture.nativeElement;
    (
      el.querySelector('[title="Shown in this session"]') as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const entries = [...el.querySelectorAll('.menu-item')].map((b) =>
      b.textContent?.trim(),
    );
    expect(entries.length).toBe(2);
    expect(entries[0]).toContain('Claims chart');
    expect(entries[1]).toContain('Renewal Plan');
    expect(entries.join(' ')).not.toContain('Workflow');
    const picked: PanelItem[] = [];
    fixture.componentInstance.selectItem.subscribe((i) => picked.push(i));
    (el.querySelectorAll('.menu-item')[1] as HTMLButtonElement).click();
    expect(picked).toEqual([doc]);
  });

  it('downloads a document as PDF from the main button', () => {
    const fixture = create(session({ panelItems: [doc] }), doc);
    (
      fixture.nativeElement.querySelector(
        '[title="Download PDF"]',
      ) as HTMLButtonElement
    ).click();
    const req = http.expectOne(
      `${API_BASE_URL}/sessions/s1/panel-items/d1/download?format=pdf`,
    );
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['%PDF']));
  });

  it('offers PDF and Markdown in the chevron menu', () => {
    const fixture = create(session({ panelItems: [doc] }), doc);
    const el: HTMLElement = fixture.nativeElement;
    (
      el.querySelector(
        '[data-testid="panel-download-menu"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const items = [...el.querySelectorAll('[role="menuitem"]')];
    expect(items.map((b) => b.textContent?.trim())).toEqual([
      'PDF (.pdf)',
      'Markdown (.md)',
    ]);
    (items[1] as HTMLButtonElement).click();
    const req = http.expectOne(
      `${API_BASE_URL}/sessions/s1/panel-items/d1/download?format=md`,
    );
    req.flush(new Blob(['# Hello']));
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });

  it('keeps a single Download for a table and a non-markdown file', () => {
    const table: PanelItem = {
      id: 't1',
      kind: 'table',
      title: 'Rows',
      shownAt: '2026-01-01T00:00:01.000Z',
      columns: ['a'],
      rows: [{ a: 1 }],
      rowCount: 1,
      tool: 'show_in_panel',
    } as PanelItem;
    const el: HTMLElement = create(
      session({ panelItems: [table] }),
      table,
    ).nativeElement;
    expect(el.querySelector('[title="Download (.csv)"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="panel-download-menu"]')).toBeNull();
  });

  it('names downloads like the backend does', () => {
    expect(panelDownloadName(doc)).toBe('renewal-plan.pdf');
    expect(panelDownloadName(doc, 'md')).toBe('renewal-plan.md');
    expect(
      panelDownloadName({
        id: 'f',
        kind: 'file',
        title: 'rfp.md',
        shownAt: '',
        path: 'rfp/1/rfp.md',
        bytes: 1,
      }),
    ).toBe('rfp.pdf');
    expect(panelDownloadName(visual)).toBeNull();
    expect(panelDownloadTitle(visual)).toBeNull();
  });
});
