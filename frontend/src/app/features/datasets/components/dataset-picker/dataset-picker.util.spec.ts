import { Dataset } from '../../services/datasets-api.service';
import { buildPickerView, highlight, sourceLabel } from './dataset-picker.util';

function ds(name: string, extra: Partial<Dataset> = {}): Dataset {
  return { name, tables: ['t1'], ...extra };
}

const NAMES = new Map([
  ['pg', 'World Cup PostgreSQL'],
  ['dbx', 'Finance DW'],
]);

describe('dataset picker view', () => {
  it('highlights the first case-insensitive match', () => {
    expect(highlight('Sales 2025', 'sal')).toEqual([
      { text: 'Sal', match: true },
      { text: 'es 2025', match: false },
    ]);
    expect(highlight('Retail sales', 'SALES')).toEqual([
      { text: 'Retail ', match: false },
      { text: 'sales', match: true },
    ]);
    expect(highlight('Budget', '')).toEqual([{ text: 'Budget', match: false }]);
    expect(highlight('Budget', 'zz')).toEqual([{ text: 'Budget', match: false }]);
  });

  it('labels a source with its kind and datasource name, falling back to what it knows', () => {
    expect(sourceLabel(ds('a', { datasourceId: 'pg', datasourceKind: 'postgres' }), NAMES)).toBe(
      'PostgreSQL · World Cup PostgreSQL',
    );
    expect(sourceLabel(ds('a', { datasourceId: 'gone', datasourceKind: 'databricks' }), NAMES)).toBe(
      'Databricks',
    );
    expect(sourceLabel(ds('a'), NAMES)).toBe('Other datasets');
  });

  it('lists a small catalogue flat and by name, marking the picked ones', () => {
    const view = buildPickerView([ds('World Cup'), ds('Formula 1'), ds('intellify')], ['World Cup'], '', NAMES);
    expect(view.sections.length).toBe(1);
    expect(view.sections[0].title).toBeNull();
    expect(view.flat.map((o) => [o.name, o.selected])).toEqual([
      ['Formula 1', false],
      ['intellify', false],
      ['World Cup', true],
    ]);
    expect(view.matches).toBe(3);
  });

  it('puts the three most recently updated first, then groups the rest by datasource', () => {
    const datasets = [
      ds('A', { datasourceId: 'pg', datasourceKind: 'postgres', updatedAt: '2026-11-01T00:00:00Z' }),
      ds('B', { datasourceId: 'pg', datasourceKind: 'postgres', updatedAt: '2026-11-10T00:00:00Z' }),
      ds('C', { datasourceId: 'dbx', datasourceKind: 'databricks', updatedAt: '2026-11-12T00:00:00Z' }),
      ds('D', { datasourceId: 'dbx', datasourceKind: 'databricks', updatedAt: '2026-10-01T00:00:00Z' }),
      ds('E', { datasourceId: 'pg', datasourceKind: 'postgres', updatedAt: '2026-11-15T00:00:00Z' }),
      ds('F', { datasourceId: 'pg', datasourceKind: 'postgres' }),
      ds('G', { datasourceKind: 'rest' }),
    ];
    const view = buildPickerView(datasets, [], '', NAMES);
    expect(view.sections.map((s) => [s.title, s.options.map((o) => o.name)])).toEqual([
      ['Recent', ['E', 'C', 'B']],
      ['Databricks · Finance DW', ['D']],
      ['PostgreSQL · World Cup PostgreSQL', ['A', 'F']],
      ['REST API', ['G']],
    ]);
    expect(view.flat.length).toBe(7);
  });

  it('searches names first, then tables, and says which table matched', () => {
    const datasets = [
      ds('Sales 2025', { datasourceId: 'dbx', datasourceKind: 'databricks', tables: ['orders'] }),
      ds('Retail Ops', { tables: ['stores', 'sales_orders'] }),
      ds('Budget', { tables: ['plan'] }),
    ];
    const view = buildPickerView(datasets, [], ' SALES ', NAMES);
    expect(view.sections.map((s) => s.title)).toEqual(['Name matches', 'Table matches']);
    const [byName, byTable] = view.flat;
    expect(byName.label).toEqual([
      { text: 'Sales', match: true },
      { text: ' 2025', match: false },
    ]);
    expect(byName.detail).toEqual([{ text: 'Databricks · Finance DW', match: false }]);
    expect(byTable.name).toBe('Retail Ops');
    expect(byTable.byTable).toBeTrue();
    expect(byTable.detail).toEqual([
      { text: 'sales', match: true },
      { text: '_orders', match: false },
    ]);
    expect(view.matches).toBe(2);
  });

  it('renders at most the limit and still counts every match', () => {
    const datasets = Array.from({ length: 250 }, (_, i) => ds(`Dataset ${String(i).padStart(3, '0')}`));
    const view = buildPickerView(datasets, [], 'dataset', NAMES, 100);
    expect(view.flat.length).toBe(100);
    expect(view.matches).toBe(250);
  });

  it('without a search cuts each datasource group, so every group still shows', () => {
    const datasets = [
      ...Array.from({ length: 30 }, (_, i) =>
        ds(`Finance ${String(i).padStart(2, '0')}`, { datasourceId: 'dbx', datasourceKind: 'databricks' }),
      ),
      ds('World Cup', { datasourceId: 'pg', datasourceKind: 'postgres' }),
    ];
    const view = buildPickerView(datasets, [], '', NAMES, 100, 20);
    expect(view.sections.map((s) => [s.title, s.options.length, s.hidden])).toEqual([
      ['Databricks · Finance DW', 20, 10],
      ['PostgreSQL · World Cup PostgreSQL', 1, 0],
    ]);
    expect(view.matches).toBe(21);
  });

  it('finds nothing for a search nothing matches', () => {
    const view = buildPickerView([ds('A'), ds('B')], [], 'zzz', NAMES);
    expect(view.sections).toEqual([]);
    expect(view.matches).toBe(0);
  });
});
