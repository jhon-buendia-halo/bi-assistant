import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModelVersions } from './model-versions';
import { DataModelApiService } from '../../services/data-model-api.service';
import { DataModelVersion } from '../../models/data-model.model';

function version(n: number, source: DataModelVersion['source']): DataModelVersion {
  return {
    version: n,
    createdAt: '2026-10-11T00:00:00.000Z',
    source,
    yaml: `model: world_cup\nversion: ${n}\n`,
    model: { model: 'world_cup', version: n, entities: [], relationships: [], metrics: [] },
  };
}

describe('ModelVersions', () => {
  let fixture: ComponentFixture<ModelVersions>;
  let revert: jasmine.Spy;

  beforeEach(async () => {
    revert = jasmine.createSpy('revert');
    await TestBed.configureTestingModule({
      imports: [ModelVersions],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: DataModelApiService, useValue: { revert } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ModelVersions);
    fixture.componentRef.setInput('datasetName', 'World Cup Core');
    fixture.componentRef.setInput('versions', [version(1, 'bootstrap'), version(2, 'user')]);
    fixture.componentRef.setInput('currentVersion', 2);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const compareButtons = () => el().querySelectorAll('button[title="Compare"]');

  it('lists the versions newest first, with Revert on the non-current one', () => {
    const rows = Array.from(el().querySelectorAll('[data-testid^="model-version-"]'));
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'model-version-2',
      'model-version-1',
    ]);
    expect(el().querySelector('[data-testid="revert-1"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="revert-2"]')).toBeNull();
    expect(compareButtons().length).toBe(2);
  });

  it('hides Revert but keeps Compare when read-only', () => {
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();
    expect(el().querySelector('[data-testid^="revert-"]')).toBeNull();
    expect(compareButtons().length).toBe(2);

    (compareButtons()[0] as HTMLButtonElement).click();
    (compareButtons()[1] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el().querySelector('[data-testid="model-diff"]')).not.toBeNull();
  });

  it('never calls the revert endpoint when read-only', () => {
    fixture.componentRef.setInput('readOnly', true);
    fixture.detectChanges();
    fixture.componentInstance.revert(1);
    expect(revert).not.toHaveBeenCalled();
  });
});
