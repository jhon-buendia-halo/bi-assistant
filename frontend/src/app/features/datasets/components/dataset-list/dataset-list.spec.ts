import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BackgroundTasksService } from '../../../../core/background-tasks/background-tasks.service';
import { DatasetTasksService } from '../../services/dataset-tasks.service';
import { DatasetList } from './dataset-list';

const isList = (r: { method: string; url: string }) =>
  r.method === 'GET' && r.url.endsWith('/datasets');
const isCreate = (r: { method: string; url: string }) =>
  r.method === 'POST' && r.url.endsWith('/datasets');

describe('DatasetList background saves', () => {
  let fixture: ComponentFixture<DatasetList>;
  let http: HttpTestingController;
  let tasks: DatasetTasksService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DatasetList],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    tasks = TestBed.inject(DatasetTasksService);
    fixture = TestBed.createComponent(DatasetList);
    fixture.detectChanges();
    http.expectOne(isList).flush({ datasets: [] });
    fixture.detectChanges();
  });

  afterEach(() => {
    // Leave no running task behind: it is shared by the root injector only.
    const service = TestBed.inject(BackgroundTasksService);
    for (const t of service.running()) service.cancel(t.id);
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (id: string) =>
    el().querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  function save(name = 'Sales') {
    return tasks.save({
      name,
      tables: ['main.sales.orders', 'main.sales.items'],
      entities: [],
      datasource: { id: 'ds1', kind: 'postgres', name: 'Warehouse' },
    });
  }

  it('shows a pending row while the save runs and drops it when the list has it', () => {
    save();
    fixture.detectChanges();

    const row = q('dataset-row-pending')!;
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('Sales');
    expect(row.textContent).toContain('Warehouse · 2 entities');
    expect(q('dataset-saving-chip')!.textContent).toContain('Saving… 0:0');
    expect(row.querySelector('button')).toBeNull();

    http.expectOne(isCreate).flush({ ok: true, message: 'Saved' });
    // The list is re-read; the row stays until the new list arrives.
    fixture.detectChanges();
    expect(q('dataset-row-pending')).toBeTruthy();
    http.expectOne(isList).flush({
      datasets: [
        {
          name: 'Sales',
          tables: ['main.sales.orders'],
          updatedAt: '2026-11-01',
        },
      ],
    });
    fixture.detectChanges();

    expect(q('dataset-row-pending')).toBeNull();
    expect(q('dataset-Sales')).toBeTruthy();
  });

  it('keeps a failed save as a row with Retry and Dismiss', () => {
    save();
    http.expectOne(isCreate).flush({ ok: false, message: 'Name taken' });
    http.expectOne(isList).flush({ datasets: [] });
    fixture.detectChanges();

    const failed = q('dataset-row-failed')!;
    expect(failed.textContent).toContain('Name taken');
    expect(q('dataset-row-pending')).toBeNull();

    const buttons = Array.from(failed.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent!.trim())).toEqual([
      'Retry',
      'Dismiss',
    ]);
    buttons[1].click();
    fixture.detectChanges();
    expect(q('dataset-row-failed')).toBeNull();
  });

  it('shows the Saving chip on a row being saved again', () => {
    save('Sales');
    http.expectOne(isCreate).flush({ ok: true, message: 'Saved' });
    http.expectOne(isList).flush({
      datasets: [{ name: 'Sales', tables: [], updatedAt: '2026-11-01' }],
    });
    fixture.detectChanges();
    expect(q('dataset-saving-chip')).toBeNull();

    save('Sales');
    fixture.detectChanges();
    expect(q('dataset-row-pending')).toBeNull();
    expect(q('dataset-Sales')!.textContent).toContain('Saving…');
  });
});
