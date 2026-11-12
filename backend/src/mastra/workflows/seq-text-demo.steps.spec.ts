import {
  SEQ_TEXT_DEMO_STEPS,
  SEQ_TEXT_DEMO_WORKFLOW_ID,
  cleanText,
  countWords,
  formatResult,
} from './seq-text-demo.steps';

describe('seq-text-demo steps (agents.md 5.13; plan 9.2)', () => {
  it('names the workflow and its three code steps', () => {
    expect(SEQ_TEXT_DEMO_WORKFLOW_ID).toBe('seq-text-demo');
    expect(SEQ_TEXT_DEMO_STEPS).toEqual([
      {
        id: 'clean-text',
        title: 'Clean text',
        kind: 'code',
        summary:
          'Trims the text and collapses repeated spaces. An empty text fails the step.',
        input: ['text'],
        output: ['text'],
        exits: [{ label: 'Empty text', outcome: 'fails' }],
      },
      {
        id: 'count-words',
        title: 'Count words',
        kind: 'code',
        summary: 'Counts the words and characters of the cleaned text.',
        input: ['text'],
        output: ['text', 'words', 'characters'],
        exits: [],
      },
      {
        id: 'format-result',
        title: 'Format result',
        kind: 'code',
        summary:
          'Writes a one-line summary of the counts and the start of the text.',
        input: ['text', 'words', 'characters'],
        output: ['summary'],
        exits: [],
      },
    ]);
  });

  describe('cleanText', () => {
    it('trims and collapses every run of whitespace to one space', () => {
      expect(cleanText('  Hello   workflow   world  ')).toBe(
        'Hello workflow world',
      );
      expect(cleanText('one\n\n\ttwo \r\n three')).toBe('one two three');
    });

    it.each(['', '   ', '\n\t '])('fails on an empty text (%p)', (text) => {
      expect(() => cleanText(text)).toThrow('The text is empty');
    });

    it('fails on a missing text', () => {
      expect(() => cleanText(undefined as unknown as string)).toThrow(
        'The text is empty',
      );
    });
  });

  describe('countWords', () => {
    it('counts whitespace-separated words and every character', () => {
      expect(countWords('Hello workflow world')).toEqual({
        words: 3,
        characters: 20,
      });
    });

    it('counts nothing in an empty text', () => {
      expect(countWords('')).toEqual({ words: 0, characters: 0 });
    });
  });

  describe('formatResult', () => {
    it('writes the counts and the text in quotes', () => {
      expect(
        formatResult({
          text: 'Hello workflow world',
          words: 3,
          characters: 20,
        }),
      ).toBe('3 words, 20 characters: "Hello workflow world"');
    });

    it('uses the singular for one word and one character', () => {
      expect(formatResult({ text: 'a', words: 1, characters: 1 })).toBe(
        '1 word, 1 character: "a"',
      );
    });

    it('keeps a text of exactly 60 characters whole', () => {
      const text = 'x'.repeat(60);
      expect(formatResult({ text, words: 1, characters: 60 })).toBe(
        `1 word, 60 characters: "${text}"`,
      );
    });

    it('cuts a longer text to its first 60 characters and appends …', () => {
      const text = `${'y'.repeat(60)}z`;
      expect(formatResult({ text, words: 1, characters: 61 })).toBe(
        `1 word, 61 characters: "${'y'.repeat(60)}…"`,
      );
    });
  });
});
