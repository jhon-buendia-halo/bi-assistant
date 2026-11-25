import { planCatalogBlock } from './analysis.steps';
import { mapDataRequest } from './recreate-dashboard.prompts';
import {
  SAMPLE_BLUEPRINT_REPLY,
  SAMPLE_CATALOG,
  SAMPLE_COLUMNS,
} from './recreate-dashboard.sample';
import {
  blueprintOf,
  type DashboardBlueprint,
} from './recreate-dashboard.steps';

const BLUEPRINT = blueprintOf(SAMPLE_BLUEPRINT_REPLY) as DashboardBlueprint;
const INPUT = {
  question: 'Prefer the orders table',
  blueprint: BLUEPRINT,
  catalog: SAMPLE_CATALOG,
  columns: SAMPLE_COLUMNS,
};

describe('mapDataRequest (agents.md 5.18)', () => {
  // The request as it was before reference images existed: pinned so a run
  // without images keeps sending exactly this.
  const lines = (request: string) => request.split('\n');

  it('is unchanged without notes: absent or empty', () => {
    const before = mapDataRequest(INPUT);
    expect(mapDataRequest({ ...INPUT, imageNotes: '' })).toBe(before);
    expect(mapDataRequest({ ...INPUT, imageNotes: '  \n ' })).toBe(before);
    expect(before).not.toContain('<reference-images>');
    expect(lines(before).slice(0, 6)).toEqual([
      'Map the dashboard to the datasets.',
      '',
      '<instructions>',
      'Prefer the orders table',
      '</instructions>',
      '',
    ]);
    expect(lines(before)[6]).toBe('<dashboard>');
    expect(
      before.endsWith(
        `<catalog>\n${planCatalogBlock(SAMPLE_CATALOG, SAMPLE_COLUMNS)}\n</catalog>`,
      ),
    ).toBe(true);
  });

  it('adds the notes in a block after the instructions and before the dashboard', () => {
    const notes = '## Reference images\nA bar chart of sales.';
    const request = mapDataRequest({ ...INPUT, imageNotes: notes });
    const rest = mapDataRequest(INPUT);
    expect(request).toBe(
      rest.replace(
        '</instructions>\n\n',
        `</instructions>\n\n<reference-images>\n${notes}\n</reference-images>\n\n`,
      ),
    );
    expect(request.indexOf('</instructions>')).toBeLessThan(
      request.indexOf('<reference-images>'),
    );
    expect(request.indexOf('</reference-images>')).toBeLessThan(
      request.indexOf('<dashboard>'),
    );
  });
});
