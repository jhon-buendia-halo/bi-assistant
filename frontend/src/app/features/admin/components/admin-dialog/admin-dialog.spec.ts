import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AdminDialog } from './admin-dialog';

@Component({
  imports: [AdminDialog],
  template: `
    <button id="opener" type="button" (click)="open.set(true)">Open</button>
    @if (open()) {
      <app-admin-dialog
        title="Add mapping"
        intro="Members of the group get the role from their next request."
        (dismiss)="open.set(false)"
      >
        <label for="first">First</label>
        <input id="first" />
        <ng-container ngProjectAs="[dialogActions]">
          <button id="cancel" type="button" (click)="open.set(false)">Cancel</button>
          <button id="last" type="button">Add</button>
        </ng-container>
      </app-admin-dialog>
    }
  `,
})
class Host {
  readonly open = signal(false);
}

describe('AdminDialog', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const byId = (id: string) => element.querySelector<HTMLElement>(`#${id}`)!;
    return { fixture, element, byId };
  }

  it('is a modal dialog labelled by its title and described by its intro', async () => {
    const { fixture, element, byId } = render();
    byId('opener').focus();
    byId('opener').click();
    fixture.detectChanges();
    await fixture.whenStable();

    const dialog = element.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(
      element.querySelector(`#${dialog.getAttribute('aria-labelledby')}`)?.textContent?.trim(),
    ).toBe('Add mapping');
    expect(
      element.querySelector(`#${dialog.getAttribute('aria-describedby')}`)?.textContent?.trim(),
    ).toBe('Members of the group get the role from their next request.');
    // Focus moves to the first control.
    expect(document.activeElement).toBe(byId('first'));
    fixture.nativeElement.remove();
  });

  it('keeps focus inside and returns it to the opener on Escape', async () => {
    const { fixture, element, byId } = render();
    byId('opener').focus();
    byId('opener').click();
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = element.querySelector('[role="dialog"]')!;

    byId('last').focus();
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(byId('first'));
    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(byId('last'));

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(element.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(byId('opener'));
    fixture.nativeElement.remove();
  });
});
