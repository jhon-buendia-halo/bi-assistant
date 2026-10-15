import { TestBed } from '@angular/core/testing';
import { knownLinks } from '../../services/prompt-links';
import { LinkedText } from './linked-text';

describe('LinkedText', () => {
  it('renders links as chips and keeps the plain text', () => {
    const fixture = TestBed.createComponent(LinkedText);
    fixture.componentRef.setInput(
      'text',
      'Use [[skill:planner]], [[tool:sample_rows]] and [[skill:gone]].',
    );
    fixture.componentRef.setInput('known', knownLinks([{ name: 'planner' }]));
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.textContent).toBe('Use planner, sample_rows and gone.');
    const chip = (id: string) => el.querySelector(`[data-link="${id}"]`)!;
    expect(chip('skill:planner').className).toContain('chip-info');
    expect(chip('tool:sample_rows').className).toContain('chip-neutral');
    expect(chip('skill:gone').className).toContain('chip-danger');
    expect(chip('skill:gone').getAttribute('title')).toBe('Not found');
    expect(el.textContent).not.toContain('[[');
  });
});
