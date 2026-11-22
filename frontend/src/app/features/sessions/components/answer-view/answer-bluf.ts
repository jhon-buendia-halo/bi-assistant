/**
 * An answer laid out bottom line first (BLUF, ui.md 4.4b *Answer first*):
 * its opening bold sentence is the bottom line, the rest of that paragraph
 * (the scope or limit the writer put right after it) stays beside it, the
 * body follows, and the sections on how it was worked out fold away. Works
 * on the rendered HTML (figure chips included), so the chips keep working.
 */
export interface BlufParts {
  /** The opening bold sentence, as HTML (its `strong` kept): `Francia es la selección con más goles: 14…`. */
  headline: string;
  /** The rest of the opening paragraph, as HTML; '' when none. */
  context: string;
  /** Everything else that stays open, as HTML. */
  body: string;
  /** The folded sections: their titles and HTML; null when the answer has none. */
  folded: { titles: string[]; html: string } | null;
}

/** Sections that say how the answer was worked out, in the writers' words. */
const FOLDED =
  /^(c[oó]mo lo (calcul|hice|obtuve)|supuestos|m[eé]todo|how (i|we) (worked|calculated|got)|assumptions|method)/i;

/** A section heading: an `h2`–`h4`, or a paragraph that is one bold run. */
function headingText(el: Element): string | null {
  if (/^H[2-4]$/.test(el.tagName)) return el.textContent?.trim() ?? '';
  if (el.tagName !== 'P') return null;
  const only = el.children.length === 1 ? el.firstElementChild : null;
  if (only?.tagName !== 'STRONG') return null;
  const text = el.textContent?.trim() ?? '';
  return text === only.textContent?.trim() ? text.replace(/:$/, '') : null;
}

/**
 * The answer's parts, or null when it does not open with a bold sentence,
 * one ending in `.`, `!` or `?` (it then reads as written).
 */
export function blufParts(html: string): BlufParts | null {
  const template = document.createElement('template');
  template.innerHTML = html;
  const nodes = Array.from(template.content.children);
  const lead = nodes[0];
  const bold = lead?.firstChild;
  if (
    lead?.tagName !== 'P' ||
    !(bold instanceof Element) ||
    bold.tagName !== 'STRONG' ||
    headingText(lead) !== null ||
    // A sentence, not a bold word: `**Argentina** won…` reads as written.
    !/[.!?]$/.test(bold.textContent?.trim() ?? '')
  ) {
    return null;
  }
  const headline = bold.outerHTML.trim();
  bold.remove();
  const context = lead.innerHTML.trim();

  const open: string[] = [];
  const folded: string[] = [];
  const titles: string[] = [];
  let folding = false;
  for (const node of nodes.slice(1)) {
    const title = headingText(node);
    if (title !== null) {
      folding = FOLDED.test(title);
      if (folding) titles.push(title);
    }
    (folding ? folded : open).push(node.outerHTML);
  }
  return {
    headline,
    context,
    body: open.join(''),
    folded: titles.length ? { titles, html: folded.join('') } : null,
  };
}
