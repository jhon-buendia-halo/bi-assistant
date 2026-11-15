import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ArtifactSummary } from '../../models/artifact.model';
import { ArtifactsApiService } from '../../services/artifacts-api.service';
import { ArtifactsPage } from './artifacts-page';

function artifact(id: string, name: string, extra = {}): ArtifactSummary {
  return {
    id,
    kind: 'dashboard',
    name,
    description: '',
    widgetCount: 2,
    filterCount: 1,
    hasImage: false,
    createdAt: '2026-11-15T10:00:00.000Z',
    updatedAt: '2026-11-15T10:00:00.000Z',
    ...extra,
  };
}

describe('ArtifactsPage', () => {
  let items: ArtifactSummary[];

  beforeEach(() => {
    items = [
      artifact('a-1', 'Sales overview', { widgetCount: 1, hasImage: true }),
      artifact('a-2', 'Churn board'),
    ];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ArtifactsApiService,
          useValue: {
            list: () => of(items),
            imageUrl: (id: string) => `/artifacts/${id}/image`,
          },
        },
      ],
    });
  });

  function setup() {
    const fixture = TestBed.createComponent(ArtifactsPage);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const text = (el: HTMLElement, testid: string) =>
    el.querySelector(`[data-testid="${testid}"]`)?.textContent?.trim();

  it('renders one card per artifact with its kind, counts and image', () => {
    const { el } = setup();
    expect(el.querySelector('[data-testid="artifacts-list"]')).toBeTruthy();
    expect(text(el, 'artifact-name-a-1')).toBe('Sales overview');
    expect(text(el, 'artifact-kind-a-1')).toBe('Dashboard');
    expect(el.querySelector('[data-testid="artifact-card-a-1"]')?.textContent)
      .toContain('1 widget · 1 filter');
    expect(el.querySelector('[data-testid="artifact-card-a-2"]')?.textContent)
      .toContain('2 widgets · 1 filter');
    expect(el.querySelector('[data-testid="artifact-image-a-1"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="artifact-image-a-2"]')).toBeNull();
  });

  it('opens an artifact from its name', () => {
    const { fixture, el } = setup();
    const opened: string[] = [];
    fixture.componentInstance.openArtifact.subscribe((id) => opened.push(id));
    (
      el.querySelector('[data-testid="artifact-open-a-2"]') as HTMLButtonElement
    ).click();
    expect(opened).toEqual(['a-2']);
  });

  it('filters by the search and says when nothing matches', () => {
    const { fixture, el } = setup();
    const search = el.querySelector(
      '[data-testid="artifact-search"]',
    ) as HTMLInputElement;
    search.value = 'churn';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="artifact-card-a-1"]')).toBeNull();
    expect(el.querySelector('[data-testid="artifact-card-a-2"]')).toBeTruthy();

    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(text(el, 'artifacts-empty')).toBe('No artifacts match "zzz"');
  });

  it('shows the empty state without artifacts', () => {
    items = [];
    const { el } = setup();
    expect(text(el, 'artifacts-empty')).toBe(
      'No artifacts yet — run Dashboard Image to Artifact and save its dashboard.',
    );
    expect(el.querySelector('[data-testid="artifacts-list"]')).toBeNull();
  });
});
