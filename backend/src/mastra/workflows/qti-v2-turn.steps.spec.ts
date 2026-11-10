const getDatasets = jest.fn();
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({ getDatasets }),
}));

import {
  QTI_V2_TURN_STEPS,
  catalogBlock,
  loadCatalog,
  receiveQuestion,
  wrapUp,
} from './qti-v2-turn.steps';

describe('qti-v2-turn steps (agents.md 5.11)', () => {
  it('lists the four steps with their ids and titles', () => {
    expect(QTI_V2_TURN_STEPS).toEqual([
      { id: 'receive-question', title: 'Receive question' },
      { id: 'load-catalog', title: 'Load catalog' },
      { id: 'analyse', title: 'Analyse' },
      { id: 'wrap-up', title: 'Wrap up' },
    ]);
  });

  describe('receiveQuestion', () => {
    it('trims the question', () => {
      expect(receiveQuestion('  How many goals?\n')).toBe('How many goals?');
    });

    it.each(['', '   ', '\n\t'])('refuses %p', (question) => {
      expect(() => receiveQuestion(question)).toThrow('The question is empty');
    });
  });

  describe('loadCatalog', () => {
    it('lists the entities of the datasets in dataset then table order', async () => {
      getDatasets.mockResolvedValue([
        {
          name: 'World Cup',
          datasourceId: 'ds-pg',
          datasourceKind: 'postgres',
          tables: ['wc.public.matches'],
          entities: [{ key: 'wc.public.matches', columns: [{}, {}, {}] }],
        },
        { name: 'Notes', tables: ['n.public.notes'] },
      ]);
      await expect(loadCatalog(['World Cup', 'Notes'])).resolves.toEqual([
        {
          entity: 'wc.public.matches',
          dataset: 'World Cup',
          datasourceId: 'ds-pg',
          datasourceKind: 'postgres',
          columnCount: 3,
        },
        {
          entity: 'n.public.notes',
          dataset: 'Notes',
          datasourceId: null,
          datasourceKind: null,
          columnCount: null,
        },
      ]);
      expect(getDatasets).toHaveBeenCalledWith(['World Cup', 'Notes']);
    });
  });

  describe('catalogBlock', () => {
    it('says when there is no entity', () => {
      expect(catalogBlock([])).toBe(
        'Catalog loaded for this turn: no entities.',
      );
    });

    it('lists one entity per line, singular for one', () => {
      expect(
        catalogBlock([
          {
            entity: 'a.b.c',
            dataset: 'D',
            datasourceId: null,
            datasourceKind: null,
            columnCount: 5,
          },
        ]),
      ).toBe(
        'Catalog loaded for this turn: 1 entity.\n- a.b.c (dataset: D; 5 columns)',
      );
    });
  });

  describe('wrapUp', () => {
    it('counts the SQL calls, the failed ones and the rows of the others', () => {
      expect(
        wrapUp([
          { tool: 'run_readonly_sql', rowCount: 10, failed: false },
          { tool: 'run_readonly_sql', rowCount: 99, failed: true },
          { tool: 'run_readonly_sql', failed: false },
          { tool: 'describe_entity', rowCount: 7, failed: false },
        ]),
      ).toEqual({ sqlQueries: 3, failedQueries: 1, rows: 10 });
    });

    it('is all zero for a turn without SQL', () => {
      expect(wrapUp([])).toEqual({ sqlQueries: 0, failedQueries: 0, rows: 0 });
    });
  });
});
