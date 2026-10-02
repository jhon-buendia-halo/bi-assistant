import { lineDiff } from './line-diff';

describe('lineDiff', () => {
  it('reports every line unchanged when both sides are identical', () => {
    const text = 'a\nb\nc';
    const diff = lineDiff(text, text);
    expect(diff.every((line) => line.kind === 'unchanged')).toBe(true);
    expect(diff.map((line) => line.text)).toEqual(['a', 'b', 'c']);
  });

  it('marks a single changed line as removed+added, keeping the rest unchanged', () => {
    const diff = lineDiff('a\nb\nc', 'a\nB\nc');
    expect(diff.map((l) => [l.kind, l.text])).toEqual([
      ['unchanged', 'a'],
      ['removed', 'b'],
      ['added', 'B'],
      ['unchanged', 'c'],
    ]);
  });

  it('detects a pure insertion without marking surrounding lines as changed', () => {
    const diff = lineDiff('a\nc', 'a\nb\nc');
    expect(diff.map((l) => [l.kind, l.text])).toEqual([
      ['unchanged', 'a'],
      ['added', 'b'],
      ['unchanged', 'c'],
    ]);
  });

  it('detects a pure deletion', () => {
    const diff = lineDiff('a\nb\nc', 'a\nc');
    expect(diff.map((l) => [l.kind, l.text])).toEqual([
      ['unchanged', 'a'],
      ['removed', 'b'],
      ['unchanged', 'c'],
    ]);
  });

  it('numbers unchanged lines on both sides and only the owning side for changes', () => {
    const diff = lineDiff('a\nb', 'a\nB');
    expect(diff[0].kind).toBe('unchanged');
    expect(diff[0].beforeLine).toBe(1);
    expect(diff[0].afterLine).toBe(1);
    expect(diff[1].kind).toBe('removed');
    expect(diff[1].beforeLine).toBe(2);
    expect(diff[1].afterLine).toBeUndefined();
    expect(diff[2].kind).toBe('added');
    expect(diff[2].afterLine).toBe(2);
    expect(diff[2].beforeLine).toBeUndefined();
  });

  it('handles two completely different texts', () => {
    const diff = lineDiff('x\ny', 'p\nq');
    expect(diff.filter((l) => l.kind === 'removed').map((l) => l.text)).toEqual([
      'x',
      'y',
    ]);
    expect(diff.filter((l) => l.kind === 'added').map((l) => l.text)).toEqual([
      'p',
      'q',
    ]);
  });

  it('handles an empty before text as a pure insertion', () => {
    const diff = lineDiff('', 'a\nb');
    expect(diff.every((l) => l.kind === 'added')).toBe(true);
  });
});
