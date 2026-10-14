// `marked` ships ESM only; Jest loads its UMD build instead.
jest.mock('marked', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-return
  require('../../../node_modules/marked/lib/marked.umd.js'),
);

import { renderRfpMarkdown } from './document';
import { renderPdf } from './pdf';
import { fixtureData, fixtureRfp, GENERATED_AT } from './rfp-package.stub';

/** The text drawn by `TJ` operators of an uncompressed pdfkit file. */
export function pdfText(pdf: Buffer): string[] {
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

describe('renderPdf', () => {
  const markdown = renderRfpMarkdown(fixtureRfp(), fixtureData(), GENERATED_AT);
  const options = {
    title: 'Orchard RFP',
    createdAt: new Date(GENERATED_AT),
    compress: false,
  };

  it('renders a valid PDF carrying every section title', async () => {
    const pdf = await renderPdf(markdown, options);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    const text = pdfText(pdf).join('\n');
    for (const title of [
      '1. Executive summary',
      '2. Client background',
      '3. Scope of this RFP',
      '4. Current program',
      '5. Carriers invited',
      '6. Requirements and questionnaire',
      '7. Timeline',
      '8. Instructions to bidders',
      '9. Evaluation criteria',
      'Exhibits',
      'Delta Dental',
      'Describe your network in Minnesota.',
    ]) {
      expect(text).toContain(title);
    }
    // A page per top-level section, after the title page.
    expect(
      pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length,
    ).toBeGreaterThanOrEqual(10);
    expect(pdf.toString('latin1')).toMatch(/\/Title \d+ 0 R/);
  });

  it('gives the same bytes for the same input', async () => {
    const [a, b] = await Promise.all([
      renderPdf(markdown, options),
      renderPdf(markdown, options),
    ]);
    expect(a.equals(b)).toBe(true);
  });

  it('compresses by default', async () => {
    const compressed = await renderPdf(markdown, {
      ...options,
      compress: undefined,
    });
    expect(compressed.toString('latin1')).toContain('/FlateDecode');
  });
});
