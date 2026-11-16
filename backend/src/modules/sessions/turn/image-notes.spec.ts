import { withImageNotes } from './image-notes';

describe("withImageNotes: a model step's input and Read images' notes (agents.md 2.15)", () => {
  const NOTES = '## Reference images\nA bar chart.';

  it('keeps the notes when the run has some', () => {
    expect(withImageNotes({ question: 'Q', imageNotes: NOTES })).toEqual({
      question: 'Q',
      imageNotes: NOTES,
    });
  });

  it('drops empty, blank or absent notes, so the call is what it was before Read images', () => {
    for (const imageNotes of ['', '  \n', undefined]) {
      const input = withImageNotes({ question: 'Q', imageNotes });
      expect(input).toEqual({ question: 'Q' });
      expect(input).not.toHaveProperty('imageNotes');
    }
    const bare: { question: string; imageNotes?: string } = { question: 'Q' };
    expect(withImageNotes(bare)).toEqual({ question: 'Q' });
  });
});
