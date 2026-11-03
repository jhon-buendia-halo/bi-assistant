import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import {
  ReadinessReport,
  ReadinessReportSummary,
} from '../../../sessions/models/readiness.model';
import { ReadinessApiService } from '../../services/readiness-api.service';
import { ReadinessHistory } from './readiness-history';

function summary(id: string, score: number): ReadinessReportSummary {
  return {
    id,
    datasourceId: 'ds',
    datasourceName: 'Claims',
    datasourceKind: 'postgres',
    generatedAt: '2026-11-01T10:00:00Z',
    overallScore: score,
    maturity: 'Defined',
    entityCount: 4,
  };
}

describe('ReadinessHistory', () => {
  let fixture: ComponentFixture<ReadinessHistory>;
  let api: jasmine.SpyObj<ReadinessApiService>;

  async function setup(
    list: ReturnType<ReadinessApiService['list']>,
    current?: string,
  ): Promise<HTMLElement> {
    api = jasmine.createSpyObj('ReadinessApiService', ['list', 'get']);
    api.list.and.returnValue(list);
    await TestBed.configureTestingModule({
      imports: [ReadinessHistory],
      providers: [{ provide: ReadinessApiService, useValue: api }],
    }).compileComponents();
    fixture = TestBed.createComponent(ReadinessHistory);
    fixture.componentRef.setInput('datasourceId', 'ds');
    fixture.componentRef.setInput('currentReportId', current);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function openMenu(el: HTMLElement): void {
    (
      el.querySelector('[data-testid="readiness-history"]') as HTMLElement
    ).click();
    fixture.detectChanges();
  }

  it('lists reports in order, marking the current one', async () => {
    const el = await setup(
      of({ reports: [summary('a', 80), summary('b', 60)] }),
      'a',
    );
    openMenu(el);
    expect(api.list).toHaveBeenCalledWith('ds');
    const items = el.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('80/100');
    expect(items[0].textContent).toContain('Defined');
    expect(items[0].getAttribute('aria-current')).toBe('true');
    expect(items[1].getAttribute('aria-current')).toBeNull();
  });

  it('shows the empty state when only the current report exists', async () => {
    const el = await setup(of({ reports: [summary('a', 80)] }), 'a');
    openMenu(el);
    expect(el.textContent).toContain('No earlier assessments.');
  });

  it('shows the empty state with no reports', async () => {
    const el = await setup(of({ reports: [] }));
    openMenu(el);
    expect(el.textContent).toContain('No earlier assessments.');
  });

  it('shows an error when the list fails', async () => {
    const el = await setup(throwError(() => new Error('boom')));
    openMenu(el);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not load past assessments.',
    );
  });

  it('emits the full report after choosing an earlier one', async () => {
    const el = await setup(
      of({ reports: [summary('a', 80), summary('b', 60)] }),
      'a',
    );
    const full = {
      ...summary('b', 60),
      dimensionScores: [],
      findings: [],
    } as ReadinessReport;
    api.get.and.returnValue(of(full));
    const emitted: ReadinessReport[] = [];
    fixture.componentInstance.openReport.subscribe((r) => emitted.push(r));
    openMenu(el);
    (el.querySelectorAll('[role="menuitem"]')[1] as HTMLElement).click();
    fixture.detectChanges();
    expect(api.get).toHaveBeenCalledWith('b');
    expect(emitted).toEqual([full]);
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });

  it('does not refetch the current report', async () => {
    const el = await setup(
      of({ reports: [summary('a', 80), summary('b', 60)] }),
      'a',
    );
    openMenu(el);
    (el.querySelectorAll('[role="menuitem"]')[0] as HTMLElement).click();
    expect(api.get).not.toHaveBeenCalled();
  });
});
