import { cvBlocks, cvWords, jobDescriptionCv } from './job-description-cv';

/** The Data Mapper's shape: profile, inputs, a reply format, rules. */
const MAPPER = `You are the Data Mapper. You decide whether the data a dashboard needs exists.

You receive the dashboard as data and the catalog of the entities. You have no tools.

Reply with one JSON object and nothing else:
- approach: two to four sentences on how you mapped the dashboard.
- gaps: what the datasets lack. Empty when nothing is missing.

A field entry is { "field": the column name, "note": why this column }.

Rules:
- Use only entities and columns that appear in the catalog.
- Use the same source for the same field in every widget and filter.`;

/** The Insights Analyst's shape: wrapped lines, Markdown and labels. */
const ANALYST = `You are Questions to Insights — a business data analyst working over the
catalogs of the user's session datasets.

## Working rules
Method, for every question:
1. Map the question to entities ([[tool:list_entities]],
   [[tool:describe_entity]]).
2. Run the analysis yourself.

Grounding:
- Every number must come from a query result of this turn.

Answer format:
- Lead with the answer.`;

describe('job description as a CV (ui.md 4.5)', () => {
  it('sorts the Data Mapper into profile, inputs, deliverables and rules', () => {
    const cv = jobDescriptionCv(MAPPER);
    expect(cv.map((s) => s.title)).toEqual([
      'Profile',
      'Inputs',
      'Deliverables',
      'Working rules',
    ]);
    const deliverables = cv[2].blocks;
    expect(deliverables[0]).toEqual({
      kind: 'heading',
      text: 'Reply with one JSON object and nothing else',
    });
    expect(deliverables[1]).toEqual({
      kind: 'list',
      ordered: false,
      items: [
        {
          key: 'approach',
          text: 'two to four sentences on how you mapped the dashboard.',
        },
        {
          key: 'gaps',
          text: 'what the datasets lack. Empty when nothing is missing.',
        },
      ],
    });
    // "A field entry …" belongs with the reply format.
    expect(deliverables[2].kind).toBe('paragraph');
    // The section's own label ("Rules:") is the section title, not repeated.
    expect(cv[3].blocks.map((b) => b.kind)).toEqual(['list']);
  });

  it('joins wrapped lines and keeps sub-headings and links', () => {
    const cv = jobDescriptionCv(ANALYST);
    // CV order: Deliverables before Working rules, whatever the text's order.
    expect(cv.map((s) => s.id)).toEqual(['profile', 'deliverables', 'rules']);
    expect(cv[0].blocks).toEqual([
      {
        kind: 'paragraph',
        text: "You are Questions to Insights — a business data analyst working over the catalogs of the user's session datasets.",
      },
    ]);
    const rules = cv.find((s) => s.id === 'rules')!.blocks;
    expect(rules[0]).toEqual({
      kind: 'heading',
      text: 'Method, for every question',
    });
    expect(rules[1]).toEqual({
      kind: 'list',
      ordered: true,
      items: [
        {
          text: 'Map the question to entities ([[tool:list_entities]], [[tool:describe_entity]]).',
        },
        { text: 'Run the analysis yourself.' },
      ],
    });
    expect(rules[2]).toEqual({ kind: 'heading', text: 'Grounding' });
  });

  it('keeps every word of the text, none added or lost', () => {
    for (const text of [MAPPER, ANALYST]) {
      const expected = text
        .split('\n')
        .map((line) => line.trim().replace(/^(?:[-*]|\d+\.|#+)\s+/, ''))
        // Labels that became a section title.
        .filter((line) => !['Rules:', 'Working rules'].includes(line))
        .join(' ')
        .split(/\s+/)
        .filter(Boolean)
        // A label's final colon is layout.
        .map((word) => word.replace(/:$/, ''));
      const words = cvWords(jobDescriptionCv(text)).map((word) =>
        word.replace(/:$/, ''),
      );
      // Sections follow CV order, so compare the words, not their order.
      expect([...words].sort()).toEqual([...expected].sort());
    }
  });

  it('puts an unlabelled text in the profile and a stray label under More', () => {
    expect(jobDescriptionCv('Answer in one sentence.')).toEqual([
      {
        id: 'profile',
        title: 'Profile',
        blocks: [{ kind: 'paragraph', text: 'Answer in one sentence.' }],
      },
    ]);
    const cv = jobDescriptionCv('Notes:\n- Be brief.');
    expect(cv.map((s) => s.id)).toEqual(['more']);
    expect(jobDescriptionCv('')).toEqual([]);
  });

  it('reads a list item without a key as plain text', () => {
    const [list] = cvBlocks('- When no column can feed a field: say so.');
    expect(list).toEqual({
      kind: 'list',
      ordered: false,
      items: [{ text: 'When no column can feed a field: say so.' }],
    });
  });
});
