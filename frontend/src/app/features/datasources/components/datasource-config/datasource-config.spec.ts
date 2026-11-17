import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DatasourceConfig } from './datasource-config';
import type { Datasource } from '../../models/datasource.model';

describe('DatasourceConfig.startEdit', () => {
  it('throws for an unknown datasource kind instead of editing it as another kind', async () => {
    await TestBed.configureTestingModule({
      imports: [DatasourceConfig],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const component =
      TestBed.createComponent(DatasourceConfig).componentInstance;
    const unknown = {
      id: 'ds-x',
      name: 'X',
      kind: 'excel',
      config: {},
    } as unknown as Datasource;

    expect(() => component.startEdit(unknown)).toThrowError(
      /Unknown datasource kind: excel/,
    );
  });
});
