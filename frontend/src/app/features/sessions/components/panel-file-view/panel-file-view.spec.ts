import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE_URL } from '../../../../core/config/api.config';
import { FilePanelItem } from '../../models/session.model';
import { PanelFileView } from './panel-file-view';

const item = (path: string): FilePanelItem => ({
  id: 'i1',
  kind: 'file',
  title: path,
  shownAt: '2026-10-14T10:00:00Z',
  path,
  bytes: 12,
});

describe('PanelFileView', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  function create(path: string) {
    const fixture = TestBed.createComponent(PanelFileView);
    fixture.componentRef.setInput('sessionId', 's1');
    fixture.componentRef.setInput('item', item(path));
    fixture.detectChanges();
    return fixture;
  }

  const url = `${API_BASE_URL}/sessions/s1/panel-items/i1/file`;

  it('shows Loading file… then a Markdown file as HTML', () => {
    const fixture = create('rfp/1/rfp.md');
    expect(fixture.nativeElement.textContent).toContain('Loading file…');
    http.expectOne(url).flush({
      item: item('rfp/1/rfp.md'),
      contentType: 'text/markdown',
      text: '# Title',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1')?.textContent).toBe(
      'Title',
    );
  });

  it('shows other files in a monospace pre', () => {
    const fixture = create('notes/a.json');
    http.expectOne(url).flush({
      item: item('notes/a.json'),
      contentType: 'application/json',
      text: '{"a":1}',
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('pre')?.textContent).toBe(
      '{"a":1}',
    );
  });

  it('shows the error message', () => {
    const fixture = create('x.md');
    http
      .expectOne(url)
      .flush(
        { message: 'File "x.md" not found in the session workspace' },
        { status: 404, statusText: 'Not Found' },
      );
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[role="alert"]')?.textContent,
    ).toContain('not found');
  });
});
