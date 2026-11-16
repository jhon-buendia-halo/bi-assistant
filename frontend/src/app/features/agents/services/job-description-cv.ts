/**
 * Lays a job description out as a CV (ui.md 4.5, *CV view*): the text is cut
 * into blocks and the blocks are sorted into CV sections by the labels the
 * text already uses, in CV order. No word is added or reworded; line breaks
 * inside a paragraph or a list item become spaces, the list and heading
 * markers (`- `, `1. `, `## `, a label's final `:`) become layout, and a
 * label that only repeats its section's title (`Rules:`) is not shown twice.
 * The model always reads the stored text, never this.
 */

export type CvSectionId =
  'profile' | 'inputs' | 'deliverables' | 'rules' | 'more';

export const CV_SECTION_TITLES: Readonly<Record<CvSectionId, string>> = {
  profile: 'Profile',
  inputs: 'Inputs',
  deliverables: 'Deliverables',
  rules: 'Working rules',
  more: 'More',
};

/** A list item; `key` is the field name of a `- key: text` item. */
export interface CvListItem {
  key?: string;
  text: string;
}

export type CvBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: CvListItem[] };

export interface CvSection {
  id: CvSectionId;
  title: string;
  blocks: CvBlock[];
}

const LIST_ITEM = /^(?:[-*]|\d+\.)\s+(.*)$/;
const MARKDOWN_HEADING = /^#{1,6}\s+(.*)$/;
/** A short line that ends with a colon, on its own: a label. */
const LABEL = /^[^-*\d].{0,58}:$/;
const ITEM_KEY = /^([A-Za-z][\w ]{0,24}):\s+(.+)$/;

/** Where a block that opens with these words belongs. */
const SECTION_CUES: readonly [CvSectionId, RegExp][] = [
  ['profile', /^You are\b/i],
  ['inputs', /^(You (receive|get|are given)|Input)/i],
  [
    'deliverables',
    /^(Reply with|Respond with|Return|Answer format|Output|A field entry)/i,
  ],
  [
    'rules',
    /(rules|method|grounding|practice|ambiguity|say why|guidelines|constraints)/i,
  ],
];

/** Cut the text into headings, paragraphs and lists. */
export function cvBlocks(text: string): CvBlock[] {
  const blocks: CvBlock[] = [];
  let open: CvBlock | null = null;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      open = null;
      continue;
    }
    const heading = line.match(MARKDOWN_HEADING);
    if (heading) {
      blocks.push({ kind: 'heading', text: heading[1] });
      open = null;
      continue;
    }
    const item = line.match(LIST_ITEM);
    if (item) {
      const ordered = /^\d/.test(line);
      if (open?.kind !== 'list' || open.ordered !== ordered) {
        open = { kind: 'list', ordered, items: [] };
        blocks.push(open);
      }
      open.items.push({ text: item[1] });
      continue;
    }
    if (open?.kind === 'list') {
      // A wrapped list item goes on.
      const last = open.items[open.items.length - 1];
      last.text = `${last.text} ${line}`;
      continue;
    }
    if (open?.kind === 'paragraph') {
      open.text = `${open.text} ${line}`;
      continue;
    }
    if (LABEL.test(line)) {
      blocks.push({ kind: 'heading', text: line.slice(0, -1) });
      open = null;
      continue;
    }
    open = { kind: 'paragraph', text: line };
    blocks.push(open);
  }
  for (const block of blocks) {
    if (block.kind !== 'list') continue;
    block.items = block.items.map((item) => {
      const keyed = item.text.match(ITEM_KEY);
      return keyed ? { key: keyed[1], text: keyed[2] } : item;
    });
  }
  return blocks;
}

function cue(text: string): CvSectionId | null {
  return SECTION_CUES.find(([, re]) => re.test(text))?.[0] ?? null;
}

/**
 * The CV sections, in CV order, each with its blocks in text order. A block
 * opening with a cue (a label such as `Rules:` or `## Working rules`, or a
 * paragraph such as `You receive …` or `Reply with …`) starts that section;
 * the blocks after it follow it until the next cue. A label with no cue
 * before any cue goes to More. Empty sections are left out.
 */
export function jobDescriptionCv(text: string): CvSection[] {
  const byId = new Map<CvSectionId, CvBlock[]>(
    (Object.keys(CV_SECTION_TITLES) as CvSectionId[]).map((id) => [id, []]),
  );
  let current: CvSectionId = 'profile';
  for (const block of cvBlocks(text)) {
    if (block.kind !== 'list') {
      const next = cue(block.text);
      if (next) current = next;
      else if (block.kind === 'heading' && current === 'profile') {
        current = 'more';
      }
    }
    byId.get(current)!.push(block);
  }
  return [...byId]
    .filter(([, blocks]) => blocks.length > 0)
    .map(([id, blocks]) => ({
      id,
      title: CV_SECTION_TITLES[id],
      blocks: dropSectionLabel(id, blocks),
    }));
}

/**
 * A section's own label, when it is the section's first block and only a
 * label (`Rules:`), says what the section title already says; it is dropped
 * from the blocks. Any other heading stays as a sub-heading.
 */
function dropSectionLabel(id: CvSectionId, blocks: CvBlock[]): CvBlock[] {
  const [first, ...rest] = blocks;
  const sameAsTitle =
    first?.kind === 'heading' &&
    first.text.toLowerCase().replace(/^working /, '') ===
      CV_SECTION_TITLES[id].toLowerCase().replace(/^working /, '');
  return sameAsTitle ? rest : blocks;
}

/** Every word of the text, in order: what a CV must keep (unit-tested). */
export function cvWords(sections: readonly CvSection[]): string[] {
  const words: string[] = [];
  const add = (text: string) =>
    words.push(...text.split(/\s+/).filter(Boolean));
  for (const section of sections) {
    for (const block of section.blocks) {
      if (block.kind === 'list') {
        for (const item of block.items) {
          if (item.key) add(`${item.key}:`);
          add(item.text);
        }
      } else add(block.text);
    }
  }
  return words;
}
