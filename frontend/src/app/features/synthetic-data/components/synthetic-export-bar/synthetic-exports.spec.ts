import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ToastService } from '../../../../core/toast/toast.service';
import { SampledProfile } from '../../models/synthetic-data.model';
import {
  fileNameFromDisposition,
  saveFile,
} from '../../services/synthetic-data-api.service';
import { SyntheticDataPanel } from '../synthetic-data-panel/synthetic-data-panel';
import { SyntheticExportBar } from './synthetic-export-bar';
import { SyntheticGenerateForm } from '../synthetic-generate-form/synthetic-generate-form';

function profile(): SampledProfile {
  const now = Date.now();
  const t = (key: string, name: string) => ({
    key,
    namespace: 'public',
    name,
    rowCountEstimate: null,
    sampledRows: 5,
    method: 'full' as const,
    durationMs: 1,
    primaryKey: [],
    uniqueKeys: [],
    columns: [],
  });
  return {
    profileId: 'p1',
    version: 1,
    datasetName: 'World Cup',
    datasourceId: 'ds1',
    datasourceName: 'wc-db',
    dialect: 'postgres',
    generatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 3600000).toISOString(),
    sampleSize: 1000,
    tables: [t('db.public.a', 'a'), t('db.public.b', 'b')],
    relationships: [],
  };
}

/** Error bodies are parsed from a blob, which resolves outside the zone. */
const settle = () => new Promise<void>((r) => setTimeout(r, 30));

const disposition = (name: string) => ({
  'Content-Disposition': `attachment; filename="${name}"`,
});

describe('fileNameFromDisposition', () => {
  it('reads quoted, plain and RFC 5987 names', () => {
    expect(fileNameFromDisposition('attachment; filename="a-b.sql"')).toBe(
      'a-b.sql',
    );
    expect(fileNameFromDisposition('attachment; filename=x.zip')).toBe('x.zip');
    expect(
      fileNameFromDisposition("attachment; filename*=UTF-8''caf%C3%A9.xlsx"),
    ).toBe('café.xlsx');
    expect(fileNameFromDisposition(null)).toBeNull();
  });
});

describe('SyntheticGenerateForm', () => {
  let fixture: ComponentFixture<SyntheticGenerateForm>;
  let http: HttpTestingController;
  let toast: ToastService;
  let expiredCount: number;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SyntheticGenerateForm],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(ToastService);
    spyOn(toast, 'success');
    fixture = TestBed.createComponent(SyntheticGenerateForm);
    expiredCount = 0;
    fixture.componentInstance.expired.subscribe(() => expiredCount++);
    fixture.componentRef.setInput('profile', profile());
    fixture.detectChanges();
    // Downloads must not touch the real DOM link.
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    spyOn(URL, 'revokeObjectURL');
    spyOn(HTMLAnchorElement.prototype, 'click');
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector(`[data-testid="${id}"]`) as T | null;
  const type = (id: string, value: string) => {
    const input = q<HTMLInputElement>(id)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const pick = (value: string) => {
    const select = q<HTMLSelectElement>('synth-format')!;
    select.value = value;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };
  const scripts = () =>
    http.expectOne((r) => r.url.endsWith('/synthetic-data/scripts'));

  it('shows the defaults', () => {
    expect(q<HTMLInputElement>('synth-rows-db.public.a')!.value).toBe('100');
    expect(q<HTMLInputElement>('synth-seed')!.value).toBe('1');
    expect(q<HTMLInputElement>('synth-target-schema')!.value).toBe('synthetic');
    expect(q<HTMLInputElement>('synth-include-constraints')!.checked).toBe(
      true,
    );
    expect(el().textContent).toContain(
      'Same profile and seed give the same script.',
    );
    const options = Array.from(
      q<HTMLSelectElement>('synth-format')!.options,
    ).map((o) => o.textContent!.trim());
    expect(options).toEqual(['SQL script', 'CSV (zip)', 'Excel (.xlsx)']);
  });

  it('the button label follows the format and constraints are SQL only', () => {
    expect(q('synth-generate')!.textContent).toContain('Generate .sql');
    pick('csv');
    expect(q('synth-generate')!.textContent).toContain('Generate .zip');
    expect(q<HTMLInputElement>('synth-include-constraints')!.disabled).toBe(
      true,
    );
    pick('xlsx');
    expect(q('synth-generate')!.textContent).toContain('Generate .xlsx');
    pick('sql');
    expect(q<HTMLInputElement>('synth-include-constraints')!.disabled).toBe(
      false,
    );
  });

  it('validates rows from 1 to 10,000 and disables Generate', () => {
    type('synth-rows-db.public.a', '0');
    expect(q('synth-rows-error-db.public.a')!.textContent).toContain(
      'Row counts must be whole numbers from 1 to 10,000',
    );
    expect(q<HTMLButtonElement>('synth-generate')!.disabled).toBe(true);
    type('synth-rows-db.public.a', '10001');
    expect(q<HTMLButtonElement>('synth-generate')!.disabled).toBe(true);
    type('synth-rows-db.public.a', '10000');
    expect(q('synth-rows-error-db.public.a')).toBeNull();
    expect(q<HTMLButtonElement>('synth-generate')!.disabled).toBe(false);
  });

  it('Apply copies the All tables value into every table', () => {
    type('synth-rows-all', '250');
    q('synth-rows-apply')!.click();
    fixture.detectChanges();
    expect(q<HTMLInputElement>('synth-rows-db.public.a')!.value).toBe('250');
    expect(q<HTMLInputElement>('synth-rows-db.public.b')!.value).toBe('250');
  });

  it('sends format, rowCounts, seed, targetSchema and includeConstraints, then downloads', () => {
    type('synth-rows-db.public.a', '7');
    type('synth-seed', '42');
    type('synth-target-schema', 'demo');
    q('synth-include-constraints')!.click();
    fixture.detectChanges();
    q('synth-generate')!.click();
    fixture.detectChanges();
    expect(q<HTMLButtonElement>('synth-generate')!.disabled).toBe(true);

    const req = scripts();
    expect(req.request.method).toBe('POST');
    expect(req.request.responseType).toBe('blob');
    expect(req.request.body).toEqual({
      profileId: 'p1',
      format: 'sql',
      rowCounts: { 'db.public.a': 7, 'db.public.b': 100 },
      seed: 42,
      targetSchema: 'demo',
      includeConstraints: false,
    });
    req.flush(new Blob(['select 1']), {
      headers: disposition('wc-synthetic-postgresql-seed42.sql'),
    });
    fixture.detectChanges();

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(
      'Downloaded wc-synthetic-postgresql-seed42.sql',
    );
    expect(q<HTMLButtonElement>('synth-generate')!.disabled).toBe(false);
  });

  it('sends the chosen format', () => {
    pick('xlsx');
    q('synth-generate')!.click();
    expect(scripts().request.body.format).toBe('xlsx');
  });

  it('a 404 emits expired and shows no inline error', async () => {
    q('synth-generate')!.click();
    scripts().flush(
      new Blob([
        JSON.stringify({
          statusCode: 404,
          message:
            'Profile "p1" expired or not found: profile the tables again',
          error: 'Not Found',
        }),
      ]),
      { status: 404, statusText: 'Not Found' },
    );
    await settle();
    fixture.detectChanges();
    expect(expiredCount).toBe(1);
    expect(q('synth-generate-error')).toBeNull();
  });

  it('a 400 shows the server text under the form', async () => {
    q('synth-generate')!.click();
    scripts().flush(
      new Blob([
        JSON.stringify({
          statusCode: 400,
          message:
            'targetSchema must be a plain identifier (letters, digits, underscores)',
          error: 'Bad Request',
        }),
      ]),
      { status: 400, statusText: 'Bad Request' },
    );
    await settle();
    fixture.detectChanges();
    expect(q('synth-generate-error')!.textContent).toContain(
      'targetSchema must be a plain identifier (letters, digits, underscores)',
    );
    expect(expiredCount).toBe(0);
  });
});

describe('SyntheticExportBar', () => {
  let fixture: ComponentFixture<SyntheticExportBar>;
  let http: HttpTestingController;
  let toast: ToastService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SyntheticExportBar],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(ToastService);
    spyOn(toast, 'success');
    spyOn(URL, 'createObjectURL').and.returnValue('blob:x');
    spyOn(URL, 'revokeObjectURL');
    spyOn(HTMLAnchorElement.prototype, 'click');
    fixture = TestBed.createComponent(SyntheticExportBar);
    fixture.componentRef.setInput('profile', profile());
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (id: string) =>
    el().querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const click = (id: string) => {
    q(id)!.click();
    fixture.detectChanges();
  };

  it('Export profile menu offers CSV and Excel and posts the format', () => {
    click('synth-export-profile');
    expect(q('synth-export-profile-csv')!.textContent).toContain('CSV');
    expect(q('synth-export-profile-xlsx')!.textContent).toContain('Excel');
    click('synth-export-profile-xlsx');
    const req = http.expectOne((r) =>
      r.url.endsWith('/synthetic-data/profile-exports'),
    );
    expect(req.request.body).toEqual({ profileId: 'p1', format: 'xlsx' });
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x']), {
      headers: disposition('world-cup-profile.xlsx'),
    });
    expect(toast.success).toHaveBeenCalledWith(
      'Downloaded world-cup-profile.xlsx',
    );
  });

  it('Export sample rows asks first and Cancel sends nothing', () => {
    click('synth-export-sample');
    expect(q('synth-export-sample-sql')!.textContent).toContain('SQL script');
    expect(q('synth-export-sample-csv')!.textContent).toContain('CSV (zip)');
    expect(q('synth-export-sample-xlsx')!.textContent).toContain(
      'Excel (.xlsx)',
    );
    click('synth-export-sample-csv');

    const dialog = q('synth-confirm-real-data')!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.textContent).toContain(
      'This file contains real rows from wc-db, including identifiers, names and free text. Export anyway?',
    );
    http.expectNone((r) => r.url.endsWith('/synthetic-data/sample-exports'));
    click('synth-confirm-cancel');
    expect(q('synth-confirm-real-data')).toBeNull();
    http.expectNone((r) => r.url.endsWith('/synthetic-data/sample-exports'));
  });

  it('Escape cancels the dialog', () => {
    click('synth-export-sample');
    click('synth-export-sample-sql');
    q('synth-confirm-real-data')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    expect(q('synth-confirm-real-data')).toBeNull();
  });

  it('Export in the dialog sends confirmRealData: true and the format', () => {
    click('synth-export-sample');
    click('synth-export-sample-csv');
    click('synth-confirm-export');
    const req = http.expectOne((r) =>
      r.url.endsWith('/synthetic-data/sample-exports'),
    );
    expect(req.request.body).toEqual({
      profileId: 'p1',
      format: 'csv',
      confirmRealData: true,
    });
    req.flush(new Blob(['z']), {
      headers: disposition('world-cup-sample-csv.zip'),
    });
    expect(toast.success).toHaveBeenCalledWith(
      'Downloaded world-cup-sample-csv.zip',
    );
  });

  it('shows the server text of a 400', async () => {
    click('synth-export-profile');
    click('synth-export-profile-csv');
    http
      .expectOne((r) => r.url.endsWith('/synthetic-data/profile-exports'))
      .flush(
        new Blob([JSON.stringify({ message: 'format must be csv or xlsx' })]),
        {
          status: 400,
          statusText: 'Bad Request',
        },
      );
    await settle();
    fixture.detectChanges();
    expect(q('synth-export-error')!.textContent).toContain(
      'format must be csv or xlsx',
    );
  });
});

describe('SyntheticDataPanel expired profile', () => {
  it('shows the expired message and focuses the Profile button', async () => {
    await TestBed.configureTestingModule({
      imports: [SyntheticDataPanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(SyntheticDataPanel);
    fixture.componentRef.setInput('dataset', {
      name: 'World Cup',
      datasourceId: 'ds1',
      datasourceKind: 'postgres',
      tables: ['db.public.a'],
    });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const q = (id: string) =>
      el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    document.body.appendChild(el);
    q('synth-profile')!.click();
    http
      .expectOne((r) => r.url.endsWith('/synthetic-data/profiles'))
      .flush(profile());
    fixture.detectChanges();
    q('synth-generate')!.click();
    http
      .expectOne((r) => r.url.endsWith('/synthetic-data/scripts'))
      .flush(new Blob(['{}']), { status: 404, statusText: 'Not Found' });
    await settle();
    fixture.detectChanges();
    expect(q('synth-expired')!.textContent).toContain(
      'This profile expired. Profile the tables again.',
    );
    await new Promise((r) => setTimeout(r));
    expect(document.activeElement).toBe(q('synth-profile'));
    el.remove();
  });
});

describe('saveFile', () => {
  it('clicks a temporary link named after the file', () => {
    spyOn(URL, 'createObjectURL').and.returnValue('blob:y');
    spyOn(URL, 'revokeObjectURL');
    let name = '';
    spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (
      this: HTMLAnchorElement,
    ) {
      name = this.download;
    });
    saveFile({ blob: new Blob(['x']), fileName: 'f.sql' });
    expect(name).toBe('f.sql');
  });
});
