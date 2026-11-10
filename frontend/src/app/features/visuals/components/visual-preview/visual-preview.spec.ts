import { TestBed } from '@angular/core/testing';
import { VISUAL_PREVIEW_KEYS } from '../../models/visual-chart.model';
import { VisualPreview } from './visual-preview';

describe('VisualPreview', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VisualPreview],
    }).compileComponents();
  });

  function render(key: string | null): SVGSVGElement {
    const fixture = TestBed.createComponent(VisualPreview);
    fixture.componentRef.setInput('previewKey', key);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector('svg')!;
  }

  it('draws a hidden, text-free svg with shapes for every preview key', () => {
    const drawings = new Set<string>();
    for (const key of VISUAL_PREVIEW_KEYS) {
      const svg = render(key);
      expect(svg).withContext(key).toBeTruthy();
      expect(svg.getAttribute('data-testid')).toBe(`visual-preview-${key}`);
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('viewBox')).toBe('0 0 120 72');
      expect(svg.querySelectorAll('text').length).withContext(key).toBe(0);
      expect(
        svg.querySelectorAll('rect, circle, line, polyline, polygon, path')
          .length,
      )
        .withContext(key)
        .toBeGreaterThan(2);
      drawings.add(svg.innerHTML);
    }
    // Each key has its own drawing.
    expect(drawings.size).toBe(VISUAL_PREVIEW_KEYS.length);
  });

  it('draws the neutral placeholder for none, null and unknown keys', () => {
    for (const key of ['none', null, 'not-a-chart']) {
      const svg = render(key);
      expect(svg.getAttribute('data-testid')).toBe('visual-preview-none');
      expect(svg.querySelector('rect.ax')).toBeTruthy();
    }
  });
});
