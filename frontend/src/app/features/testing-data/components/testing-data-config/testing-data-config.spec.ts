import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { BackgroundTasksService } from '../../../../core/background-tasks/background-tasks.service';
import {
  TestingDataApiService,
  TestingDataFixture,
  TestingDataLoadResult,
} from '../../services/testing-data-api.service';
import { TestingDataConfig } from './testing-data-config';

const FIXTURE: TestingDataFixture = {
  id: 'world-cup',
  name: 'World Cup PostgreSQL',
  description: 'Matches',
  seedable: true,
  schema: 'public',
  defaults: {
    host: 'localhost',
    port: 55432,
    database: 'worldcup',
    user: 'u',
    password: 'p',
    ssl: false,
  },
  status: { loaded: false, requiredCount: 1 },
};

describe('TestingDataConfig', () => {
  let fixture: ComponentFixture<TestingDataConfig>;
  let component: TestingDataConfig;
  let load$: Subject<TestingDataLoadResult>;
  let api: { getStatus: jasmine.Spy; load: jasmine.Spy; remove: jasmine.Spy };

  function create(): void {
    fixture = TestBed.createComponent(TestingDataConfig);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function startLoad(): void {
    component.selectFixture('world-cup');
    component.requestLoad('world-cup');
    component.confirmLoad('world-cup');
    fixture.detectChanges();
  }

  beforeEach(async () => {
    load$ = new Subject<TestingDataLoadResult>();
    api = {
      getStatus: jasmine
        .createSpy('getStatus')
        .and.callFake(() => of({ fixtures: [FIXTURE] })),
      load: jasmine.createSpy('load').and.callFake(() => load$.asObservable()),
      remove: jasmine.createSpy('remove'),
    };
    await TestBed.configureTestingModule({
      imports: [TestingDataConfig],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TestingDataApiService, useValue: api },
      ],
    }).compileComponents();
    create();
  });

  it('starts a testing-data-load task for the fixture', () => {
    startLoad();
    const task = TestBed.inject(BackgroundTasksService).active(
      'testing-data-load',
      'world-cup',
    );
    expect(task?.title).toBe('Loading testing data "World Cup PostgreSQL"');
    expect(component.loadingFor('world-cup')).toBe(true);
  });

  it('keeps showing the load as running after the screen is destroyed and re-created', () => {
    startLoad();
    fixture.destroy();
    create();
    expect(component.loadingFor('world-cup')).toBe(true);
    expect(component.busy('world-cup')).toBe(true);
    expect(api.load.calls.count()).toBe(1);
  });

  it('refreshes the status when the load ends and shows no error on success', () => {
    startLoad();
    const before = api.getStatus.calls.count();
    load$.next({ ok: true, message: 'Loaded' });
    load$.complete();
    expect(component.loadingFor('world-cup')).toBe(false);
    expect(component.errorFor('world-cup')).toBeNull();
    expect(api.getStatus.calls.count()).toBe(before + 1);
  });

  it('shows the error of the latest failed task after the screen is re-created', () => {
    startLoad();
    fixture.destroy();
    load$.next({ ok: false, message: 'Database unreachable' });
    load$.complete();
    create();
    expect(component.loadingFor('world-cup')).toBe(false);
    expect(component.errorFor('world-cup')).toBe('Database unreachable');
  });
});
