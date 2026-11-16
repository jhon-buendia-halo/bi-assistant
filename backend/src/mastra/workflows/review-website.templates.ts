/**
 * Page templates of the Review a Website workflow (agents.md 5.19): grouping
 * the crawled pages by URL pattern or page structure, choosing the one page
 * Iris reviews per template, and the question asked when the review is big.
 * Pure code, no framework import.
 */
import type { DiscoveredPage, PageTemplate } from './review-website.schemas';

/** More templates than this and the user is asked before Iris reviews them. */
export const REVIEW_ASK_THRESHOLD = 10;

/** Whether the page loaded: no error and no HTTP error status. */
function loaded(page: DiscoveredPage): boolean {
  return page.error === null && (page.status === null || page.status < 400);
}

/**
 * Groups pages into templates: two pages share a template when they share a
 * URL pattern or a non-empty structure fingerprint (directly or through other
 * pages). Returns the pages with `group` set to their template's id, and the
 * templates, biggest first.
 */
export function groupTemplates(pages: readonly DiscoveredPage[]): {
  pages: DiscoveredPage[];
  templates: PageTemplate[];
} {
  const parent = pages.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    let node = i;
    while (parent[node] !== root) {
      const next = parent[node];
      parent[node] = root;
      node = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    // Keep the earlier page as the root so members stay in crawl order.
    if (ra < rb) parent[rb] = ra;
    else if (rb < ra) parent[ra] = rb;
  };

  const byGroup = new Map<string, number>();
  const byFingerprint = new Map<string, number>();
  pages.forEach((page, i) => {
    const sameGroup = byGroup.get(page.group);
    if (sameGroup === undefined) byGroup.set(page.group, i);
    else union(sameGroup, i);
    if (page.fingerprint !== '') {
      const sameShape = byFingerprint.get(page.fingerprint);
      if (sameShape === undefined) byFingerprint.set(page.fingerprint, i);
      else union(sameShape, i);
    }
  });

  const members = new Map<number, number[]>();
  pages.forEach((_, i) => {
    const root = find(i);
    const list = members.get(root);
    if (list) list.push(i);
    else members.set(root, [i]);
  });

  const ids = new Map<number, string>();
  const built: Array<{ template: PageTemplate; first: number }> = [];
  for (const [root, indexes] of members) {
    const counts = new Map<string, number>();
    for (const i of indexes) {
      counts.set(pages[i].group, (counts.get(pages[i].group) ?? 0) + 1);
    }
    let id = pages[indexes[0]].group;
    let best = 0;
    for (const [group, count] of counts) {
      if (count > best) {
        best = count;
        id = group;
      }
    }
    ids.set(root, id);
    const representative = indexes.find((i) => loaded(pages[i])) ?? indexes[0];
    built.push({
      template: {
        id,
        pages: indexes.map((i) => pages[i].url),
        representative: pages[representative].url,
      },
      first: indexes[0],
    });
  }
  built.sort(
    (a, b) =>
      b.template.pages.length - a.template.pages.length || a.first - b.first,
  );
  return {
    pages: pages.map((page, i) => ({ ...page, group: ids.get(find(i)) ?? '' })),
    templates: built.map((entry) => entry.template),
  };
}

/**
 * Which templates Iris reviews and whether to ask first: none when the visual
 * review is off, else every template whose representative loaded; ask when
 * there are more than `REVIEW_ASK_THRESHOLD`.
 */
export function reviewPlan(
  templates: readonly PageTemplate[],
  visualReview: boolean,
  pages: readonly DiscoveredPage[],
): { reviewTemplates: string[]; askBeforeReview: boolean } {
  if (!visualReview) return { reviewTemplates: [], askBeforeReview: false };
  const byUrl = new Map(pages.map((page) => [page.url, page]));
  const reviewTemplates = templates
    .filter((template) => {
      const page = byUrl.get(template.representative);
      return page !== undefined && loaded(page);
    })
    .map((template) => template.id);
  return {
    reviewTemplates,
    askBeforeReview: reviewTemplates.length > REVIEW_ASK_THRESHOLD,
  };
}

/** The question the waiting Confirm review step asks, with its options. */
export function reviewQuestion(
  templates: readonly PageTemplate[],
  reviewTemplates: readonly string[],
  pageCount: number,
): { question: string; options: string[] } {
  void templates;
  const n = reviewTemplates.length;
  const k = REVIEW_ASK_THRESHOLD;
  const options = [`Review all ${n} templates`];
  if (n > k) options.push(`Only the ${k} biggest templates`);
  options.push('Measured checks only');
  return {
    question: `Iris can review ${n} page templates (${pageCount} pages): one AI call per template. Every page is measured either way.`,
    options,
  };
}

/** Maps the chosen option back to the template ids Iris reviews. */
export function reviewChoiceOf(
  answer: string,
  reviewTemplates: readonly string[],
): string[] {
  const text = answer.trim().toLowerCase();
  if (text.startsWith('measured')) return [];
  if (text.startsWith('only the'))
    return reviewTemplates.slice(0, REVIEW_ASK_THRESHOLD);
  return [...reviewTemplates];
}
