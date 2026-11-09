import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ToastService } from '../../../../core/toast/toast.service';
import { Datasource } from '../../models/datasource.model';
import { DatasourcesApiService } from '../../services/datasources-api.service';
import { DatasourceConfig } from './datasource-config';

const silver: Datasource = {
  id: 'ds-1',
  name: 'Warehouse',
  kind: 'postgres',
  summary: 'db.example.com/warehouse',
  config: {
    host: 'db.example.com',
    port: 5432,
    database: 'warehouse',
    user: 'reader',
    password: '••••••••',
    ssl: false,
  },
  layer: 'normalized',
  description: 'Silver',
};

describe('DatasourceConfig layer and description', () => {
  let component: DatasourceConfig;
  let fixture: ComponentFixture<DatasourceConfig>;
  let api: jasmine.SpyObj<DatasourcesApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<DatasourcesApiService>('DatasourcesApiService', [
      'list',
      'save',
      'testConnection',
      'delete',
    ]);
    api.list.and.returnValue(of({ datasources: [] }));
    api.save.and.returnValue(of({ ok: true, message: 'Saved' }));
    const toast = jasmine.createSpyObj<ToastService>('ToastService', [
      'success',
      'error',
    ]);

    await TestBed.configureTestingModule({
      imports: [DatasourceConfig],
      providers: [
        { provide: DatasourcesApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DatasourceConfig);
    fixture.detectChanges();
    component = fixture.componentInstance;
  });

  it('the rendered Layer select shows the stored layer when editing', () => {
    component.startEdit(silver);
    fixture.detectChanges();
    const select = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('label'),
    ]
      .find((l) => l.querySelector('.field-label')?.textContent?.trim() === 'Layer')
      ?.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe('normalized');
    const textarea = fixture.nativeElement.querySelector(
      'textarea',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Silver');
  });

  it('a new datasource cannot be saved until tested and named', () => {
    component.startNew();
    expect(component.canSave()).toBeFalse();

    component.name.set('New one');
    expect(component.canSave()).toBeFalse();

    component.testedOk.set(true);
    expect(component.canSave()).toBeTrue();

    component.name.set('');
    expect(component.canSave()).toBeFalse();
  });

  it('startEdit populates layer and description and allows saving untested', () => {
    component.startEdit(silver);

    expect(component.layer()).toBe('normalized');
    expect(component.description()).toBe('Silver');
    expect(component.testedOk()).toBeFalse();
    expect(component.canSave()).toBeTrue();
  });

  it('touching a connection field after startEdit requires a new test', () => {
    component.startEdit(silver);
    component.onFieldChange();

    expect(component.canSave()).toBeFalse();

    component.testedOk.set(true);
    expect(component.canSave()).toBeTrue();
  });

  it('changing layer or description keeps an edit saveable', () => {
    component.startEdit(silver);

    component.layer.set('consumption');
    component.description.set('Gold');

    expect(component.canSave()).toBeTrue();
  });

  it('save sends null layer and description when blank, with the edited id', () => {
    component.startEdit(silver);
    component.layer.set('');
    component.description.set('   ');

    component.save();

    expect(api.save).toHaveBeenCalledTimes(1);
    const input = api.save.calls.mostRecent().args[0];
    expect(input.id).toBe('ds-1');
    expect(input.layer).toBeNull();
    expect(input.description).toBeNull();
  });

  it('save sends the chosen layer and the trimmed description', () => {
    component.startEdit(silver);
    component.layer.set('consumption');
    component.description.set(' Gold ');

    component.save();

    const input = api.save.calls.mostRecent().args[0];
    expect(input.layer).toBe('consumption');
    expect(input.description).toBe('Gold');
  });
});
