import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FILE_SOURCES_API, FileSourcesApi } from './file-sources-api';
import { HttpFileSourcesApi } from './http-file-sources-api';

describe('HttpFileSourcesApi', () => {
  let api: FileSourcesApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(FILE_SOURCES_API);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('is the default provider', () => {
    expect(api instanceof HttpFileSourcesApi).toBeTrue();
  });

  it('uploads the raw file with its URI-encoded name', async () => {
    const file = new File([new Uint8Array(4)], 'Ventas 2026 ñ.xlsx');
    const result = api.upload(file);
    const req = http.expectOne('/datasources/files/uploads');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toBe(file);
    expect(req.request.headers.get('Content-Type')).toBe(
      'application/octet-stream',
    );
    expect(req.request.headers.get('X-File-Name')).toBe(
      encodeURIComponent('Ventas 2026 ñ.xlsx'),
    );
    req.flush({ uploadId: 'u1', file: { id: 'f1', uploadId: 'u1' } });
    expect((await result).uploadId).toBe('u1');
  });

  it('shows the server message of a refused upload', async () => {
    const result = api.upload(new File([new Uint8Array(1)], 'a.xls'));
    http.expectOne('/datasources/files/uploads').flush(
      {
        statusCode: 400,
        message: '.xls files are not supported — save the workbook as .xlsx',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await expectAsync(result).toBeRejectedWithError(
      '.xls files are not supported — save the workbook as .xlsx',
    );
  });

  it('falls back to a size message on a bare 413', async () => {
    const result = api.upload(new File([new Uint8Array(1)], 'a.csv'));
    http
      .expectOne('/datasources/files/uploads')
      .flush(null, { status: 413, statusText: 'Payload Too Large' });
    await expectAsync(result).toBeRejectedWithError(
      'File is larger than 200 MB',
    );
  });

  it('previews a saved file by datasource and an unsaved one by upload', async () => {
    const saved = api.preview({
      datasourceId: 'd1',
      fileId: 'f1',
      sheet: 'Sales',
      headerRow: 3,
    });
    const r1 = http.expectOne('/datasources/files/preview');
    expect(r1.request.body).toEqual({
      datasourceId: 'd1',
      fileId: 'f1',
      sheet: 'Sales',
      headerRow: 3,
    });
    r1.flush({ sheet: 'Sales', rows: [] });
    await saved;

    const unsaved = api.preview({ uploadId: 'u1', fileId: 'f1', sheet: 'S' });
    const r2 = http.expectOne('/datasources/files/preview');
    expect(r2.request.body).toEqual({
      uploadId: 'u1',
      fileId: 'f1',
      sheet: 'S',
    });
    r2.flush({ sheet: 'S', rows: [] });
    await unsaved;
  });

  it('discards an upload and tests the file kind through endpoint 16', async () => {
    const done = api.discard('u1');
    const d = http.expectOne('/datasources/files/uploads/u1');
    expect(d.request.method).toBe('DELETE');
    d.flush(null, { status: 204, statusText: 'No Content' });
    await done;

    const checked = api.importAndCheck({ files: [] }, 'ds1');
    const t = http.expectOne('/datasources/test-connection');
    expect(t.request.body).toEqual({
      kind: 'file',
      config: { files: [] },
      id: 'ds1',
    });
    t.flush({ ok: true, message: 'Imported 2 tables · 5 rows' });
    expect(await checked).toEqual({
      ok: true,
      message: 'Imported 2 tables · 5 rows',
    });
  });
});
