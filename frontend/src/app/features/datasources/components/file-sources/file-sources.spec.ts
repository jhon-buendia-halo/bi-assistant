import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SourceFile } from '../../models/datasource.model';
import { FileSources } from './file-sources';

const sales: SourceFile = {
  id: 'f1',
  name: 'sales_2026.xlsx',
  format: 'xlsx',
  sizeBytes: 4_400_000,
  sha256: '0'.repeat(64),
  uploadedAt: '2026-11-17T00:00:00.000Z',
  schema: 'sales_2026',
  sheets: [
    {
      sheet: 'Region',
      table: 'region',
      include: true,
      headerRow: 3,
      range: 'A3:H12482',
      excludeLastRow: true,
      allText: false,
      rowCount: 12480,
      warnings: [{ code: 'total-row', row: 12482 }],
    },
    {
      sheet: 'Notes',
      table: 'notes',
      include: false,
      headerRow: 1,
      range: 'A1:A1',
      excludeLastRow: false,
      allText: false,
      warnings: [{ code: 'no-table' }],
    },
  ],
};

describe('FileSources', () => {
  let fixture: ComponentFixture<FileSources>;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FileSources],
    }).compileComponents();
    fixture = TestBed.createComponent(FileSources);
    fixture.componentRef.setInput('files', [sales]);
    fixture.detectChanges();
  });

  it('shows the warning chip on a sheet row and Skipped on a no-table sheet', () => {
    const region = el().querySelector(
      '[data-testid="sheet-row"][data-sheet="Region"]',
    )!;
    expect(
      region.querySelector('[data-testid="sheet-warning"]')?.textContent,
    ).toContain('Last row looks like a total');
    expect(region.textContent).toContain('12,480 rows');
    expect(region.querySelector('[data-testid="sheet-review"]')).not.toBeNull();

    const notes = el().querySelector(
      '[data-testid="sheet-row"][data-sheet="Notes"]',
    )!;
    expect(notes.textContent).toContain('Skipped');
    expect(notes.querySelector('[data-testid="sheet-review"]')).toBeNull();
  });

  it('offers Browse over a hidden file input for .xlsx and .csv', () => {
    const input = el().querySelector<HTMLInputElement>(
      '[data-testid="file-input"]',
    )!;
    expect(input.accept).toBe('.xlsx,.csv');
    expect(input.multiple).toBeTrue();
    expect(el().querySelector('[data-testid="file-browse"]')).not.toBeNull();
  });
});
