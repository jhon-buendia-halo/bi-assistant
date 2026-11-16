/**
 * The in-page collector of the Review a Website workflow: one function that
 * runs inside the page (Playwright's `page.evaluate(collectDomSnapshot, args)`)
 * and returns the raw facts the pure rules of ./review-website.checks.ts read.
 * No framework import: Jest loads it directly.
 */
import type { DomSnapshot, SiteScreenName } from './review-website.schemas';

/**
 * Whether a class name looks machine generated (`css-1x2y3z`, `sc-…`, a hash
 * with digits) or cannot go in a selector as is (`md:flex`), so a selector
 * leaves it out. The collector holds a copy of this logic (`generatedClass`):
 * the two must stay in sync.
 */
export function isGeneratedClass(name: string): boolean {
  if (!/^[A-Za-z_][\w-]*$/.test(name)) return true;
  if (/^(css|sc|jsx|emotion|styled|svelte|ng|chakra|mui|Mui)-/.test(name)) {
    return true;
  }
  if (/^_?[A-Za-z0-9]{6,}$/.test(name) && /\d/.test(name)) return true;
  if (/(__|_)[A-Za-z0-9_-]{4,}$/.test(name) && /\d/.test(name)) return true;
  return false;
}

/**
 * Collects the facts of the open page on one screen. It is serialised with
 * `.toString()` and run in the browser, so it is one synchronous function:
 * no module-level name, import or `async` inside it, its helpers are defined
 * in its body.
 */
export function collectDomSnapshot(args: {
  screen: SiteScreenName;
  viewport: { width: number; height: number };
  maxElements: number;
}): DomSnapshot {
  const SCAN_CAP = 5000;
  const vw = args.viewport.width;
  const vh = args.viewport.height;
  const sx = window.scrollX;
  const sy = window.scrollY;

  // A copy of the module-level class test: the two must stay in sync.
  const generatedClass = (name: string): boolean => {
    if (!/^[A-Za-z_][\w-]*$/.test(name)) return true;
    if (/^(css|sc|jsx|emotion|styled|svelte|ng|chakra|mui|Mui)-/.test(name)) {
      return true;
    }
    if (/^_?[A-Za-z0-9]{6,}$/.test(name) && /\d/.test(name)) return true;
    if (/(__|_)[A-Za-z0-9_-]{4,}$/.test(name) && /\d/.test(name)) return true;
    return false;
  };

  const collapse = (value: string | null | undefined): string =>
    (value ?? '').replace(/\s+/g, ' ').trim();

  const isVisible = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      parseFloat(style.opacity) > 0
    );
  };

  const uniqueId = (el: Element): boolean =>
    !!el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1;

  const segment = (el: Element): string => {
    let part = el.tagName.toLowerCase();
    const classes = Array.from(el.classList)
      .filter((name) => !generatedClass(name))
      .slice(0, 2);
    for (const name of classes) part += '.' + CSS.escape(name);
    const parent = el.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter(
        (child) => child.tagName === el.tagName,
      );
      if (same.length > 1)
        part += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
    }
    return part;
  };

  const selectorOf = (el: Element): string => {
    if (uniqueId(el)) return '#' + CSS.escape(el.id);
    const parts: string[] = [];
    let node: Element | null = el;
    while (
      node &&
      node !== document.body &&
      node !== document.documentElement &&
      parts.length < 4
    ) {
      if (parts.length > 0 && uniqueId(node)) {
        parts.unshift('#' + CSS.escape(node.id));
        break;
      }
      parts.unshift(segment(node));
      node = node.parentElement;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  };

  const rectOf = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + sx, y: r.top + sy, width: r.width, height: r.height };
  };

  const INTERACTIVE_ROLES = [
    'button',
    'link',
    'tab',
    'menuitem',
    'checkbox',
    'radio',
    'switch',
  ];
  const isInteractive = (el: Element): boolean => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return el.hasAttribute('href');
    if (tag === 'input') return el.getAttribute('type') !== 'hidden';
    if (['button', 'select', 'textarea', 'summary'].includes(tag)) return true;
    const role = el.getAttribute('role');
    if (role && INTERACTIVE_ROLES.includes(role)) return true;
    const tabindex = el.getAttribute('tabindex');
    return tabindex !== null && parseInt(tabindex, 10) >= 0;
  };

  const isSubmit = (el: Element): boolean => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    if (tag === 'input') return type === 'submit';
    if (tag !== 'button') return false;
    if (type === 'submit') return true;
    return type === '' && el.closest('form') !== null;
  };

  const hasOwnText = (el: Element): boolean =>
    Array.from(el.childNodes).some(
      (node) => node.nodeType === 3 && (node.textContent ?? '').trim() !== '',
    );

  const clipsTextOf = (el: Element): boolean => {
    if (el === document.body || el === document.documentElement) return false;
    if (!hasOwnText(el)) return false;
    const style = getComputedStyle(el);
    const clipped =
      ['hidden', 'clip'].includes(style.overflowX) ||
      ['hidden', 'clip'].includes(style.overflow) ||
      style.textOverflow === 'ellipsis';
    return clipped && el.scrollWidth > el.clientWidth + 1;
  };

  const textOf = (el: Element): string => {
    const html = el as HTMLElement;
    const text =
      collapse(html.innerText) ||
      collapse(el.getAttribute('aria-label')) ||
      collapse(el.getAttribute('alt')) ||
      collapse((el as HTMLInputElement).value);
    return text.slice(0, 120);
  };

  const fixedAncestor = (hit: Element): Element | null => {
    let node: Element | null = hit;
    while (node) {
      const position = getComputedStyle(node).position;
      if (position === 'fixed' || position === 'sticky') return node;
      node = node.parentElement;
    }
    return null;
  };

  const coverage = (el: Element): { fraction: number; by: string | null } => {
    const r = el.getBoundingClientRect();
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) {
      return { fraction: 0, by: null };
    }
    const points: Array<[number, number]> = [
      [r.left + r.width / 2, r.top + r.height / 2],
      [r.left + r.width * 0.25, r.top + r.height * 0.25],
      [r.left + r.width * 0.75, r.top + r.height * 0.25],
      [r.left + r.width * 0.25, r.top + r.height * 0.75],
      [r.left + r.width * 0.75, r.top + r.height * 0.75],
    ];
    let sampled = 0;
    let covered = 0;
    let by: Element | null = null;
    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
      sampled++;
      const hit = document.elementFromPoint(x, y);
      if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
      const fixed = fixedAncestor(hit);
      if (!fixed || fixed.contains(el)) continue;
      covered++;
      if (!by) by = fixed;
    }
    if (sampled === 0) return { fraction: 0, by: null };
    return { fraction: covered / sampled, by: by ? selectorOf(by) : null };
  };

  const all = Array.from(document.querySelectorAll('*')).slice(0, SCAN_CAP);

  // The outermost element that sticks out of the viewport, widest first.
  const overflowing = new Map<Element, number>();
  let widestEl: Element | null = null;
  let widestRight = 0;
  for (const el of all) {
    const rect = el.getBoundingClientRect();
    const right = rect.right + sx;
    if (right <= vw + 1 || !isVisible(el)) continue;
    let skip = false;
    for (let up = el.parentElement; up; up = up.parentElement) {
      const upRight = overflowing.get(up);
      if (upRight !== undefined && upRight >= right) {
        skip = true;
        break;
      }
    }
    overflowing.set(el, right);
    if (!skip && right > widestRight) {
      widestRight = right;
      widestEl = el;
    }
  }

  type Candidate = {
    priority: number;
    element: DomSnapshot['elements'][number];
  };
  const candidates: Candidate[] = [];
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') continue;
    const interactive = isInteractive(el);
    const isImg = tag === 'img';
    let clipsText = false;
    let brokenImage: string | null = null;
    if (isImg) {
      const img = el as HTMLImageElement;
      if (img.complete && img.naturalWidth === 0) {
        brokenImage = img.currentSrc || img.src || null;
      }
    }
    if (!interactive && brokenImage === null) {
      // Cheap test first: clipping needs text of its own.
      if (!hasOwnText(el)) continue;
    }
    if (!isVisible(el)) continue;
    if (!interactive && brokenImage === null) {
      clipsText = clipsTextOf(el);
      if (!clipsText) continue;
    } else if (!isImg) {
      clipsText = clipsTextOf(el);
    }
    let fraction = 0;
    let by: string | null = null;
    if (interactive) {
      const found = coverage(el);
      fraction = found.fraction;
      by = found.by;
    }
    const priority =
      fraction > 0 ? 0 : brokenImage !== null ? 1 : clipsText ? 2 : 3;
    candidates.push({
      priority,
      element: {
        selector: selectorOf(el),
        tag,
        text: textOf(el),
        rect: rectOf(el),
        interactive,
        submit: isSubmit(el),
        clipsText,
        coveredFraction: fraction,
        coveredBy: by,
        brokenImage,
      },
    });
  }
  const elements = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (a, b) =>
        a.candidate.priority - b.candidate.priority || a.index - b.index,
    )
    .slice(0, args.maxElements)
    .map((entry) => entry.candidate.element);

  const body = document.body;
  const docEl = document.documentElement;
  const visibleText = (body ? body.innerText : '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')
    .slice(0, 20000);

  return {
    url: location.href,
    screen: args.screen,
    viewport: args.viewport,
    scrollWidth: Math.max(docEl.scrollWidth, body ? body.scrollWidth : 0),
    scrollHeight: Math.max(docEl.scrollHeight, body ? body.scrollHeight : 0),
    widest: widestEl
      ? {
          selector: selectorOf(widestEl),
          right: widestRight,
          rect: rectOf(widestEl),
        }
      : null,
    elements,
    visibleText,
  };
}
