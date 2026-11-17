import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VisualEvent } from '../../../sessions/models/session.model';
import { WorkflowRun } from '../../../workflows/models/workflow.model';
import { RunArtifactCard, artifactKind } from './run-artifact-card';

const VISUAL: VisualEvent = {
  visualId: 'v-1',
  version: 2,
  title: 'Managed Business vs Aetna Client Dashboard',
  action: 'created',
};

describe('RunArtifactCard, a visual a run created, in its thread (visuals R42)', () => {
  let fixture: ComponentFixture<RunArtifactCard>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let events: string[];

  function render(workflowId: string, savedArtifactId: string | null = null) {
    TestBed.configureTestingModule({
      imports: [RunArtifactCard],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(RunArtifactCard);
    fixture.componentRef.setInput('run', {
      id: 'run-1',
      workflowId,
    } as WorkflowRun);
    fixture.componentRef.setInput('visual', VISUAL);
    fixture.componentRef.setInput('savedArtifactId', savedArtifactId);
    events = [];
    fixture.componentInstance.open.subscribe((v) =>
      events.push(`open:${v.visualId}`),
    );
    fixture.componentInstance.mapToData.subscribe((id) =>
      events.push(`map:${id}`),
    );
    fixture.componentInstance.openArtifact.subscribe((id) =>
      events.push(`artifact:${id}`),
    );
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  afterEach(() => http?.verify());

  const q = (id: string) =>
    el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  it('names its kind, title and version, and loads a live preview of that version', () => {
    render('recreate-dashboard');
    const req = http.expectOne(
      (r) =>
        r.url.endsWith('/workflow-runs/run-1/visualizations/v-1') &&
        r.params.get('version') === '2',
    );
    expect(q('run-artifact-preview')?.querySelector('iframe')).toBeNull();
    req.flush({ id: 'v-1', document: '<html><body>Dashboard</body></html>' });
    fixture.detectChanges();

    expect(q('run-artifact-card')?.getAttribute('aria-label')).toBe(
      'Dashboard: Managed Business vs Aetna Client Dashboard',
    );
    expect(q('run-artifact-kind')?.textContent?.trim()).toBe('Dashboard');
    expect(el.textContent).toContain('Mock data');
    expect(q('run-artifact-title')?.textContent?.trim()).toBe(
      'Managed Business vs Aetna Client Dashboard',
    );
    expect(q('run-artifact-version')?.textContent?.trim()).toBe(
      'Created · Version 2',
    );
    const frame = q('run-artifact-preview')!.querySelector('iframe')!;
    expect(frame.getAttribute('tabindex')).toBe('-1');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(q('run-artifact-preview')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('Open, or a click on the preview, opens the visual', () => {
    render('answer-business-question');
    http.expectOne(() => true).flush({ id: 'v-1', document: '' });
    q('run-artifact-open')!.click();
    q('run-artifact-preview')!.click();
    expect(events).toEqual(['open:v-1', 'open:v-1']);
    expect(q('run-artifact-open')?.getAttribute('aria-label')).toBe(
      'Open Managed Business vs Aetna Client Dashboard',
    );
    // Not saved: no Saved to Artifacts, no Map to data; no mock data.
    expect(q('run-artifact-saved')).toBeNull();
    expect(q('run-artifact-map')).toBeNull();
    expect(el.textContent).not.toContain('Mock data');
  });

  it('a saved dashboard says so and offers Map to data and its Artifacts entry', () => {
    render('recreate-dashboard', 'art-9');
    http.expectOne(() => true).flush({ id: 'v-1', document: '' });
    expect(q('run-artifact-saved')?.textContent).toContain(
      'Saved to Artifacts',
    );
    q('run-artifact-map')!.click();
    q('run-artifact-open-saved')!.click();
    expect(events).toEqual(['map:art-9', 'artifact:art-9']);
  });

  it('keeps an icon when the preview cannot load', () => {
    render('answer-business-question');
    http
      .expectOne(() => true)
      .flush('gone', { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
    expect(q('run-artifact-preview')?.querySelector('iframe')).toBeNull();
    expect(
      q('run-artifact-preview')?.querySelector('lucide-angular'),
    ).not.toBeNull();
  });

  it('a report-drawing user journey makes a Report; anything else a Visual', () => {
    expect(artifactKind('consumption-gap-analysis')).toEqual({
      label: 'Report',
      mock: false,
    });
    expect(artifactKind('review-website')).toEqual({
      label: 'Report',
      mock: false,
    });
    expect(artifactKind('recreate-dashboard')).toEqual({
      label: 'Dashboard',
      mock: true,
    });
    expect(artifactKind('answer-business-question')).toEqual({
      label: 'Visual',
      mock: false,
    });
  });
});
