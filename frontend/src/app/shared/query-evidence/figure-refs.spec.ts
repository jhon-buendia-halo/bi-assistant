import { ToolDataRecord } from '../../features/sessions/models/session.model';
import { figureIndex, findFigures, linkFigures, questionNumbers } from './figure-refs';

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

  it('finds every query that holds a value, in Q order', () => {
    const data = [rec([{ n: 1204 }]), rec([{ n: 1204 }])];
    expect(queriesFor('1,204', data)).toEqual([[0, 1]]);
  });

  it('gives no chip to a whole number the question named', () => {
    const data = [rec([{ starts: 100 }, { starts: 440 }, { year: 2018 }])];
    const index = figureIndex(data);
    const asked = questionNumbers('Which 100 drivers had the most starts in 2018?');
    expect(asked).toEqual([100, 2018]);
    expect(findFigures('the top 100 in 2018: 440 starts', index, asked).map((f) => f.text)).toEqual(['440']);
    expect(findFigures('the top 100', index).map((f) => f.text)).toEqual(['100']);
    // Only a bare whole number is an echo of the question.
    expect(findFigures('100% and 100.0', index, asked).map((f) => f.text)).toEqual(['100%', '100.0']);
  });

  it('never matches an identifier or a rank column', () => {
    const data = [rec([{ id: 4821, team_id: 4821, rnk: 15, rank: 15, wins: 4821 }])];
    expect(queriesFor('ranked 15 with 4,821 wins', data)).toEqual([[0]]);
    expect(queriesFor('ranked 15', [rec([{ rnk: 15, row_number: 15 }])])).toEqual([]);
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
      expect(chip.textContent).toBe('1');
      expect(chip.getAttribute('data-query-index')).toBe('0');
      expect(chip.getAttribute('aria-label')).toBe('Source 1: Query 1, the source of 1,204');
    });

    it('adds no chip inside code, pre, a, th or td, and chips headings', () => {
      const html =
        '<h2>1,204 returns</h2><p><code>1,204</code> <a href="#">1,204</a></p><pre>1,204</pre>' +
        '<table><thead><tr><th>1,204</th></tr></thead><tbody><tr><td>1,204</td></tr></tbody></table>';
      const root = document.createElement('div');
      root.innerHTML = linkFigures(html, figureIndex(data));
      expect(root.querySelectorAll('.figure-ref').length).toBe(1);
      expect(root.querySelector('h2 .figure-ref')).not.toBeNull();
      expect(root.querySelector('td .figure-ref')).toBeNull();
    });

    it('gives a figure two queries hold one chip, of the query that holds most of the answer', () => {
      const both = [rec([{ n: 1204 }]), rec([{ n: 1204 }, { n: 987 }, { n: 912 }])];
      const root = document.createElement('div');
      root.innerHTML = linkFigures('<p>1,204</p><p>987</p><p>912</p>', figureIndex(both));
      const chips = [...root.querySelectorAll('.figure-ref')] as HTMLElement[];
      expect(chips.map((c) => c.textContent)).toEqual(['2', '2', '2']);
      expect(chips[0].getAttribute('data-also')).toBe('0');
      expect(chips[1].hasAttribute('data-also')).toBeFalse();
    });

    it('prefers a query that is not a sample, and the earliest on a tie', () => {
      const both = [rec([{ n: 1204 }]), rec([{ n: 1204 }])];
      const root = document.createElement('div');
      root.innerHTML = linkFigures('<p>1,204</p>', figureIndex(both), new Set([0]));
      const chip = root.querySelector('.figure-ref') as HTMLElement;
      expect(chip.textContent).toBe('2');
      expect(chip.classList.contains('figure-ref--sample')).toBeFalse();
      root.innerHTML = linkFigures('<p>1,204</p>', figureIndex(both));
      expect(root.querySelectorAll('.figure-ref').length).toBe(1);
      expect(root.querySelector('.figure-ref')?.textContent).toBe('1');
    });

    it('marks a figure whose only match is a sample, with the sample flag', () => {
      const root = document.createElement('div');
      root.innerHTML = linkFigures('<p>1,204</p>', figureIndex(data), new Set([0]));
      const chip = root.querySelector('.figure-ref') as HTMLElement;
      expect(chip.classList.contains('figure-ref--sample')).toBeTrue();
      expect(chip.getAttribute('data-sample')).toBe('true');
    });

    it('puts the source purpose in the chip label', () => {
      const root = document.createElement('div');
      const sources = [{ index: 0, label: 'Source 1', purpose: 'Returns per product', rows: '1 row', coverage: null }];
      root.innerHTML = linkFigures('<p>1,204</p>', figureIndex(data), new Set(), [], sources);
      expect(root.querySelector('.figure-ref')?.getAttribute('aria-label')).toBe(
        'Source 1: Returns per product, the source of 1,204',
      );
    });

    it('chips only the first figure of each source in a paragraph or list item', () => {
      const many = [rec([{ n: 1204 }, { n: 987 }]), rec([{ n: 55 }])];
      const root = document.createElement('div');
      root.innerHTML = linkFigures('<p>1,204 and 987, with 55 more</p><ul><li>987</li><li>1,204</li></ul>', figureIndex(many));
      expect(root.querySelectorAll('p .figure-ref').length).toBe(2);
      expect(root.querySelectorAll('li .figure-ref').length).toBe(2);
    });

    it('adds one source line after a table and none for a table with no matched figures', () => {
      const table = (cell: string) =>
        `<table><thead><tr><th>1,204</th></tr></thead><tbody><tr><td>${cell}</td></tr><tr><td>${cell}</td></tr></tbody></table>`;
      const sources = [{ index: 0, label: 'Source 1', purpose: 'Returns per product', rows: '12 rows', coverage: null }];
      const root = document.createElement('div');
      root.innerHTML = linkFigures(table('1,204') + table('no figure'), figureIndex(data), new Set(), [], sources);
      const lines = root.querySelectorAll('[data-testid="table-source"]');
      expect(lines.length).toBe(1);
      expect(lines[0].textContent).toBe('Source 1 · Returns per product · 12 rows');
      expect(lines[0].getAttribute('data-query-index')).toBe('0');
      expect(root.querySelector('table + p [data-testid="table-source"], table + [data-testid="table-source"]')).not.toBeNull();
      expect(root.querySelector('td .figure-ref')).toBeNull();
    });

    it('lists every source of a table whose figures come from several queries', () => {
      const both = [rec([{ n: 1204 }]), rec([{ n: 987 }])];
      const root = document.createElement('div');
      root.innerHTML = linkFigures(
        '<table><tbody><tr><td>1,204</td><td>987</td></tr></tbody></table>',
        figureIndex(both),
      );
      const line = root.querySelector('[data-testid="table-source"]') as HTMLElement;
      expect(line.textContent).toBe('Sources 1, 2');
      expect([...line.querySelectorAll('button')].map((b) => b.getAttribute('data-query-index'))).toEqual(['0', '1']);
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
