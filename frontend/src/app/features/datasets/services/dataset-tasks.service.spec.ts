import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ShellState } from '../../../core/shell/shell-state';
import { DatasetTasksService } from './dataset-tasks.service';
import { Dataset } from './datasets-api.service';

describe('DatasetTasksService.openDatasetTab', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('opens the dataset in the editor on the requested tab, leaving Settings', () => {
    const service = TestBed.inject(DatasetTasksService);
    const shell = TestBed.inject(ShellState);
    shell.settingsOpen.set(true);
    const dataset = { name: 'World Cup', tables: ['a.b.c'] } as Dataset;

    service.openDatasetTab(dataset, 'ontology');

    expect(service.editing()).toBe(dataset);
    expect(service.requestedTab()).toBe('ontology');
    expect(shell.settingsOpen()).toBeFalse();
    expect(shell.mainView()).toBe('dataset-new');
  });
});
