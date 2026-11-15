import { ToolDataRecord } from '../../features/sessions/models/session.model';
import { figureIndex, findFigures, linkFigures } from './figure-refs';

function rec(rows: Record<string, unknown>[], extra: Partial<ToolDataRecord> = {}): ToolDataRecord {
  return { tool: 'run_readonly_sql', rows, rowCount: rows.length, ...extra };
}

function queriesFor(text: string, data: ToolDataRecord[]): number[][] {
  return findFigures(text, figureIndex(data)).map((f) => f.queries);
}

describe('figure-refs', () => {
  it('matches 1,204 with the string cell "1204"', () => {
    expect(queriesFor('Returns: 1,204.', [rec([{ n: '1204' }])])).toEqual([[0]]);
  });

  it('matches 1.2k with 1204 and not with 1400', () => {
    expect(queriesFor('about 1.2k', [rec([{ n: 1204 }])])).toEqual([[0]]);
    expect(queriesFor('about 1.2k', [rec([{ n: 1400 }])])).toEqual([]);
  });

  it('matches 12.5% with 0.125 and with "12.50"', () => {
    expect(queriesFor('rate 12.5%', [rec([{ r: 0.125 }])])).toEqual([[0]]);
    expect(queriesFor('rate 12.5%', [rec([{ r: '12.50' }])])).toEqual([[0]]);
  });

  it('respects the shown precision', () => {
    expect(queriesFor('total 1,204', [rec([{ n: 1204.4 }])])).toEqual([[0]]);
    expect(queriesFor('total 1,204', [rec([{ n: 1206 }])])).toEqual([]);
    expect(queriesFor('rate 12.5%', [rec([{ r: 12.6 }])])).toEqual([]);
  });

  it('consumes a date whole: 14 Nov 2025 matches 2025-11-14T00:00 and its 14 alone does not', () => {
    const date = [rec([{ d: '2025-11-14T00:00:00Z' }])];
    expect(queriesFor('up to 14 Nov 2025', date)).toEqual([[0]]);
    expect(queriesFor('up to November 14, 2025 and 2025-11-14', date)).toEqual([[0], [0]]);
    const numbers = [rec([{ n: 14 }, { n: 2025 }, { n: 11 }])];
    expect(queriesFor('up to 14 Nov 2025', numbers)).toEqual([]);
  });

  it('skips a bare whole number under 10', () => {
    expect(queriesFor('7 products', [rec([{ n: 7 }])])).toEqual([]);
    expect(queriesFor('12 products', [rec([{ n: 12 }])])).toEqual([[0]]);
  });

  it('does not match a number glued to a letter', () => {
    expect(queriesFor('Q12 and a1200b', [rec([{ n: 12 }, { m: 1200 }])])).toEqual([]);
  });

  it('gives a value found in two queries one chip each, in Q order', () => {
    const data = [rec([{ n: 1204 }]), rec([{ n: 1204 }])];
    expect(queriesFor('1,204', data)).toEqual([[0, 1]]);
  });

  it('ignores a failed record', () => {
    expect(queriesFor('1,204', [rec([{ n: 1204 }], { error: 'boom' })])).toEqual([]);
  });

  describe('linkFigures', () => {
    const data = [rec([{ n: 1204 }])];

    it('adds a chip with its query index after the figure', () => {
      const root = document.createElement('div');
      root.innerHTML = linkFigures('<p>Total <strong>1,204</strong> units</p>', figureIndex(data));
      const chip = root.querySelector('strong > sup > button.figure-ref') as HTMLButtonElement;
      expect(chip.textContent).toBe('Q1');
      expect(chip.getAttribute('data-query-index')).toBe('0');
      expect(chip.getAttribute('aria-label')).toBe('Open query Q1, the source of 1,204');
    });

    it('adds no chip inside code, pre, a or th, and chips td and headings', () => {
      const html =
        '<h2>1,204 returns</h2><p><code>1,204</code> <a href="#">1,204</a></p><pre>1,204</pre>' +
        '<table><thead><tr><th>1,204</th></tr></thead><tbody><tr><td>1,204</td></tr></tbody></table>';
      const root = document.createElement('div');
      root.innerHTML = linkFigures(html, figureIndex(data));
      expect(root.querySelectorAll('.figure-ref').length).toBe(2);
      expect(root.querySelector('h2 .figure-ref')).not.toBeNull();
      expect(root.querySelector('td .figure-ref')).not.toBeNull();
    });

    it('marks a figure whose only match is a sample, with the warning title', () => {
      const root = document.createElement('div');
      root.innerHTML = linkFigures('<p>1,204</p>', figureIndex(data), new Set([0]));
      const chip = root.querySelector('.figure-ref') as HTMLElement;
      expect(chip.classList.contains('figure-ref--sample')).toBeTrue();
      expect(chip.title).toBe('From a sample: not a reliable figure');
    });

    it('keeps the sanitized html as it is and never creates markup from text', () => {
      const root = document.createElement('div');
      root.innerHTML = linkFigures('<p>1,204 &lt;img src=x onerror=alert(1)&gt;</p>', figureIndex(data));
      expect(root.querySelector('img')).toBeNull();
      expect(root.querySelectorAll('.figure-ref').length).toBe(1);
    });

    it('returns the html untouched when nothing is indexed', () => {
      expect(linkFigures('<p>1,204</p>', [])).toBe('<p>1,204</p>');
    });
  });
});
