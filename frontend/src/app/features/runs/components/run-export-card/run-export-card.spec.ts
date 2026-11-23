import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../../core/config/api.config';
import { ConversationExportRef } from '../../models/conversation-export.model';
import { RunExportCard, exportSize } from './run-export-card';

const REF: ConversationExportRef = {
  id: 'ex-1',
  title: 'World Cup review',
  createdAt: '2026-11-23T10:00:00Z',
  files: [
    { format: 'pdf', fileName: 'world-cup-review.pdf', bytes: 1_700_000, pages: 12 },
    { format: 'pptx', fileName: 'world-cup-review.pptx', bytes: 820_000, slides: 1 },
  ],
};

describe('RunExportCard', () => {
  let http: HttpTestingController;

  function render(ref: ConversationExportRef = REF) {
    TestBed.configureTestingModule({
      imports: [RunExportCard],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(RunExportCard);
    fixture.componentRef.setInput('export', ref);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  const q = (el: HTMLElement, id: string) =>
    el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  afterEach(() => http?.verify());

  it('names the card by its title and lists each file with its count and size', () => {
    const el = render();
    expect(q(el, 'run-export-card')?.getAttribute('aria-label')).toBe(
      'Export: World Cup review',
    );
    expect(q(el, 'run-export-title')?.textContent?.trim()).toBe(
      'World Cup review',
    );
    expect(q(el, 'run-export-line-pdf')?.textContent?.trim()).toBe(
      'PDF · 12 pages · 1.6 MB',
    );
    expect(q(el, 'run-export-line-pptx')?.textContent?.trim()).toBe(
      'PowerPoint · 1 slide · 801 KB',
    );
  });

  it('says 1 page and 2 slides in the singular and plural', () => {
    const el = render({
      ...REF,
      files: [
        { format: 'pdf', fileName: 'a.pdf', bytes: 500, pages: 1 },
        { format: 'pptx', fileName: 'a.pptx', bytes: 2048, slides: 2 },
      ],
    });
    expect(q(el, 'run-export-line-pdf')?.textContent?.trim()).toBe(
      'PDF · 1 page · 500 B',
    );
    expect(q(el, 'run-export-line-pptx')?.textContent?.trim()).toBe(
      'PowerPoint · 2 slides · 2 KB',
    );
  });

  it('formats sizes', () => {
    expect(exportSize(820 * 1024)).toBe('820 KB');
    expect(exportSize(1.6 * 1024 * 1024)).toBe('1.6 MB');
  });

  it('offers one button per file, with its label', () => {
    const el = render({ ...REF, files: [REF.files[0]] });
    expect(q(el, 'run-export-download-pdf')?.textContent?.trim()).toBe(
      'Download PDF',
    );
    expect(q(el, 'run-export-download-pptx')).toBeNull();
  });

  it('each button downloads its own format and saves it under the file name', () => {
    const el = render();
    const saved: string[] = [];
    spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
    });
    q(el, 'run-export-download-pptx')!.click();
    const req = http.expectOne(
      (r) =>
        r.url === `${API_BASE_URL}/conversation-exports/ex-1/download` &&
        r.params.get('format') === 'pptx',
    );
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x']));
    expect(saved).toEqual(['world-cup-review.pptx']);

    q(el, 'run-export-download-pdf')!.click();
    http
      .expectOne((r) => r.params.get('format') === 'pdf')
      .flush(new Blob(['y']));
    expect(saved).toEqual(['world-cup-review.pptx', 'world-cup-review.pdf']);
  });
});
