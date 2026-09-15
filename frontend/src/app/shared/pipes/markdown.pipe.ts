import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

/** Renders assistant markdown (tables, lists, emphasis) as sanitized HTML. */
@Pipe({ name: 'markdown' })
export class MarkdownPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  transform(value: string | null | undefined): SafeHtml {
    const html = marked.parse(value ?? '', { async: false }) as string;
    return this.sanitizer.bypassSecurityTrustHtml(
      DOMPurify.sanitize(html, { USE_PROFILES: { html: true } }),
    );
  }
}
