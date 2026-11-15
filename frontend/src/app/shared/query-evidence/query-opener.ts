/**
 * What opened the query inspector (a figure chip or a query row), so Escape
 * and Close can give the focus back to it, even when the answer was redrawn
 * meanwhile and the element is gone (plan m1-25 3b).
 */
export interface QueryOpener {
  el: Element;
  /** Finds the same chip or row again by its test id; null when it has none. */
  selector: string | null;
}

export function queryOpenerOf(el: Element): QueryOpener {
  const testid = el.getAttribute('data-testid');
  const query = el.getAttribute('data-query-index');
  return {
    el,
    selector:
      testid === null
        ? null
        : `[data-testid="${testid}"]` +
          (query === null ? '' : `[data-query-index="${query}"]`),
  };
}

/** Focus the opener after the sheet is gone: the element, else its twin in the redrawn answer. */
export function focusQueryOpener(opener: QueryOpener | null): void {
  if (opener === null) return;
  setTimeout(() => {
    const target = opener.el.isConnected
      ? opener.el
      : opener.selector === null
        ? null
        : window.document.querySelector(opener.selector);
    (target as HTMLElement | null)?.focus();
  });
}
