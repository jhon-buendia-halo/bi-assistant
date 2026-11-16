import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkflowRunAttachments } from './workflow-run-attachments';

@Component({
  imports: [WorkflowRunAttachments],
  template: `<app-workflow-run-attachments
    [images]="images()"
    [max]="max()"
    [error]="error()"
    [help]="'Up to 4 images.'"
    (picked)="picked = $event"
    (removed)="removed = $event"
  />`,
})
class Host {
  readonly images = signal<string[]>([]);
  readonly max = signal(4);
  readonly error = signal<string | null>(null);
  picked: File[] = [];
  removed = -1;
}

describe('WorkflowRunAttachments (workflows R35; ui.md 4.4b)', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  const q = (id: string) =>
    fixture.nativeElement.querySelector(
      `[data-testid="${id}"]`,
    ) as HTMLElement | null;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [Host] });
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('offers a paperclip and a hidden multiple file input for images only', () => {
    const attach = q('workflow-input-images-attach')!;
    expect(attach.getAttribute('aria-label')).toBe('Attach images');
    const file = q('workflow-input-images-file') as HTMLInputElement;
    expect(file.multiple).toBeTrue();
    expect(file.hidden).toBeTrue();
    expect(file.accept).toBe('image/png,image/jpeg,image/webp');
    expect(q('workflow-input-images-thumb-0')).toBeNull();
  });

  it('the paperclip opens the picker', () => {
    const file = q('workflow-input-images-file') as HTMLInputElement;
    const click = spyOn(file, 'click');
    q('workflow-input-images-attach')!.click();
    expect(click).toHaveBeenCalled();
  });

  it('reports the files chosen in the picker', () => {
    const file = q('workflow-input-images-file') as HTMLInputElement;
    const data = new DataTransfer();
    data.items.add(new File(['x'], 'a.png', { type: 'image/png' }));
    file.files = data.files;
    file.dispatchEvent(new Event('change'));
    expect(host.picked.map((f) => f.name)).toEqual(['a.png']);
  });

  it('shows a thumbnail with an alt text and a remove button for each image', () => {
    host.images.set([
      'data:image/png;base64,AAAA',
      'data:image/png;base64,BBBB',
    ]);
    fixture.detectChanges();
    const thumb = q('workflow-input-images-thumb-1') as HTMLImageElement;
    expect(thumb.alt).toBe('Reference image 2');
    expect(thumb.src).toBe('data:image/png;base64,BBBB');
    const remove = q('workflow-input-images-remove-0')!;
    expect(remove.getAttribute('aria-label')).toBe('Remove reference image 1');
    remove.click();
    expect(host.removed).toBe(0);
  });

  it('disables the paperclip at the limit', () => {
    host.images.set(Array(4).fill('data:image/png;base64,AAAA'));
    fixture.detectChanges();
    expect(
      (q('workflow-input-images-attach') as HTMLButtonElement).disabled,
    ).toBeTrue();
  });

  it('shows the error and the help', () => {
    host.error.set('Reference images must be at most 4 images');
    fixture.detectChanges();
    expect(q('workflow-input-error-images')!.textContent).toContain(
      'at most 4 images',
    );
    expect(fixture.nativeElement.textContent).toContain('Up to 4 images.');
  });
});
