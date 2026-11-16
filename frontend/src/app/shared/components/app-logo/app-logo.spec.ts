import { TestBed } from '@angular/core/testing';
import { AppLogo } from './app-logo';

describe('AppLogo', () => {
  function render(inputs: { height?: number; mark?: boolean; label?: string } = {}) {
    const fixture = TestBed.createComponent(AppLogo);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('svg') as SVGSVGElement;
  }

  it('draws the HALO wordmark in currentColor, sized by height', () => {
    const svg = render({ height: 14 });
    expect(svg.getAttribute('viewBox')).toBe('0 0 187 46');
    expect(svg.querySelectorAll('path').length).toBe(4);
    expect(svg.getAttribute('height')).toBe('14');
    expect(svg.getAttribute('width')).toBe(String(Math.round((14 * 187) / 46)));
    svg.querySelectorAll('path').forEach((p) => expect(p.getAttribute('fill')).toBe('currentColor'));
  });

  it('draws only the notched O as a square mark', () => {
    const svg = render({ height: 20, mark: true });
    expect(svg.getAttribute('viewBox')).toBe('139 0 48 46');
    expect(svg.querySelectorAll('path').length).toBe(1);
    expect(svg.getAttribute('width')).toBe(String(Math.round((20 * 48) / 46)));
  });

  it('is an image named by its label', () => {
    const svg = render({ label: 'Halo Workbench' });
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Halo Workbench');
  });
});
