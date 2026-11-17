import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SourceFile } from '../../models/datasource.model';
import { FILE_SOURCES_API } from '../../services/file-sources-api';
import { MockFileSourcesApi } from '../../services/mock-file-sources-api';
import { SheetReviewDialog } from './sheet-review-dialog';

const settle = () => new Promise((r) => setTimeout(r, 450));

describe('SheetReviewDialog', () => {
  let fixture: ComponentFixture<SheetReviewDialog>;
  let file: SourceFile;
  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    const api = new MockFileSourcesApi();
    file = (await api.upload(new File([new Uint8Array(10)], 'sales_2026.xlsx')))
      .file;
    TestBed.configureTestingModule({
      imports: [SheetReviewDialog],
      providers: [{ provide: FILE_SOURCES_API, useValue: api }],
    });
    fixture = TestBed.createComponent(SheetReviewDialog);
    fixture.componentRef.setInput('file', file);
    fixture.componentRef.setInput('initialSheet', 'Region');
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
  });

  it('is a labelled modal dialog showing the table key and the grid', () => {
    const dlg = el().querySelector('[data-testid="sheet-review-dialog"]')!;
    expect(dlg.getAttribute('role')).toBe('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(el().querySelector('#sheet-review-title')?.textContent).toContain(
      'Review sheets — sales_2026.xlsx',
    );
    expect(el().querySelector('code')?.textContent).toBe(
      'file.sales_2026.region',
    );
    expect(
      el().querySelector('[data-testid="sheet-review-grid"]'),
    ).not.toBeNull();
  });

  it('sets the header row on a row-number click and Apply emits the change', async () => {
    const applied: SourceFile[] = [];
    fixture.componentInstance.applied.subscribe((f) => applied.push(f));
    el().querySelector<HTMLButtonElement>('[data-row="5"] button')!.click();
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    expect(
      el().querySelector('[data-row="4"]')?.getAttribute('data-excluded'),
    ).toBe('true');
    el()
      .querySelector<HTMLButtonElement>('[data-testid="sheet-review-apply"]')!
      .click();
    expect(applied.length).toBe(1);
    const region = applied[0].sheets.find((s) => s.sheet === 'Region')!;
    expect(region.headerRow).toBe(5);
    expect(region.range.startsWith('A5:')).toBeTrue();
    // The input file is untouched.
    expect(file.sheets[0].headerRow).toBe(3);
  });

  it('closes on Escape and on Cancel without emitting a change', () => {
    let applied = 0;
    let closed = 0;
    fixture.componentInstance.applied.subscribe(() => applied++);
    fixture.componentInstance.closed.subscribe(() => closed++);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    el()
      .querySelector<HTMLButtonElement>('[data-testid="sheet-review-cancel"]')!
      .click();
    expect(closed).toBe(2);
    expect(applied).toBe(0);
  });

  it('keeps Tab and Shift+Tab inside the dialog', () => {
    const panel = el().querySelector<HTMLElement>(
      '[data-testid="sheet-review-dialog"]',
    )!;
    const apply = panel.querySelector<HTMLElement>(
      '[data-testid="sheet-review-apply"]',
    )!;
    apply.focus();
    const forward = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    apply.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBeTrue();
    expect(panel.contains(document.activeElement)).toBeTrue();
    expect(document.activeElement).not.toBe(apply);

    const first = document.activeElement as HTMLElement;
    first.focus();
    const back = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    first.dispatchEvent(back);
    expect(back.defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(apply);
  });
});
