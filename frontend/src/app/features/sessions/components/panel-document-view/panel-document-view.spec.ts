import { TestBed } from '@angular/core/testing';
import { PanelDocumentView } from './panel-document-view';

describe('PanelDocumentView', () => {
  it('renders Markdown and strips scripts', () => {
    const fixture = TestBed.createComponent(PanelDocumentView);
    fixture.componentRef.setInput(
      'markdown',
      '# Plan\n\n- one\n\n<script>alert(1)</script>',
    );
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('h1')?.textContent).toBe('Plan');
    expect(el.querySelectorAll('li').length).toBe(1);
    expect(el.querySelector('script')).toBeNull();
  });
});
