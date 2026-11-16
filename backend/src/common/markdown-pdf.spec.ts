// `marked` ships ESM only; Jest loads its UMD build instead.
jest.mock('marked', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return
  require('../../node_modules/marked/lib/marked.umd.js'),
);

import { renderPdf } from './markdown-pdf';

/** The text drawn by `TJ` operators of an uncompressed pdfkit file. */
function pdfText(pdf: Buffer): string[] {
  const source = pdf.toString('latin1');
  const lines: string[] = [];
  for (const match of source.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    const hex = [...match[1].matchAll(/<([0-9a-fA-F]*)>/g)]
      .map((m) => m[1])
      .join('');
    lines.push(Buffer.from(hex, 'hex').toString('latin1'));
  }
  return lines;
}

const MARKDOWN = [
  '# Quarterly summary',
  '',
  'An opening paragraph.',
  '',
  '## 1. Findings',
  '',
  '- First finding',
  '- Second finding',
  '',
  '## 2. Figures',
  '',
  '| Region | Revenue |',
  '| --- | --- |',
  '| North | 120 |',
  '| South | 95 |',
  '',
  '## 3. Next steps',
  '',
  '1. Review the figures.',
  '2. Share the summary.',
].join('\n');

describe('renderPdf (a panel document as PDF)', () => {
  const options = {
    title: 'Quarterly summary',
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    compress: false,
  };

  it('renders a valid PDF carrying every section title and table cell', async () => {
    const pdf = await renderPdf(MARKDOWN, options);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    const text = pdfText(pdf).join('\n');
    for (const expected of [
      '1. Findings',
      '2. Figures',
      '3. Next steps',
      'North',
      'Revenue',
    ]) {
      expect(text).toContain(expected);
    }
    // A page break before every top-level section but the first.
    expect(
      pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('prints DRAFT in every page header only when asked', async () => {
    const draft = await renderPdf(MARKDOWN, { ...options, draft: true });
    const plain = await renderPdf(MARKDOWN, options);
    const pages = draft.toString('latin1').match(/\/Type \/Page\b/g)?.length;
    expect(pdfText(draft).filter((t) => t === 'DRAFT')).toHaveLength(pages!);
    expect(pdfText(plain)).not.toContain('DRAFT');
  });

  it('writes the author option, "Questions to Insights" by default, into the metadata', async () => {
    const custom = await renderPdf(MARKDOWN, { ...options, author: 'Ana' });
    expect(custom.toString('latin1')).toContain('Ana');
    const plain = (await renderPdf(MARKDOWN, options)).toString('latin1');
    expect(plain).toContain('Questions to Insights');
    expect(plain).not.toContain('Intellify');
  });

  it('gives the same bytes for the same input', async () => {
    const [a, b] = await Promise.all([
      renderPdf(MARKDOWN, options),
      renderPdf(MARKDOWN, options),
    ]);
    expect(a.equals(b)).toBe(true);
  });

  it('compresses by default', async () => {
    const compressed = await renderPdf(MARKDOWN, {
      ...options,
      compress: undefined,
    });
    expect(compressed.toString('latin1')).toContain('/FlateDecode');
  });
});
