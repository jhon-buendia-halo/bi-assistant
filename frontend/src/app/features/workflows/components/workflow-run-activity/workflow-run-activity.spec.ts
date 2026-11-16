import { TestBed } from '@angular/core/testing';
import { WorkflowRunActivity } from './workflow-run-activity';

describe('WorkflowRunActivity (ui.md 4.4b)', () => {
  it('is a polite live region that shows the line and follows its changes', () => {
    const fixture = TestBed.createComponent(WorkflowRunActivity);
    fixture.componentRef.setInput('line', 'Planning the analysis…');
    fixture.detectChanges();
    const p = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="workflow-run-activity"]',
    )!;
    expect(p.getAttribute('aria-live')).toBe('polite');
    expect(p.textContent?.trim()).toBe('Planning the analysis…');
    fixture.componentRef.setInput('line', 'Analyse · Counting matches');
    fixture.detectChanges();
    expect(p.textContent?.trim()).toBe('Analyse · Counting matches');
    fixture.componentRef.setInput('line', null);
    fixture.detectChanges();
    expect(p.textContent?.trim()).toBe('');
  });
});
