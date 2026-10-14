import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatMoney,
  formatPct,
  renderRfpMarkdown,
  TO_BE_WRITTEN,
} from './document';
import { EMPTY_PACKAGE_DATA } from './exhibits.queries';
import { fixtureData, fixtureRfp, GENERATED_AT } from './rfp-package.stub';

const OUTLINE = [
  '## 1. Executive summary',
  '## 2. Client background',
  '## 3. Scope of this RFP',
  '## 4. Current program',
  '## 5. Carriers invited',
  '## 6. Requirements and questionnaire',
  '## 7. Timeline',
  '## 8. Instructions to bidders',
  '## 9. Evaluation criteria',
  '## Exhibits',
];

describe('renderRfpMarkdown', () => {
  it('matches the golden document for the fixture record', () => {
    const golden = readFileSync(join(__dirname, 'document.golden.md'), 'utf8');
    expect(renderRfpMarkdown(fixtureRfp(), fixtureData(), GENERATED_AT)).toBe(
      golden,
    );
  });

  it('is deterministic and follows the outline in order', () => {
    const a = renderRfpMarkdown(fixtureRfp(), fixtureData(), GENERATED_AT);
    expect(renderRfpMarkdown(fixtureRfp(), fixtureData(), GENERATED_AT)).toBe(
      a,
    );
    const headings = a.split('\n').filter((l) => l.startsWith('## '));
    expect(headings).toEqual(OUTLINE);
    expect(a.startsWith('# Orchard Manufacturing — 2027 benefits RFP\n')).toBe(
      true,
    );
  });

  it('lists every plan of a line scoped with no plan design ids', () => {
    const md = renderRfpMarkdown(fixtureRfp(), fixtureData(), GENERATED_AT);
    expect(md).toContain('| 1 | Medical | as-is | All: PPO (Aetna) |');
  });

  it('renders an empty record with every heading', () => {
    const rfp = {
      ...fixtureRfp(),
      sections: {},
      lines: [],
      carriers: [],
      requirements: [],
      timeline: [],
      clientMissing: true as const,
    };
    const md = renderRfpMarkdown(rfp, EMPTY_PACKAGE_DATA, GENERATED_AT);
    expect(md.split('\n').filter((l) => l.startsWith('## '))).toEqual(OUTLINE);
    expect(md.split(TO_BE_WRITTEN).length - 1).toBe(5);
    expect(md).toContain('client no longer in Intellify');
    expect(md).toContain('_No census on file._');
  });

  it('formats money and percentages without locale data', () => {
    expect(formatMoney(190989597.24)).toBe('$190,989,597');
    expect(formatMoney(-1234)).toBe('-$1,234');
    expect(formatMoney(null)).toBe('—');
    expect(formatPct(0.1177)).toBe('11.8%');
  });
});
