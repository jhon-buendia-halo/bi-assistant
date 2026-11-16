import type { DiscoveredPage } from './review-website.schemas';
import {
  groupTemplates,
  REVIEW_ASK_THRESHOLD,
  reviewChoiceOf,
  reviewPlan,
  reviewQuestion,
} from './review-website.templates';

function page(
  url: string,
  group: string,
  fingerprint = '',
  extra: Partial<DiscoveredPage> = {},
): DiscoveredPage {
  return {
    url,
    finalUrl: url,
    status: 200,
    title: '',
    depth: 0,
    parent: null,
    group,
    fingerprint,
    error: null,
    ...extra,
  };
}

describe('groupTemplates', () => {
  it('groups pages of one URL pattern', () => {
    const { templates } = groupTemplates([
      page('/a/1', '/a/:id'),
      page('/a/2', '/a/:id'),
    ]);
    expect(templates).toEqual([
      { id: '/a/:id', pages: ['/a/1', '/a/2'], representative: '/a/1' },
    ]);
  });

  it('merges URL groups that share a fingerprint', () => {
    const { pages, templates } = groupTemplates([
      page('/a/1', '/a/:id', 'f1'),
      page('/a/2', '/a/:id', 'f1'),
      page('/b/1', '/b/:id', 'f1'),
    ]);
    expect(templates).toHaveLength(1);
    expect(templates[0].id).toBe('/a/:id');
    expect(pages.map((p) => p.group)).toEqual(['/a/:id', '/a/:id', '/a/:id']);
  });

  it('keeps pages with different group and fingerprint apart', () => {
    const { templates } = groupTemplates([
      page('/a', '/a', 'f1'),
      page('/b', '/b', 'f2'),
    ]);
    expect(templates.map((t) => t.id)).toEqual(['/a', '/b']);
  });

  it('never joins on empty fingerprints', () => {
    const { templates } = groupTemplates([page('/a', '/a'), page('/b', '/b')]);
    expect(templates).toHaveLength(2);
  });

  it('names a template after its most common group, first reached on a tie', () => {
    const common = groupTemplates([
      page('/x', '/x', 'f'),
      page('/y/1', '/y/:id', 'f'),
      page('/y/2', '/y/:id', 'f'),
    ]);
    expect(common.templates[0].id).toBe('/y/:id');
    const tie = groupTemplates([page('/x', '/x', 'f'), page('/y', '/y', 'f')]);
    expect(tie.templates[0].id).toBe('/x');
  });

  it('picks the first page that loaded as representative', () => {
    const { templates } = groupTemplates([
      page('/a/1', '/a/:id', '', { status: 500 }),
      page('/a/2', '/a/:id', '', { error: 'timeout', status: null }),
      page('/a/3', '/a/:id'),
    ]);
    expect(templates[0].representative).toBe('/a/3');
    const none = groupTemplates([page('/z', '/z', '', { status: 404 })]);
    expect(none.templates[0].representative).toBe('/z');
  });

  it('sorts by page count, then by first crawl index', () => {
    const { templates } = groupTemplates([
      page('/a', '/a'),
      page('/b/1', '/b/:id'),
      page('/c', '/c'),
      page('/b/2', '/b/:id'),
    ]);
    expect(templates.map((t) => t.id)).toEqual(['/b/:id', '/a', '/c']);
  });
});

describe('reviewPlan', () => {
  const pages = Array.from({ length: 12 }, (_, i) => page(`/p${i}`, `/p${i}`));
  const { templates } = groupTemplates(pages);

  it('reviews nothing when the visual review is off', () => {
    expect(reviewPlan(templates, false, pages)).toEqual({
      reviewTemplates: [],
      askBeforeReview: false,
    });
  });

  it('does not ask at or under the threshold', () => {
    const few = groupTemplates(pages.slice(0, REVIEW_ASK_THRESHOLD));
    const plan = reviewPlan(few.templates, true, few.pages);
    expect(plan.reviewTemplates).toHaveLength(REVIEW_ASK_THRESHOLD);
    expect(plan.askBeforeReview).toBe(false);
  });

  it('asks over the threshold', () => {
    const plan = reviewPlan(templates, true, pages);
    expect(plan.reviewTemplates).toHaveLength(12);
    expect(plan.askBeforeReview).toBe(true);
  });

  it('leaves out templates whose representative did not load', () => {
    const mixed = [
      page('/ok', '/ok'),
      page('/bad', '/bad', '', { status: 500 }),
    ];
    const grouped = groupTemplates(mixed);
    expect(reviewPlan(grouped.templates, true, grouped.pages)).toEqual({
      reviewTemplates: ['/ok'],
      askBeforeReview: false,
    });
  });
});

describe('reviewQuestion and reviewChoiceOf', () => {
  const ids = Array.from({ length: 14 }, (_, i) => `t${i}`);

  it('offers three options over the threshold', () => {
    const { question, options } = reviewQuestion([], ids, 40);
    expect(question).toContain('14 page templates (40 pages)');
    expect(options).toEqual([
      'Review all 14 templates',
      'Only the 10 biggest templates',
      'Measured checks only',
    ]);
  });

  it('omits the biggest option at or under the threshold', () => {
    expect(reviewQuestion([], ids.slice(0, 10), 20).options).toEqual([
      'Review all 10 templates',
      'Measured checks only',
    ]);
  });

  it('maps each option and free text', () => {
    expect(reviewChoiceOf('Review all 14 templates', ids)).toEqual(ids);
    expect(reviewChoiceOf('  only the 10 biggest templates ', ids)).toEqual(
      ids.slice(0, 10),
    );
    expect(reviewChoiceOf('Measured checks only', ids)).toEqual([]);
    expect(reviewChoiceOf('whatever', ids)).toEqual(ids);
  });
});
